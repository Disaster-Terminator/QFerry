# QFerry Codex Plugin

QFerry 是 QQ 邮箱整理工具的 Codex 插件形态。它通过 plugin-local MCP runtime 暴露 read-only 和 preview-first 邮箱工具。

当前边界：

- fixture 和 QQ read-only provider。
- QQ 真实邮箱只读 metadata 扫描。
- preview-only cleanup plan。
- 每次 e2e 写入 trace artifacts。
- 默认禁止真实邮箱写操作。

插件 runtime 必须从 plugin-local `./dist/mcp.cjs` 启动。不要把 `.mcp.json` 指向源码 checkout。

License: Apache-2.0, Copyright 2026 RayStorm.
