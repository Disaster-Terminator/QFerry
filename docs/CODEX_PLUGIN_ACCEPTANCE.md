# QFerry Codex 插件安装与验收

本文档用于把 QFerry 从“仓库内 e2e 可跑”推进到“本机 Codex 可安装、可发现、可验收”。

## 当前边界

允许：

- 安装本地 Codex 插件。
- 启动 plugin-local MCP runtime：`plugins/qferry/dist/mcp.cjs`。
- 使用 fixture provider 验证工具发现和调用。
- 使用 QQ read-only provider 验证真实 QQ 邮箱的 capability、文件夹列表、小批量 metadata。

禁止：

- 真实 QQ 邮件移动。
- 标记已读/未读。
- 创建/删除 QQ 文件夹。
- 删除邮件。
- 发送邮件。
- 下载附件。
- 全量扫描邮箱。

真实 QQ 验收必须保持：

```text
mutationAllowed: false
mutationsAttempted: 0
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

## 公开前置检查

仓库公开前应确认：

```powershell
rtk pnpm run check
rtk pnpm qferry:e2e:plugin-fixture
rtk pnpm qferry:e2e:plugin-qq-readonly
rtk uv run python -m unittest tests.test_probe_qqmail
```

敏感文件不入库：

```text
.env
logs/
artifacts/
node_modules/
```

## 插件目录

Codex 插件目录是：

```text
G:\repository\QFerry\plugins\qferry
```

关键文件：

```text
plugins/qferry/.codex-plugin/plugin.json
plugins/qferry/.mcp.json
plugins/qferry/dist/mcp.cjs
plugins/qferry/skills/qferry/SKILL.md
```

`.mcp.json` 必须从插件目录启动：

```json
{
  "qferry": {
    "command": "node",
    "args": ["./dist/mcp.cjs"]
  }
}
```

不要把 `.mcp.json` 指向源码目录或 `tsx`。

## 本机部署后验收

用户把插件部署到本机 Codex 后，下一轮测试目标是：

1. Codex 能发现 QFerry 插件。
2. Codex 能加载 `qferry` skill。
3. QFerry MCP server 能从 plugin-local `dist/mcp.cjs` 启动。
4. fixture 工具调用成功。
5. QQ read-only 工具调用成功。
6. 生成本地 trace artifacts。

预期验收 artifacts：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

## License

QFerry 使用 Apache License 2.0。

```text
Copyright 2026 RayStorm
SPDX-License-Identifier: Apache-2.0
```
