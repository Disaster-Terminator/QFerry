# QFerry Codex Plugin

这是 QFerry 的 Codex 插件目录。

用户通过 Codex 插件市场安装：

```bash
codex plugin marketplace add Disaster-Terminator/QFerry
```

然后打开 Codex，运行 `/plugins`，切到 `[QFerry Local]` 插件市场，打开 `QFerry` 详情页，选择 `Install plugin`。

插件目录包含：

- `.codex-plugin/plugin.json`：插件发现和产品元数据。
- `.mcp.json`：MCP 工具暴露配置。
- `mcp-bootstrap.mjs`：Windows-safe bootstrap，会把运行 cwd 切到用户状态目录，再加载 runtime。
- `skills/qferry/SKILL.md`：面向 agent 的使用指引。
- `dist/mcp.cjs`：plugin-local runtime。

插件 runtime 必须通过 plugin-local `./mcp-bootstrap.mjs` 启动，并设置 `cwd: "."`。不要把 `.mcp.json` 指向源码 checkout。bootstrap 会加载同目录下的 `./dist/mcp.cjs`，并将运行 cwd 切到 `QFERRY_STATE_DIR` 或系统用户状态目录，避免 MCP 进程占用 Codex 插件缓存目录影响详情页、升级或卸载。

默认 provider 是 fixture。真实 QQ 邮箱需要本机提供 `QQMAIL_EMAIL` 和 `QQMAIL_KEY`，并且默认保持只读。

License: Apache-2.0, Copyright 2026 RayStorm.
