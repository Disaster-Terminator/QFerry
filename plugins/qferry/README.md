# QFerry Codex Plugin

这是 QFerry 的 Codex 插件目录。

用户通过 Codex 插件市场安装：

```bash
codex plugin marketplace add Disaster-Terminator/QFerry
```

然后打开 Codex，运行 `/plugins`，切到 QFerry 所在插件市场，打开 `QFerry` 详情页，选择 `Install plugin`。

插件目录包含：

- `.codex-plugin/plugin.json`：插件发现和产品元数据。
- `.mcp.json`：MCP 工具暴露配置。
- `skills/qferry/SKILL.md`：面向 agent 的使用指引。
- `dist/mcp.cjs`：plugin-local runtime。

插件 runtime 必须从 plugin-local `./dist/mcp.cjs` 启动，并设置 `cwd: "."`。不要把 `.mcp.json` 指向源码 checkout。

默认 provider 是 fixture。真实 QQ 邮箱需要本机提供 `QQMAIL_EMAIL` 和 `QQMAIL_KEY`，并且默认保持只读。

License: Apache-2.0, Copyright 2026 RayStorm.
