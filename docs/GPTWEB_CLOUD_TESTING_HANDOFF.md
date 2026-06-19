# GPT Web Cloud Testing Handoff

This file is for the Codex agent developing QFerry from `G:\repository\QFerry`.
Keep one agent responsible for the loop: change QFerry, run local checks, deploy the
same checkout to the cloud GPT Web connector, test in GPT Web, then fix from the
observed result.

## Current Cloud Shape

The GPT Web-facing QFerry runtime is managed from cloud-ops:

- cloud-ops root: `/home/raystorm/cloud-ops`
- QFerry source checkout on Windows/WSL: `G:\repository\QFerry` / `/mnt/g/repository/QFerry`
- tools VPS runtime: `/opt/gateway-tools/qferry`
- MCP loopback on VPS: `http://127.0.0.1:5012/mcp`
- tunnel health on VPS: `http://127.0.0.1:5011/readyz`
- systemd services:
  - `gateway-qferry-openai-mcp.service`
  - `gateway-qferry-openai-tunnel.service`
- GPT Web connector path: OpenAI Secure MCP Tunnel, tunnel name `Qferry`

Do not create a public URL for QFerry. GPT Web should connect through the OpenAI
Secure MCP Tunnel.

## Secret Boundary

Do not print, copy, or commit these values:

- `QQMAIL_KEY`
- OpenAI tunnel runtime control-plane key
- full secret env files under cloud-ops runtime

Cloud runtime secrets already live under ignored cloud-ops runtime paths:

- `/home/raystorm/cloud-ops/services/tools/qferry/runtime/qferry.env`
- `/home/raystorm/cloud-ops/services/tools/qferry/runtime/openai-secure-tunnel/tunnel-id.txt`
- `/home/raystorm/cloud-ops/services/tools/qferry/runtime/openai-secure-tunnel/control-plane-api-key.txt`

The cloud deploy script reads those files. Do not pass their contents on the
command line.

## Normal End-To-End Loop

From the QFerry checkout:

```bash
pnpm run check
pnpm run qferry:e2e:plugin-qq-readonly
pnpm run dev:sync-plugin-cache:all -- --apply
```

Then deploy this exact checkout to the GPT Web-facing cloud runtime from
cloud-ops:

```bash
cd /home/raystorm/cloud-ops
bin/gateway-tools-qferry-openai-tunnel-install.py --execute --qferry-source /mnt/g/repository/QFerry
```

The deploy script prepares dependencies locally, uploads the artifact to the
tools VPS, restarts both QFerry systemd services, and checks tunnel readiness.

After deploy, run the machine smoke:

```bash
cd /home/raystorm/cloud-ops
bin/gateway-tools-qferry-openai-mcp-smoke.py
```

Expected smoke shape:

```json
{
  "status": {
    "provider": "qqmail",
    "authConfigured": true,
    "providerReady": true,
    "mutationRequiresConfirmation": true,
    "statusWarnings": []
  },
  "toolCount": 25
}
```

Also verify a real read path without printing mailbox names or message data:

```bash
cd /home/raystorm/cloud-ops
set -a
. /home/raystorm/.config/intentmux/cloudflare-access-service-token.env
set +a
export TUNNEL_SERVICE_TOKEN_ID="$CF_ACCESS_CLIENT_ID"
export TUNNEL_SERVICE_TOKEN_SECRET="$CF_ACCESS_CLIENT_SECRET"
export NO_PROXY="localhost,127.0.0.1,::1"
port=22391
cloudflared access tcp --hostname tools-ssh.raystorm.me --url 127.0.0.1:$port >/tmp/qferry-tools-ssh-smoke.log 2>&1 &
pid=$!
trap 'kill $pid >/dev/null 2>&1 || true' EXIT
sleep 3
ssh -p $port -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new root@127.0.0.1 '
cat >/opt/gateway-tools/qferry/repo/.gateway/list-mailboxes-smoke.mjs <<'"'"'JS'"'"'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "qferry-mailboxes-smoke", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:5012/mcp"));
await client.connect(transport);
const result = await client.callTool({ name: "list_mailboxes", arguments: {} });
await client.close();
const data = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
console.log(JSON.stringify({ isError: Boolean(result.isError), mailboxCount: data.mailboxes?.length ?? null }));
JS
node /opt/gateway-tools/qferry/repo/.gateway/list-mailboxes-smoke.mjs
rm -f /opt/gateway-tools/qferry/repo/.gateway/list-mailboxes-smoke.mjs
'
```

Expected shape:

```json
{"isError":false,"mailboxCount":33}
```

The exact count may change if QQ Mail folders change. Do not paste folder names
or message contents into issues unless the user explicitly approves.

## GPT Web Test Procedure

In GPT Web / GPT Builder:

1. Open the connector/app settings.
2. Select OpenAI Secure MCP Tunnel.
3. Choose tunnel `Qferry`.
4. Start with this prompt:

```text
Use QFerry get_status, then list QQ Mail folders. Do not fetch message bodies and do not mutate anything.
```

Then test one bounded workflow at a time. Good prompts:

```text
Use QFerry to get status and capability snapshot. Do not mutate mailbox data.
```

```text
Use QFerry to search INBOX metadata with limit 3. Do not fetch full message bodies.
```

```text
Use QFerry to preview a cleanup plan only. Do not confirm or execute the plan.
```

Mutation tests require explicit user approval for one specific generated plan.
The required chain is:

1. preview tool creates an `operationPlanId`
2. user explicitly approves that exact plan
3. `confirm_cleanup_plan`
4. `execute_cleanup`

Do not let GPT Web fabricate a confirmed plan or skip the server-side
`operationPlanId`.

## Interpreting Failures

If GPT Web cannot add or reach the connector:

```bash
cd /home/raystorm/cloud-ops
systemctl status gateway-qferry-openai-mcp.service --no-pager -l
systemctl status gateway-qferry-openai-tunnel.service --no-pager -l
curl -fsS http://127.0.0.1:5011/readyz
```

Run those on the tools VPS through Cloudflare Access SSH, not on the local
machine directly.

If `gateway-tools-qferry-openai-mcp-smoke.py` passes but GPT Web fails, collect:

- GPT Web prompt
- tool name GPT attempted to call
- visible GPT Web error text
- approximate timestamp
- whether the cloud smoke passed immediately before the GPT Web test

Do not collect or paste raw QQ message bodies, full mailbox listings, or secrets.

## Known Integration Details

QFerry upstream is stdio MCP. The cloud deploy script adds a small Streamable
HTTP wrapper for OpenAI Secure MCP Tunnel. Important implications:

- Do not replace the cloud wrapper with a generic HTTP proxy.
- Do not treat a bare `GET /mcp` status as proof of MCP correctness.
- Use the MCP client smoke script for protocol checks.
- QFerry persists preview operation plans in its state directory; the wrapper no
  longer needs to rely on one long-lived in-memory MCP process for
  `confirm_cleanup_plan` and `execute_cleanup`. The cloud runtime still needs a
  writable durable `QFERRY_STATE_DIR` or `QFERRY_OPERATION_PLAN_STORE_DIR`.
- QFerry creates missing state directories and missing JSON rules files on
  demand. A missing rules file is treated as an empty reusable ruleset before
  `apply_ruleset_patch` writes the first rule.

The cloud env must include `QFERRY_PROVIDER=qqmail`; otherwise QFerry starts in
fixture mode even if `QQMAIL_EMAIL` and `QQMAIL_KEY` exist.

## Rollback

If the cloud deploy breaks GPT Web and you need to disable the connector:

```bash
systemctl disable --now gateway-qferry-openai-tunnel.service gateway-qferry-openai-mcp.service
```

Prefer fixing and redeploying over deleting tunnel resources. Do not rotate or
replace tunnel credentials unless the failure is clearly credential-related.
