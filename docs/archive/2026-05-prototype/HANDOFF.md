项目名我建议先定：

# **QFerry**

副标题：**QQ Mail GPT App / Connector**

仓库名可以用：

```text
qferry
```

或者更 SEO 的：

```text
qferry-qqmail-gpt-app
```

我不建议用太泛的 `mail-bridge`、`maildesk`、`mailpilot`、`mailguard` 这类名字：我查到这些方向都有明显撞名或近似项目/产品；比如 `mail-bridge` 已经有一个“Gmail → OpenClaw → QQ mail importance bridge”的仓库，`MailPilot`、`PostPilot`、`MailGuard`、`MailDesk` 也都有现成产品或项目。`QFerry` 的语义是“把 QQ 邮箱 ferry/摆渡进 GPT”，短、好记、也不像直接蹭 QQ 官方品牌。

---

## 定位结论

这个项目不应该定位成“又一个邮件 MCP Server”。

应该定位成：

> **一个面向 ChatGPT Apps / GPT 连接器体系的 QQ 邮箱管理 App，让 ChatGPT 以接近 Gmail App 的方式读、搜、总结、治理、起草并确认式操作 QQ 邮箱。**

也就是说，核心不是 IMAP/SMTP 技术本身，而是：

```text
QQ 邮箱能力
  ↓
远程 MCP / ChatGPT App
  ↓
ChatGPT 对话内可用的邮箱工具
  ↓
安全确认、dry-run、审计、隐私边界
```

OpenAI 当前文档已经把原来的 connectors 逐步归入 ChatGPT Apps 体系；数据型 app 本质上是 remote MCP server，ChatGPT 可以通过它读私有数据源，Apps SDK 也支持带 UI 的工具型 app。([OpenAI开发者][1])
接入 ChatGPT 时，MCP server 需要通过 HTTPS 暴露 `/mcp` endpoint，在 ChatGPT 的 Apps & Connectors / Connectors 里创建；写操作默认会在 UI 中要求手动确认。([OpenAI开发者][2])

所以 QFerry 的产品定位应该是 **ChatGPT-first QQ Mail App**，不是 Claude/Codex-first MCP 工具。

---

## 成熟轮子调研结论

### 1. 最值得参考：`leeguooooo/Mailbox`

这是当前最像“邮箱治理底座”的开源项目。它定位是 CLI-first、多账户 IMAP/SMTP、本地同步缓存，明确支持 QQ Mail、163、Gmail、Outlook/Hotmail、自定义 IMAP，并且返回结构化 JSON，可被上层 skill / agent 调用。([GitHub][3])

它适合参考的点：

```text
- 多邮箱账户配置
- 本地 sync cache
- CLI-first contract
- structured JSON output
- skill / agent 集成方式
```

但它不是 ChatGPT App。它目前更像本地邮件管理 CLI + Agent Skill，不是 remote MCP / HTTPS / ChatGPT connector。

**结论：可以作为底层邮箱操作层参考，但 QFerry 不应该直接复制它的产品定位。**

---

### 2. 功能面最全：`shuakami/mcp-mail`

这个项目明确是 MCP 邮件工具，支持发信、读收件箱、附件、文件夹、高级搜索、获取邮件详情、标记已读/未读、删除、移动、联系人等。([GitHub][4])
它底层用 `nodemailer`、`node-imap`、`mailparser`，每个邮件操作被封装为 MCP 工具。([GitHub][4])

适合参考：

```text
- MCP tool schema
- 邮件搜索 / 详情 / 附件 / 联系人功能面
- HTML 与纯文本内容处理
- 大邮件分段加载思路
```

风险是：它还是标准本地 MCP 工具，不是 ChatGPT remote connector；而且对“误操作防护、审计日志、确认式写操作、最小化正文暴露”这些 ChatGPT App 场景下的产品边界没有特别突出。

**结论：功能清单值得抄，安全产品化要重做。**

---

### 3. 安全模型值得看：`neomody77/mcp-mail-organizer`

这个项目的功能覆盖也比较完整：列/建 mailbox、按多条件搜索邮件、获取详情、移动、删除、已读未读、flag、发信；关键是它明确有 destructive operations 的 preview mode。([GitHub][5])

它还直接写了 QQ Mail 配置：需要生成 QQ 邮箱授权码，IMAP 用 `imap.qq.com:993`，SMTP 用 `smtp.qq.com:587`。([GitHub][5])

适合参考：

```text
- delete / move 的 preview mode
- 搜索参数设计
- 多封邮件批量操作接口
- QQ Mail 授权码说明
```

**结论：安全交互设计值得借鉴，尤其适合 QFerry 的 dry-run/confirm 机制。**

---

### 4. 通用轻量方案：`TimeCyber/email-mcp`

它明确支持 QQ 邮箱、网易、Gmail、Outlook、腾讯企业邮箱等，并列出了 QQ 邮箱 SMTP/IMAP 参数：`smtp.qq.com:587`、`imap.qq.com:993`，推荐 IMAP。([GitHub][6])

适合参考：

```text
- 邮箱服务商自动识别
- 轻量安装体验
- 多邮箱 provider 配置表
```

但它更像“让 AI 能收发邮件的 MCP 服务”，不够像完整的邮箱治理 app。

**结论：适合参考 provider autodetect，不适合作为主基座。**

---

### 5. `adamswanglin/email-mcp`

这是一个偏只读 IMAP 查询的 MCP 服务。它支持通过 `npx @adamswanglin/email-mcp` 运行，QQ 邮箱配置也是 `imap.qq.com:993`，工具包括 `search_emails`、`get_email_contents`，返回发件人、主题、摘要、folder、uid 等。([GitHub][7])

它的优点是简单，风险面小；缺点是能力太窄。

**结论：适合参考第一阶段只读 MVP，不适合长期目标。**

---

### 6. `Auto-GPT-QQmail`

这是我查到的少数“名字上直接是 QQmail + AI agent”的老轮子。它描述为 “A plugin for AutoGPT that allows various operations on QQmail”，但仓库只有 1 个 commit、1 star、无 release，而且 README 仍是 Auto-GPT Plugin Template。([GitHub][8])

**结论：方向有参考意义，成熟度很低，不能作为基座。**

---

## 商业集成平台也有人做过

数环通有“QQ邮箱与 ChatGPT 对接并集成”的页面，支持“当收件箱有新邮件时”触发，并连接 ChatGPT 的提问/编辑文本动作。([数环通][9])

S-HUB 也有 ChatGPT 与 QQ 邮箱集成页，但它本质是企业系统集成平台，覆盖 Webservice、数据库、SDK、MQTT 等，不是 ChatGPT 对话内的邮箱 app。([S-Hub][10])

集简云的教程是“邮件触发 → ChatGPT → SMTP 发送”，它的 SMTP 发送可连接邮箱系统，邮件触发则通过集简云邮件账户把邮件正文等字段作为变量传给后续步骤。([jijyun.cn][11])

**这些平台证明需求存在，但产品形态不对。**
它们更像自动化工作流，不像 Gmail App 那种“我在 ChatGPT 里直接问我的邮箱情况”。

---

## QQ 邮箱协议基础

QQ 邮箱官方支持授权码。授权码是给第三方客户端登录用的专用密码，适用于 POP3、IMAP、SMTP、Exchange、CardDAV、CalDAV 等服务。([腾讯邮箱帮助中心][12])

所以 QFerry 不需要做网页自动化作为主链路。主链路应该是：

```text
IMAP: 搜索 / 读信 / 列文件夹 / 标记 / 移动 / 删除
SMTP: 发信 / 回复 / 转发
```

浏览器自动化只作为补充能力，比如 QQ 邮箱网页端独有的举报垃圾邮件、设置过滤规则、特殊安全设置。

---

## QFerry 的产品边界

### 一句话定位

```text
QFerry is a ChatGPT App that brings QQ Mail into ChatGPT with safe, reviewable, privacy-preserving email tools.
```

中文：

```text
QFerry 是一个把 QQ 邮箱安全接入 ChatGPT 的 GPT App / Connector，
让用户能在 ChatGPT 里像使用 Gmail App 一样查询、总结、治理和起草邮件。
```

### 不做什么

第一版不要做完整邮件客户端，不做网页邮箱替代品，不做企业工单系统，不做群发营销，不做“AI 自动全权处理邮箱”。

### 先做什么

第一版应该只做 **只读 + 草稿**：

```text
- 连接 QQ 邮箱
- 列出文件夹
- 搜索邮件
- 读取邮件详情
- 总结邮件 / 线程
- 找重要邮件
- 找疑似诈骗 / 垃圾邮件
- 生成回复草稿
```

第二版再做低风险写操作：

```text
- 标记已读 / 未读
- 移动到文件夹
- 添加本地分类标签
- 批量操作 dry-run
```

第三版才做高风险操作：

```text
- 发送邮件
- 删除邮件
- 批量移动
- 批量清理
- 自动规则建议
```

而且高风险操作必须走确认。

---

## 推荐技术架构

```text
ChatGPT
  ↓ Apps / Connectors
QFerry Remote MCP Server
  ↓
Auth & Secret Store
  ↓
QQ Mail Adapter
  ├─ IMAP client
  ├─ SMTP client
  ├─ MIME parser
  ├─ folder/UID mapper
  └─ attachment handler
  ↓
Local/Server Cache
  ├─ message metadata
  ├─ thread index
  ├─ operation audit log
  └─ optional vector/semantic index
```

关键点：

```text
- remote MCP over HTTPS
- OAuth-like connector auth，至少要有用户级 token
- QQ 授权码不能出现在 ChatGPT 对话里
- 邮件正文默认不落日志
- 搜索结果默认只返回 metadata + snippet
- 读取正文必须显式 tool call
- 删除/发送/批量移动必须 confirm
```

---

## 推荐仓库结构

```text
qferry/
  README.md
  LICENSE
  SECURITY.md
  docs/
    PRODUCT_POSITIONING.md
    CONNECTOR_CONTRACT.md
    SAFETY_MODEL.md
    QQMAIL_SETUP.md
    TOOL_SPEC.md
    AUDIT_LOG_CONTRACT.md
    ROADMAP.md
  apps/
    server/
      src/
        mcp/
        auth/
        qqmail/
        mail/
        safety/
        audit/
      tests/
  packages/
    mail-core/
    qqmail-adapter/
    mcp-tools/
  examples/
    local-dev/
    cloudflare-tunnel/
    chatgpt-connector/
```

如果先让 Codex 起项目，我建议让它直接生成这几个文档，不急着写实现：

```text
docs/PRODUCT_POSITIONING.md
docs/TOOL_SPEC.md
docs/SAFETY_MODEL.md
docs/QQMAIL_SETUP.md
docs/REPO_RESEARCH.md
```

---

## MVP 工具定义

第一批 tools：

```ts
list_folders(): Folder[]

search_messages(input: {
  query?: string
  folder?: string
  from?: string
  to?: string
  since?: string
  before?: string
  unreadOnly?: boolean
  hasAttachment?: boolean
  limit?: number
}): MessageSummary[]

get_message(input: {
  messageId: string
  includeBody?: boolean
  includeAttachments?: boolean
}): MessageDetail

summarize_thread(input: {
  threadId: string
}): ThreadSummary

draft_reply(input: {
  messageId: string
  instruction: string
}): DraftPreview
```

第二批 tools：

```ts
mark_message(input: {
  messageId: string
  read?: boolean
}): OperationResult

move_message_preview(input: {
  messageIds: string[]
  targetFolder: string
}): OperationPreview

move_message_confirm(input: {
  operationId: string
}): OperationResult
```

第三批 tools：

```ts
send_draft_preview(input: {
  draftId: string
}): OperationPreview

send_draft_confirm(input: {
  operationId: string
}): OperationResult

delete_messages_preview(input: {
  messageIds: string[]
}): OperationPreview

delete_messages_confirm(input: {
  operationId: string
}): OperationResult
```

这里一定要拆成 `preview` 和 `confirm`。不要只依赖 ChatGPT UI 的写操作确认，因为你自己的服务端也要有二次防线。

---

## 和现有轮子的关系

我建议 QFerry 的策略是：

```text
不 fork 某个邮件 MCP 项目作为产品主体。
先做 ChatGPT App / remote MCP skeleton。
底层 adapter 可以借鉴 Mailbox、mcp-mail、mcp-mail-organizer 的实现。
```

原因很简单：

现有项目的问题不是“不能收发 QQ 邮箱”，而是它们多数不是为 ChatGPT App 场景设计的。它们缺的是：

```text
- ChatGPT connector metadata
- remote MCP HTTPS deployment
- 用户授权流程
- 最小化正文暴露
- 写操作 confirmation contract
- 操作审计
- Gmail App 级别的产品说明
- 长期可维护的 tool schema
```

QFerry 的差异化应该落在这些地方。

---

## 最终定位稿

可以直接放进 README：

```markdown
# QFerry

QFerry is a ChatGPT App / remote MCP connector that brings QQ Mail into ChatGPT.

It lets users safely search, read, summarize, organize, and draft replies for QQ Mail from inside ChatGPT, using QQ Mail's standard IMAP/SMTP access with app authorization codes.

QFerry is not a general email client and not an automation bot that blindly takes over your inbox. It is designed around reviewable actions, privacy-preserving outputs, dry-run previews, and explicit confirmation for risky operations.

## Goals

- Provide a Gmail-like ChatGPT App experience for QQ Mail.
- Support safe read/search/summarize workflows first.
- Support draft-first replies before sending.
- Require confirmation for send, delete, and bulk move operations.
- Keep QQ Mail credentials outside ChatGPT conversations.
- Avoid logging email bodies or attachments by default.

## Non-goals

- Replacing the QQ Mail web client.
- Building a mass-mailing or marketing automation platform.
- Running fully autonomous destructive inbox cleanup.
- Scraping QQ Mail web UI as the primary integration method.
```

---

我的判断：**QFerry 这个项目值得做，而且产品缝隙很明确。**

现有轮子已经证明“QQ 邮箱 + AI/MCP”能跑，但没人把它认真做成 **ChatGPT App 形态的 QQ 邮箱连接器**。这正好是你的定位：底层不重复造 IMAP 轮子，上层做产品化、安全边界和 GPT App 体验。

[1]: https://developers.openai.com/api/docs/mcp "Building MCP servers for ChatGPT Apps and API integrations"
[2]: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt "Connect from ChatGPT – Apps SDK | OpenAI Developers"
[3]: https://github.com/leeguooooo/email-mcp-service "GitHub - leeguooooo/Mailbox: email skill · GitHub"
[4]: https://github.com/shuakami/mcp-mail "GitHub - shuakami/mcp-mail:  MCP Mail Tool - AI-powered email management tool | 基于 MCP 的智能邮件管理工具 · GitHub"
[5]: https://github.com/neomody77/mcp-mail-organizer "GitHub - neomody77/mcp-mail-organizer · GitHub"
[6]: https://github.com/TimeCyber/email-mcp "GitHub - TimeCyber/email-mcp: 一个让AI轻松接管邮箱的MCP服务，基于 Model Context Protocol (MCP) 构建，支持在 MCP-X,Claude Desktop 等 MCP 客户端中使用。 · GitHub"
[7]: https://github.com/adamswanglin/email-mcp "GitHub - adamswanglin/email-mcp: IMAP协议的邮件查询相关MCP服务 · GitHub"
[8]: https://github.com/botoai/Auto-GPT-QQmail "GitHub - botoai/Auto-GPT-QQmail: A plugin for AutoGPT that allows various operations on QQmail · GitHub"
[9]: https://www.solinkup.com/apps/app/10022/10022-10357 "QQ邮箱对接ChatGPT(试用版)轻松实现_数据集成自动化 - 数环通"
[10]: https://www.s-hub.cn/help/linkup/258310.html "ChatGPT与QQ邮箱集成对接 _ S-HUB让系统集成更简单"
[11]: https://www.jijyun.cn/help/detail/959 "如何通过集简云将ChatGPT人工智能接入到您的邮件中？ | 集简云连接数百款软件无需API接口开发"
[12]: https://help.mail.qq.com/detail/106/985?utm_source=chatgpt.com "授权码是QQ邮箱推出的，用于登录第三方客户端的专用密码。"
