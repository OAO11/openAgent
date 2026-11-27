import { registerTranslations } from "../hostTranslations";

registerTranslations({
  "zh-CN": {
    "resourceTranslation.Model": "翻译模型",
    "resourceTranslation.NoModel": "请先在供应商设置中启用模型",
    "resourceTranslation.Cancel": "停止翻译",
    "resourceTranslation.Batch": "翻译当前结果",
    "resourceTranslation.Start": "翻译为中文",
    "resourceTranslation.Original": "查看原文",
    "resourceTranslation.Chinese": "查看中文",
    "resourceTranslation.Progress": "正在翻译（条目 · 分段）",
    "resourceTranslation.Hint":
      "点击后将说明发送给所选模型，可能产生模型费用。译文会缓存在本机；不修改原始资源和安装配置。",
    "resourceTranslation.Result":
      "正在显示 AI 中文译文，已缓存在本机；未翻译部分保留原文。可切换原文核对，执行和安装仍使用原始资源。",
    "resourceTranslation.Incomplete":
      "模型返回的译文不完整或格式不正确，该条目保留原文。请重试或更换模型。",
    "resourceTranslation.Failed": "翻译失败，该条目保留原文。请检查模型配置或网络连接后重试。",
  },
  "en-US": {
    "resourceTranslation.Model": "Translation model",
    "resourceTranslation.NoModel": "Enable a model in provider settings first",
    "resourceTranslation.Cancel": "Stop translation",
    "resourceTranslation.Batch": "Translate current results",
    "resourceTranslation.Start": "Translate to Chinese",
    "resourceTranslation.Original": "View original",
    "resourceTranslation.Chinese": "View Chinese",
    "resourceTranslation.Progress": "Translating (item · chunk)",
    "resourceTranslation.Hint":
      "Clicking sends the description to the selected model and may incur model charges. Translations are cached locally; original resources and installation settings are unchanged.",
    "resourceTranslation.Result":
      "Showing locally cached AI Chinese translations; untranslated sections retain the original. Switch to the original to verify. Execution and installation still use the original resources.",
    "resourceTranslation.Incomplete":
      "The model returned an incomplete or invalid translation. This item retains the original. Retry or choose another model.",
    "resourceTranslation.Failed":
      "Translation failed. This item retains the original. Check the model configuration or connection and retry.",
  },
});
