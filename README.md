# aibuddy-mcp

An MCP server and CLI that let AI agents generate **images, short videos and music** with AIBuddy.
Point Claude, Cursor, Codex or VS Code at it, then just describe what you want.

Every call is billed to your own AIBuddy credits through the public v2 API — the same key the
AIBuddy apps use. No provider keys and no other accounts.

## Tools

| Tool | What it does |
|---|---|
| `generate_image` | Text → image. Returned inline, and saved to disk when `AIBUDDY_OUTPUT_DIR` is set. |
| `edit_image` | Image + prompt → restyled variant. JPEG around 1024px; 480 KB cap once encoded. |
| `generate_video` | Text or still → short clip. Async: returns a `task_id`, or blocks with `wait_seconds`. |
| `generate_music` | Text → song or instrumental. Async, same pattern. |
| `get_task` | Status and result URLs of a video/music job. Ids expire after 24 h. |
| `list_models` | The image, video and music models available right now. No key needed. |

## Setup

You need Node 18+ and an AIBuddy API key from
<https://denvermobileappdeveloper.com/aibuddy-api>.

Until the package is on npm, run it from a checkout:
`/absolute/path/to/aibuddyapi/packages/aibuddy-mcp/bin/aibuddy-mcp.js`. Once published, replace
`"command": "node", "args": ["<path>"]` with `"command": "npx", "args": ["-y", "aibuddy-mcp"]`.

**Claude Desktop** — Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aibuddy": {
      "command": "node",
      "args": ["/absolute/path/to/aibuddy-mcp/bin/aibuddy-mcp.js"],
      "env": { "AIBUDDY_API_KEY": "ab_live_...", "AIBUDDY_OUTPUT_DIR": "~/Pictures/AIBuddy" }
    }
  }
}
```

**Claude Code**

```bash
claude mcp add aibuddy -e AIBUDDY_API_KEY=ab_live_... -- node /absolute/path/to/aibuddy-mcp/bin/aibuddy-mcp.js
```

**Cursor** — `~/.cursor/mcp.json`, same `mcpServers` block as Claude Desktop.

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "aibuddy": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/aibuddy-mcp/bin/aibuddy-mcp.js"],
      "env": { "AIBUDDY_API_KEY": "ab_live_..." }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.aibuddy]
command = "node"
args = ["/absolute/path/to/aibuddy-mcp/bin/aibuddy-mcp.js"]
env = { AIBUDDY_API_KEY = "ab_live_..." }
```

Then ask: *"make a 16:9 hero image of a lighthouse at dusk, then turn it into a 5-second video."*

## CLI

```bash
aibuddy-mcp models
aibuddy-mcp image "a lighthouse at dusk, oil painting" --aspect 16:9 --out ./art
aibuddy-mcp edit room.jpg "furnish in warm modern style"
aibuddy-mcp video "slow drone push-in over the lighthouse" --image art/image-1.png --wait 300
aibuddy-mcp music "calm piano for a product demo" --instrumental --wait 300
aibuddy-mcp task task_video_abc123
```

Add `--json` for machine-readable output. Exit codes: `0` ok, `1` the API refused, `2` bad arguments.

## Configuration

| Variable | Meaning |
|---|---|
| `AIBUDDY_API_KEY` | Required for every tool except `list_models`. |
| `AIBUDDY_OUTPUT_DIR` | Where MCP mode saves images. The CLI defaults to the current directory. |
| `AIBUDDY_API_URL` | API root override (stage root, without `/v2`). |

## Protocol

Dual-era. Speaks MCP **2026-07-28** (stateless: `server/discover`, per-request `_meta`,
`resultType`, cacheable `tools/list`) and the legacy `initialize` handshake
(2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05) that most installed clients still use.
No runtime dependencies. Diagnostics go to stderr; stdout carries protocol bytes only.

## Development

```bash
npm test                     # from this directory
npm run test:aibuddy-mcp     # from the repository root
```
