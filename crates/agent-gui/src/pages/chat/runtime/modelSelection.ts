import type { ModelConfigErrorCode } from "@liveagent/ui/lib/chat/modelConfigRejection";
import { t } from "../../../i18n/config";
import type { AppSettings, ProviderId, SelectedModel } from "../../../lib/settings";
import {
  type GatewaySelectedModelEvent,
  normalizeGatewayProviderType,
} from "../gateway/gatewayBridgeTypes";

export type EffectiveChatModelSelection = {
  selectedModel: SelectedModel;
  provider: AppSettings["customProviders"][number];
  providerId: ProviderId;
  model: string;
};

/** A chat turn refused because of the model or provider configuration. */
export class ChatModelSelectionError extends Error {
  readonly code: ModelConfigErrorCode;

  constructor(code: ModelConfigErrorCode, message: string) {
    super(message);
    this.name = "ChatModelSelectionError";
    this.code = code;
  }
}

export function resolveActiveModelSelection(
  settings: AppSettings,
  conversationSelectedModel: SelectedModel | undefined,
): SelectedModel | undefined {
  return conversationSelectedModel ?? settings.selectedModel;
}

export function resolvePersistedConversationModelSelection(params: {
  runtimeSelectedModel?: SelectedModel;
  turnSelectedModel?: SelectedModel;
}): SelectedModel | undefined {
  return params.runtimeSelectedModel ?? params.turnSelectedModel;
}

export function resolveEffectiveChatModelSelection(params: {
  settings: AppSettings;
  conversationSelectedModel?: SelectedModel;
  gatewaySelectedModel?: GatewaySelectedModelEvent;
}): EffectiveChatModelSelection {
  const { settings, conversationSelectedModel, gatewaySelectedModel } = params;
  const resolveLocalSelection = (): EffectiveChatModelSelection => {
    const activeSelectedModel = resolveActiveModelSelection(settings, conversationSelectedModel);
    if (!activeSelectedModel) {
      throw new ChatModelSelectionError(
        "model_config_missing",
        t("chat.modelSelection.missing", settings.locale),
      );
    }

    const { customProviderId, model } = activeSelectedModel;
    const provider = settings.customProviders.find((item) => item.id === customProviderId);
    if (!provider) {
      throw new ChatModelSelectionError(
        "model_config_provider_missing",
        t("chat.modelSelection.providerMissing", settings.locale),
      );
    }
    if (provider.enabled === false || !provider.activeModels.includes(model)) {
      throw new ChatModelSelectionError(
        "model_config_model_disabled",
        provider.enabled === false
          ? t("chat.modelSelection.providerDisabled", settings.locale)
          : t("chat.modelSelection.modelDisabled", settings.locale),
      );
    }

    return {
      selectedModel: activeSelectedModel,
      provider,
      providerId: provider.type,
      model,
    };
  };

  if (!gatewaySelectedModel) {
    return resolveLocalSelection();
  }

  const customProviderId = gatewaySelectedModel.customProviderId.trim();
  const model = gatewaySelectedModel.model.trim();
  const providerType = normalizeGatewayProviderType(gatewaySelectedModel.providerType);
  if (!customProviderId || !model || !providerType) {
    throw new ChatModelSelectionError(
      "model_config_invalid",
      t("chat.modelSelection.remoteInvalid", settings.locale),
    );
  }

  const provider = settings.customProviders.find((item) => item.id === customProviderId);
  if (!provider) {
    throw new ChatModelSelectionError(
      "model_config_provider_missing",
      t("chat.modelSelection.remoteProviderMissing", settings.locale),
    );
  }
  if (provider.type !== providerType) {
    throw new ChatModelSelectionError(
      "model_config_provider_type_mismatch",
      t("chat.modelSelection.remoteProviderMismatch", settings.locale),
    );
  }
  if (provider.enabled === false || !provider.activeModels.includes(model)) {
    throw new ChatModelSelectionError(
      "model_config_model_disabled",
      t("chat.modelSelection.remoteModelDisabled", settings.locale),
    );
  }

  return {
    selectedModel: {
      customProviderId: provider.id,
      model,
    },
    provider,
    providerId: provider.type,
    model,
  };
}
