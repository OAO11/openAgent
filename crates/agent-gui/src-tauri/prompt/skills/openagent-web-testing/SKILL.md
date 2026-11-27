---
name: openagent-web-testing
description: "使用 Playwright 验证本地 Web 页面、关键交互、控制台错误和截图；适用于网页与可访问 WebView 的 UI 验收。"
license: Apache-2.0
---

# Web 端到端测试

使用 Playwright 验证本地 Web 页面、关键交互、控制台错误和截图；适用于网页与可访问 WebView 的 UI 验收。

## openAgent 使用流程

1. 确认目标服务、启动命令、浏览器驱动和测试账号；优先复用项目已有 E2E 环境，避免启动重复服务。
2. 先检查 upstream/scripts/with_server.py --help；仅在 Python 与 Playwright 可用且确实需要托管服务时调用。
3. 使用可访问性角色或稳定测试标记定位元素，等待真实可见状态，验证成功、失败、空数据与重载恢复。
4. 测试数据与正常用户数据分离；保留截图、日志和复现步骤。普通网页测试不能代替原生 EXE 安装、窗口或 IPC 验收。

## 适配与完整来源

- 沿用用户技术栈、仓库规范和已确认的任务范围。只使用当前宿主实际提供的工具；上游专属命令、固定路径、插件与子代理均不是额外前提。
- 不因参考中的固定流程而自动提交、发布、删除已有工作或扩展任务；已获授权的必要工作继续执行。
- 下方保留上游完整正文；未删减原始文件为 [upstream/SKILL.md](upstream/SKILL.md)，原文中相对脚本和引用路径以 upstream 目录为基准，按需要读取，不能假装已经读取或执行。
- 来源：[anthropics/skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/webapp-testing)；固定版本 `e4bb5d960d87126ff3b3a8af1a104b7db67560ba`；许可 [Apache-2.0](upstream/LICENSE.txt)。中文流程与宿主适配由 openAgent 添加。

- 脚本兼容适配：三个 Python 示例仅增加 `#!/usr/bin/env python3` 首行；同目录 `.py.txt` 保留逐字原文及来源校验。

## 上游完整参考（英文）

# Web Application Testing

To test local web applications, write native Python Playwright scripts.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Example: Using with_server.py

To start a server, run `--help` first, then use the helper:

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.wait_for_load_state('networkidle')` before inspection

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.wait_for_selector()` or `page.wait_for_timeout()`

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.py` - Using file:// URLs for local HTML
  - `console_logging.py` - Capturing console logs during automation