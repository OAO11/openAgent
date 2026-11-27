import "@liveagent/ui/i18n/namespaces/settings";
import {
  Brain,
  Download,
  FileText,
  HardDrive,
  Layers,
  Loader2,
  McpLogo,
  MessageSquare,
  ScrollText,
  Server,
  Settings2,
  SkillIcon,
  Upload,
} from "@liveagent/ui/components/IconSet";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@liveagent/ui/components/settings/SettingsLayout";
import { Button } from "@liveagent/ui/components/ui/button";
import { useConfirmDialog } from "@liveagent/ui/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@liveagent/ui/components/ui/dialog";
import { toast } from "@liveagent/ui/components/ui/toast-manager";
import { useLocale } from "@liveagent/ui/i18n/index";
import { hostAwareErrorMessage } from "@liveagent/ui/lib/shared/hostErrors";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import {
  applyBackupImport,
  type BackupDomainCounts,
  type BackupManifest,
  exportBackup,
  peekBackupImport,
} from "../../lib/backup";
import type { SettingsSectionProps } from "./types";

type Status = { kind: "ok" | "error"; text: string } | null;

/** 后端返回的错误已是可直接展示的中文文案；宿主能力缺失时换成桌面端提示。 */
function errorText(error: unknown, unavailableMessage: string): string {
  return hostAwareErrorMessage(error, unavailableMessage);
}

/** manifest.createdAt 是 RFC3339 UTC，按本地时区展示。 */
function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function summarizeDomains(counts: BackupDomainCounts, t: (key: string) => string): string {
  return [
    `${t("settings.backupDomainProviders")} ${counts.providers}`,
    `${t("settings.backupDomainMcp")} ${counts.mcp}`,
    `${t("settings.backupDomainSystem")} ${counts.system}`,
    `${t("settings.backupDomainAgents")} ${counts.agents}`,
    `${t("settings.backupDomainModelFailover")} ${counts.modelFailover}`,
  ].join(" · ");
}

function describeSource(manifest: BackupManifest, t: (key: string) => string) {
  const rows: [string, string][] = [
    [t("settings.backupSourceDevice"), manifest.deviceName],
    [t("settings.backupSourceTime"), formatCreatedAt(manifest.createdAt)],
    [t("settings.backupSourceVersion"), manifest.appVersion],
  ];
  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <span className="shrink-0 opacity-70">{label}</span>
          <span className="break-all font-medium">{value}</span>
        </div>
      ))}
      <div className="pt-1">{summarizeDomains(manifest.domains, t)}</div>
    </div>
  );
}

function ScopeItem({
  icon,
  label,
  excluded = false,
}: {
  icon: ReactNode;
  label: string;
  excluded?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-xs font-medium leading-none",
        excluded ? "bg-muted/30 text-muted-foreground/70" : "bg-muted/45 text-foreground/85",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center",
          excluded && "opacity-60",
        )}
      >
        {icon}
      </span>
      <span className={excluded ? "line-through decoration-muted-foreground/40" : ""}>{label}</span>
    </span>
  );
}

function BackupScopeDetails({ t }: { t: (key: string) => string }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t("settings.backupScopeIncluded")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ScopeItem
            icon={<Server className="size-3.5" />}
            label={t("settings.backupDomainProviders")}
          />
          <ScopeItem
            icon={<McpLogo className="size-3.5" />}
            label={t("settings.backupDomainMcp")}
          />
          <ScopeItem
            icon={<Settings2 className="size-3.5" />}
            label={t("settings.backupDomainSystem")}
          />
          <ScopeItem
            icon={<ScrollText className="size-3.5" />}
            label={t("settings.backupDomainAgents")}
          />
          <ScopeItem
            icon={<Layers className="size-3.5" />}
            label={t("settings.backupDomainModelFailover")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t("settings.backupScopeExcluded")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ScopeItem
            excluded
            icon={<MessageSquare className="size-3.5" />}
            label={t("settings.backupScopeChat")}
          />
          <ScopeItem
            excluded
            icon={<Brain className="size-3.5" />}
            label={t("settings.backupScopeMemory")}
          />
          <ScopeItem
            excluded
            icon={<FileText className="size-3.5" />}
            label={t("settings.backupScopeUploads")}
          />
          <ScopeItem
            excluded
            icon={<SkillIcon className="size-3.5" />}
            label={t("settings.backupScopeSkills")}
          />
          <ScopeItem
            excluded
            icon={<HardDrive className="size-3.5" />}
            label={t("settings.backupScopeDeviceLocal")}
          />
        </div>
      </div>
    </div>
  );
}

export function BackupSyncSection(props: SettingsSectionProps) {
  const { reloadSettings } = props;
  const { t } = useLocale();
  const { confirm, dialog } = useConfirmDialog();
  const toastScope = useId();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (!status) return;
    const options = { id: `${toastScope}-local`, appearance: "notice" as const };
    if (status.kind === "ok") toast.success(status.text, options);
    else toast.error(status.text, options);
  }, [status, toastScope]);

  /**
   * 还原（导入 / 下载）落库后从 SQLite 重载前端状态。
   *
   * 不重载的后果不是「显示旧值」这么轻：`persistSettings` 按域 diff，
   * 用户之后动任一域就会拿还原前的内存值写回库，把还原静默回滚掉。
   */
  const syncStateAfterRestore = useCallback(async () => {
    await reloadSettings?.();
  }, [reloadSettings]);

  const handleExport = useCallback(async () => {
    setBusy("export");
    setStatus(null);
    try {
      const path = await exportBackup();
      // 用户在系统对话框里取消时返回 null，不算失败。
      if (path) {
        setStatus({ kind: "ok", text: `${t("settings.backupExportDone")}${path}` });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          errorText(error, t("settings.backupSyncDesktopHostRequired")) ||
          t("settings.backupExportFailed"),
      });
    } finally {
      setBusy(null);
    }
  }, [t]);

  const handleImport = useCallback(async () => {
    setBusy("import");
    setStatus(null);
    try {
      // 先只解析校验、不写库，让用户看到来源摘要再决定是否覆盖。
      const preview = await peekBackupImport();
      if (!preview) return;

      const confirmed = await confirm({
        title: t("settings.backupImportConfirmTitle"),
        subtitle: t("settings.backupImportConfirmSubtitle"),
        description: describeSource(preview.manifest, t),
        detail: preview.path,
        confirmLabel: t("settings.backupImportConfirmAction"),
        cancelLabel: t("settings.backupCancel"),
      });
      if (!confirmed) return;

      const outcome = await applyBackupImport(preview.path);
      await syncStateAfterRestore();
      setStatus({
        kind: "ok",
        text: `${t("settings.backupImportDone")}${summarizeDomains(outcome.applied, t)}`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          errorText(error, t("settings.backupSyncDesktopHostRequired")) ||
          t("settings.backupImportFailed"),
      });
    } finally {
      setBusy(null);
    }
  }, [confirm, syncStateAfterRestore, t]);

  return (
    <div className="space-y-6">
      <SettingsSection title={t("settings.backupLocalTitle")}>
        <SettingsCard>
          <SettingsRow
            data-settings-anchor="backup-export"
            title={t("settings.backupExport")}
            description={t("settings.backupExportHint")}
            control={
              <Button size="sm" disabled={busy !== null} onClick={() => void handleExport()}>
                {busy === "export" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {t("settings.backupExport")}
              </Button>
            }
          />
          <SettingsRow
            data-settings-anchor="backup-import"
            title={t("settings.backupImport")}
            description={
              <span>
                {t("settings.backupImportHint")}
                <span className="block">{t("settings.backupAutoBackupHint")}</span>
              </span>
            }
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void handleImport()}
              >
                {busy === "import" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {t("settings.backupImport")}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.backupScopeTitle")}>
        <SettingsCard>
          <SettingsRow
            data-settings-anchor="backup-scope"
            title={t("settings.backupScopeSummaryTitle")}
            description={t("settings.backupScopeSummary")}
            control={
              <Dialog>
                <DialogTrigger render={<Button size="sm" variant="outline" />}>
                  {t("settings.backupScopeView")}
                </DialogTrigger>
                <DialogContent
                  className="max-w-lg"
                  closeLabel={t("settings.backupCancel")}
                  showCloseButton
                >
                  <DialogHeader>
                    <DialogTitle>{t("settings.backupScopeTitle")}</DialogTitle>
                    <DialogDescription>{t("settings.backupScopeSummary")}</DialogDescription>
                  </DialogHeader>
                  <DialogBody>
                    <BackupScopeDetails t={t} />
                  </DialogBody>
                </DialogContent>
              </Dialog>
            }
          />
        </SettingsCard>
      </SettingsSection>

      {dialog}
    </div>
  );
}
