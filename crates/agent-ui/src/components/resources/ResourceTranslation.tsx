import "../../i18n/namespaces/resourceTranslation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { getResourceHostCapabilities, type ResourceHostCapabilities } from "../../lib/resourceHost";
import {
  readTranslationCache,
  type SkillTranslator,
  type TranslationModel,
  translateResourceText,
  translationCacheId,
  writeTranslationCache,
} from "../../lib/resources/resourceTranslationService";
import type { AppSettings } from "../../lib/settings";

const TranslationContext = createContext<{
  models: TranslationModel[];
  model?: TranslationModel;
  select: (key: string) => void;
  generate?: SkillTranslator;
}>({ models: [], select: () => {} });
const modelKey = (model: TranslationModel) => JSON.stringify([model.provider, model.model]);
function localCache() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function ResourceTranslationProvider(props: {
  settings: AppSettings;
  resourceHost?: ResourceHostCapabilities;
  children: ReactNode;
}) {
  const models = useMemo(
    () =>
      props.settings.customProviders.flatMap((provider) =>
        provider.activeModels.map((model) => ({
          provider: provider.id,
          model,
          label: `${provider.name} · ${model}`,
        })),
      ),
    [props.settings.customProviders],
  );
  const [selection, select] = useState(() =>
    props.settings.selectedModel
      ? JSON.stringify([
          props.settings.selectedModel.customProviderId,
          props.settings.selectedModel.model,
        ])
      : "",
  );
  const model = models.find((item) => modelKey(item) === selection) ?? models[0];
  const generate =
    (props.resourceHost ?? getResourceHostCapabilities()).translate ??
    (props.resourceHost ?? getResourceHostCapabilities()).skillsAdapter?.translate;
  return (
    <TranslationContext.Provider value={{ models, model, select, generate }}>
      {props.children}
    </TranslationContext.Provider>
  );
}

export function useResourceTranslation(documents: Record<string, string>) {
  const { model, generate } = useContext(TranslationContext);
  const serialized = JSON.stringify(documents);
  const sources = useMemo<Record<string, string>>(() => JSON.parse(serialized), [serialized]);
  const scope = JSON.stringify([serialized, model?.provider, model?.model]);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    scope: string;
    values: Record<string, string>;
    ready: boolean;
  }>({ scope: "", values: {}, ready: false });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [chinese, setChinese] = useState(true);
  const values = state.scope === scope ? state.values : {};
  const ready = state.scope === scope && state.ready;
  const entries = Object.entries(sources).filter(([, text]) => text.trim());
  const missing = entries.filter(([id]) => !values[id]).length;

  useEffect(() => {
    let stale = false;
    controller.current?.abort();
    setRunning(false);
    setError("");
    setProgress("");
    setState({ scope, values: {}, ready: false });
    void (async () => {
      const cached = readTranslationCache(localCache());
      const values: Record<string, string> = {};
      if (model) {
        for (const [id, text] of Object.entries(sources)) {
          const value = cached[await translationCacheId(text, model)];
          if (value) values[id] = value;
        }
      }
      if (!stale) setState({ scope, values, ready: true });
    })().catch(() => {
      if (!stale) setState({ scope, values: {}, ready: true });
    });
    return () => {
      stale = true;
      controller.current?.abort();
    };
  }, [scope, sources, model]);

  async function translate() {
    if (
      !model ||
      !generate ||
      !ready ||
      (controller.current && !controller.current.signal.aborted && running)
    )
      return;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setRunning(true);
    setError("");
    setChinese(true);
    const next = { ...values };
    const pending = entries.filter(([id]) => !next[id]);
    try {
      for (const [index, [id, source]] of pending.entries()) {
        request.signal.throwIfAborted();
        const cacheId = await translationCacheId(source, model);
        const cached = readTranslationCache(localCache())[cacheId];
        const text =
          cached ??
          (await translateResourceText({
            source,
            model,
            generate: (input, signal) =>
              generate(input, AbortSignal.any([signal, AbortSignal.timeout(120_000)])),
            signal: request.signal,
            onProgress: (done, total) => {
              if (!request.signal.aborted)
                setProgress(`${index + 1}/${pending.length} · ${done}/${total}`);
            },
          }));
        request.signal.throwIfAborted();
        next[id] = text;
        writeTranslationCache(localCache(), cacheId, text);
        setState({ scope, values: { ...next }, ready: true });
      }
    } catch (error) {
      if (!request.signal.aborted)
        setError(
          error instanceof Error && error.message === "translation-incomplete"
            ? "incomplete"
            : "failed",
        );
    } finally {
      if (controller.current === request) {
        setRunning(false);
        setProgress("");
      }
    }
  }
  return {
    text: (id: string) => (chinese ? (values[id] ?? sources[id] ?? "") : (sources[id] ?? "")),
    translate,
    running,
    error,
    progress,
    chinese,
    setChinese,
    missing,
    ready,
    hasTranslations: Object.keys(values).length > 0,
    hasSources: entries.length > 0,
    cancel: () => {
      controller.current?.abort();
      setRunning(false);
      setProgress("");
    },
  };
}

export function ResourceTranslationControls(props: {
  translation: ReturnType<typeof useResourceTranslation>;
  batch?: boolean;
  disabled?: boolean;
}) {
  const { models, model, select, generate } = useContext(TranslationContext);
  const { t } = useLocale();
  const translation = props.translation;
  if (!generate) return null;
  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"
      data-resource-translation
      data-skill-translation
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("resourceTranslation.Model")}
          className="min-w-0 max-w-full flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          value={model ? modelKey(model) : ""}
          disabled={translation.running || models.length === 0}
          onChange={(event) => select(event.target.value)}
        >
          {!models.length ? <option value="">{t("resourceTranslation.NoModel")}</option> : null}
          {models.map((item) => (
            <option key={modelKey(item)} value={modelKey(item)}>
              {item.label}
            </option>
          ))}
        </select>
        {translation.running ? (
          <Button size="sm" variant="outline" onClick={translation.cancel}>
            {t("resourceTranslation.Cancel")}
          </Button>
        ) : translation.missing > 0 || !translation.hasTranslations ? (
          <Button
            size="sm"
            variant="outline"
            disabled={props.disabled || !model || !translation.ready || !translation.hasSources}
            onClick={() => void translation.translate()}
          >
            {t(props.batch ? "resourceTranslation.Batch" : "resourceTranslation.Start")}
          </Button>
        ) : null}
        {translation.hasTranslations ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => translation.setChinese(!translation.chinese)}
          >
            {t(
              translation.chinese ? "resourceTranslation.Original" : "resourceTranslation.Chinese",
            )}
          </Button>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground" role="status">
        {translation.running
          ? `${t("resourceTranslation.Progress")} ${translation.progress}`
          : translation.hasTranslations && translation.chinese
            ? t("resourceTranslation.Result")
            : t("resourceTranslation.Hint")}
      </p>
      {translation.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(
            translation.error === "incomplete"
              ? "resourceTranslation.Incomplete"
              : "resourceTranslation.Failed",
          )}
        </p>
      ) : null}
    </div>
  );
}

export function storeTranslationSource(skill: { displayName: string; summary: string }) {
  return `# ${skill.displayName}\n\n${skill.summary}`;
}
export function storeTranslationDisplay(text: string) {
  const split = text.indexOf("\n");
  return {
    displayName: (split < 0 ? text : text.slice(0, split)).replace(/^#+\s*/, "").trim(),
    summary: split < 0 ? "" : text.slice(split + 1).trim(),
  };
}
