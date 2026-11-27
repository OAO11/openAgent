import "@liveagent/ui/i18n/namespaces/settings";
import type { AgentPromptTemplate, CustomProvider } from "@liveagent/app/lib/settings";
import { BookOpen, FileText } from "@liveagent/ui/components/IconSet";
import { FormField } from "@liveagent/ui/components/settings/FormField";
import { useLocale } from "@liveagent/ui/i18n/index";
import { resolveModelThinking } from "@liveagent/ui/lib/models/modelThinking";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { ModelPicker } from "./modelPicker";

type AgentPromptTemplateModalProps = {
  initialData?: AgentPromptTemplate;
  providers: CustomProvider[];
  onSave: (data: Omit<AgentPromptTemplate, "id" | "enabled">) => void;
  onClose: () => void;
};

export function AgentPromptTemplateModal({
  initialData,
  providers,
  onSave,
  onClose,
}: AgentPromptTemplateModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");
  const [roleEnabled, setRoleEnabled] = useState(initialData?.roleEnabled === true);
  const [modelKey, setModelKey] = useState(
    initialData?.roleModelId
      ? JSON.stringify([initialData.roleProviderId ?? "", initialData.roleModelId])
      : "",
  );
  const [reasoning, setReasoning] = useState<AgentPromptTemplate["roleReasoning"]>(
    initialData?.roleReasoning,
  );
  const modelOptions = providers.flatMap((provider) =>
    provider.models
      .filter((model) => provider.activeModels.includes(model.id) && !model.imageModel)
      .map((model) => ({
        value: JSON.stringify([provider.id, model.id]),
        label: model.displayName || model.id,
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
      })),
  );
  const selected = modelOptions.find((option) => option.value === modelKey);
  const [providerId, modelId] = modelKey ? (JSON.parse(modelKey) as [string, string]) : ["", ""];
  const capability = selected ? resolveModelThinking(selected.providerType, modelId) : undefined;
  const unavailable = Boolean(modelKey && !selected);
  const levels = capability?.levels ?? ["minimal", "low", "medium", "high", "xhigh", "max"];
  const thinkingSupported = capability?.reasoning !== false;
  const effectiveReasoning =
    capability?.alwaysOn && reasoning === "off"
      ? undefined
      : reasoning && reasoning !== "off" && !levels.includes(reasoning)
        ? undefined
        : reasoning;
  const thinking = thinkingSupported && effectiveReasoning !== "off";

  function handleSave() {
    if (!name.trim() || !prompt.trim() || unavailable) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      prompt,
      roleEnabled,
      roleProviderId: providerId || undefined,
      roleModelId: modelId || undefined,
      roleReasoning: thinkingSupported ? effectiveReasoning : undefined,
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[min(48rem,calc(100dvh-2rem))] max-w-5xl flex-col p-0"
        closeLabel={t("settings.cancel")}
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>
            {initialData ? t("settings.agentsEdit") : t("settings.agentsAdd")}
          </DialogTitle>
          <DialogDescription>{t("settings.agentsRoleIntro")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
          <section className="min-w-0 space-y-5 rounded-2xl border bg-background p-5">
            <div className="flex items-center gap-3">
              <BookOpen className="size-5 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">{t("settings.agentsTemplateInfo")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.agentsTemplateInfoHint")}
                </p>
              </div>
            </div>
            <FormField>
              <Label htmlFor="agent-template-name">{t("settings.agentsName")} *</Label>
              <Input
                id="agent-template-name"
                value={name}
                placeholder={t("settings.agentsNamePlaceholder")}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="agent-template-description">{t("settings.agentsDescription")}</Label>
              <Textarea
                id="agent-template-description"
                value={description}
                placeholder={t("settings.agentsDescriptionPlaceholder")}
                onChange={(e) => setDescription(e.currentTarget.value)}
                className="min-h-20 resize-y"
              />
            </FormField>
            <div className="flex items-center justify-between gap-4 border-t pt-5">
              <div>
                <Label htmlFor="agent-template-role">{t("settings.agentsUseAsRole")}</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.agentsRoleHint")}
                </p>
              </div>
              <Switch
                id="agent-template-role"
                checked={roleEnabled}
                onCheckedChange={setRoleEnabled}
              />
            </div>
            <fieldset className="space-y-4" disabled={!roleEnabled}>
              <FormField>
                <Label>{t("settings.agentsRoleModel")}</Label>
                <ModelPicker
                  options={modelOptions}
                  value={modelKey}
                  onChange={setModelKey}
                  disabled={!roleEnabled}
                  ariaLabel={t("settings.agentsRoleModel")}
                  placeholder={unavailable ? modelId : t("settings.agentsInheritModel")}
                  noneLabel={t("settings.agentsInheritModel")}
                />
                {unavailable && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("settings.agentsModelUnavailable")}
                  </p>
                )}
              </FormField>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="agent-template-thinking">{t("settings.agentsThinking")}</Label>
                <Switch
                  id="agent-template-thinking"
                  checked={thinking}
                  disabled={!roleEnabled || !thinkingSupported || capability?.alwaysOn}
                  onCheckedChange={(enabled) =>
                    setReasoning(enabled ? (levels.includes("high") ? "high" : levels[0]) : "off")
                  }
                />
              </div>
              {capability?.alwaysOn && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.agentsThinkingRequired")}
                </p>
              )}
              {!thinkingSupported && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.agentsThinkingUnavailable")}
                </p>
              )}
              <FormField>
                <Label htmlFor="agent-template-reasoning">{t("settings.agentsReasoning")}</Label>
                <Select
                  value={
                    effectiveReasoning && effectiveReasoning !== "off"
                      ? effectiveReasoning
                      : "inherit"
                  }
                  disabled={!roleEnabled || !thinking || levels.length === 0}
                  onValueChange={(value) =>
                    setReasoning(
                      value === "inherit"
                        ? undefined
                        : (value as AgentPromptTemplate["roleReasoning"]),
                    )
                  }
                >
                  <SelectTrigger id="agent-template-reasoning">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t("settings.agentsInheritReasoning")}</SelectItem>
                    {levels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </fieldset>
          </section>
          <section className="flex min-h-max min-w-0 flex-col gap-4 rounded-2xl border bg-background p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <FileText className="size-5 shrink-0 text-primary" />
                <div>
                  <Label htmlFor="agent-template-prompt">{t("settings.agentsPrompt")} *</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.agentsPromptHint")}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
                {Array.from(prompt).length.toLocaleString()} {t("settings.agentsCharacters")}
              </span>
            </div>
            <Textarea
              id="agent-template-prompt"
              value={prompt}
              placeholder={t("settings.agentsPromptPlaceholder")}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              className="min-h-64 flex-1 resize-none font-mono text-sm leading-7"
            />
          </section>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <Button size="sm" variant="outline" onClick={onClose}>
              {t("settings.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!name.trim() || !prompt.trim() || unavailable}
            >
              {t("settings.save")}
            </Button>
          </DialogActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
