# openAgent 内置提示词

8 个角色采用 `msitarzewski/agency-agents` revision `8ae6164602c95ca78828b148b9052460ee426885` 的完整英文 Markdown 原文，保留 YAML、章节、示例和代码块，不进行摘要或中文改写。界面名称和简介使用中文。完整 MIT 许可证见 LICENSE.agency-agents，原作版权 Copyright (c) 2025 AgentLand Contributors。

原始文件位于 `agency-agents/`；`agency-agents-sources.json` 记录每个角色的原始路径、固定 revision、SHA-256 和 Unicode 字符数。`openagent-presets.json` 中的 prompt 与相应 Markdown 字节一致。“架构设计”原文为 6,432 个 Unicode 字符；旧 v1 中文精简正文为 370 个字符。

模板默认不充当全局提示词，启用为可供模型选择的子代理角色。角色只有在 K-brain 实际调用 subagent 并选择 role 后才应用，未指定模型时沿用既有子代理默认模型。原文对工具、记忆和部署的描述不创建这些能力，也不增加运行权限。

JSON 同步嵌入 K-brain 产品补丁。首次初始化合并 8 个模板，保留已有同 ID 模板。v1 升级至 v2 时，仅替换与旧预设正文完全一致的 prompt；保留名称、简介、开关、模型和推理配置，用户编辑过的正文保持原样。不会重建已删除项。版本标记与 agents.json 原子保存，重启不会重复升级。
