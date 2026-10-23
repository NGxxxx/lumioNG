# Using LumioNG with AI assistants (MCP)

LumioNG has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server. When it is
on, an AI assistant on your computer can list, inspect and query the MongoDB connections you have
open in LumioNG — with the same credentials, SSH tunnels and read-only settings, and without you
pasting connection strings into another tool.

## Turning it on

1. **Tools → MCP server** toggles the server. **Tools → MCP settings…** (or the command palette)
   opens the full settings.
2. The server listens on `http://127.0.0.1:7737/mcp` by default. Change the port in the settings if
   it is taken.
3. An **access token** is generated on first use. Every request must send
   `Authorization: Bearer <token>`. *Regenerate* invalidates it immediately.
4. While it runs, an **MCP** indicator appears in the status bar; click it to see recent tool calls.

The setting is remembered: if the server was on when you quit, it starts again with the app.

## Connecting a client

The settings dialog shows a ready-to-copy snippet for each client, with your port and token filled
in. For reference:

**Claude Code**

```sh
claude mcp add --transport http lumiong http://127.0.0.1:7737/mcp --header "Authorization: Bearer <token>"
```

**Claude Desktop** (`claude_desktop_config.json`, via the `mcp-remote` bridge)

```json
{
  "mcpServers": {
    "lumiong": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:7737/mcp", "--header", "Authorization:${LUMIO_AUTH}"],
      "env": { "LUMIO_AUTH": "Bearer <token>" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`)

```json
{ "mcpServers": { "lumiong": { "url": "http://127.0.0.1:7737/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "lumiong": { "type": "http", "url": "http://127.0.0.1:7737/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

## Tools

| Tool | What it does |
|---|---|
| `list_connections` | Open connections (id, label, environment, read-only) |
| `list_databases` | Databases of a connection |
| `list_collections` | Collections and views of a database |
| `find` | Filter / projection / sort / skip / limit (≤ 100 documents) |
| `aggregate` | Run a pipeline (≤ 100 documents; `$out`/`$merge` only with writes allowed) |
| `count_documents` | Count matching documents |
| `collection_schema` | Field paths, BSON types and presence from a random sample |
| `list_indexes` | Index definitions |
| `explain` | Winning plan's stages and indexes for a find or pipeline (queryPlanner) |
| `insert_documents` * | Insert up to 1 000 documents |
| `update_documents` * | Update one / many documents matching a non-empty filter |
| `delete_documents` * | Delete one / many documents matching a non-empty filter |

\* Only listed when **Allow writes** is on. Writes also need the connection's MCP access set to
*write*, and are always refused on read-only connections and on connections labelled *production*.
Connections whose MCP access is *off* are not listed at all. Values of fields matching your
redaction patterns come back as `"[redacted]"` and cannot be filtered or aggregated on. Writes made
through MCP are recorded in the audit log (reads too, if you turn that on).

`connection` may be omitted when only one connection is open; otherwise pass its id or label.
Arguments accept Extended JSON (`{"_id": {"$oid": "…"}}`, `{"$date": "…"}`); results are returned as
Relaxed Extended JSON.

## Security model

- Listens on the loopback interface only; nothing on your network can reach it.
- Bearer token on every request; requests from web pages with a non-local `Origin` are rejected.
- Read-only by default. Results are capped (100 documents, 200 KB) and every operation has a 30 s
  server-side time limit.
- The assistant only sees connections you have open in LumioNG, and loses access when you close
  them or turn the server off.

Treat the token like a password: anyone who can run code on your machine *and* has the token can use
the open connections with the permissions of their MongoDB users.
