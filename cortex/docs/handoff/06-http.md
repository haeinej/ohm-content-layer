# Brief: step 6, MCP over HTTP

Branch `http`. Read [README.md](README.md) first for the shared rules.

## Why

`cortex mcp` speaks MCP over standard input and output, which works for agents on the person's machine. Clients that connect to a remote server need MCP over HTTP: Claude in the browser, ChatGPT, and a coding agent on another machine.

## What to build

1. **`src/http.mjs`**: the MCP Streamable HTTP transport, using only `node:http`, around the same `createServer` handler in `src/protocol.mjs`. Read the transport section of the current MCP specification at modelcontextprotocol.io and follow it:
   - one endpoint;
   - JSON-RPC requests by POST;
   - a session ID header issued at `initialize` and required after;
   - answers as JSON.

   Server-sent events are needed only if the specification requires them for a server that never sends requests of its own. Each session gets its own tools, so a `cortex_forget` confirmation stays in the session it was issued in, and its agent name comes from that session's `initialize`, through `agentName` in `src/folder.mjs`.
2. **`cortex serve [dir] [--port 8765] [--host 127.0.0.1]`** in `bin/cortex.mjs`. It binds to `127.0.0.1` unless told otherwise.
3. **Sign-in, first version: a bearer token.**
   - The person creates it with `cortex token [dir]`, which writes a random token to `agents/secrets/mcp-token` and prints it once.
   - Every request must carry `Authorization: Bearer <token>`. Without it the answer is 401, and nothing about the cortex is revealed.
   - With no token file, `cortex serve` refuses to start unless `--host` is `127.0.0.1`, and says why.
   - The token is a secret: it lives in `agents/secrets/`, which git never takes and no tool returns.
4. **Docs.** Add how to connect over HTTP to `README.md`, for Claude Code (`claude mcp add --transport http … --header`) and Codex (`[mcp_servers.cortex] url = … http_headers = …`).

## Decision left open

ChatGPT and Claude's web connectors sign in with OAuth, not a fixed token. Supporting them needs:
- an OAuth authorization server;
- somewhere to host it with a public address.

That is a decision for the person, and not part of this brief. Write what it would take in your pull request description.

## Your files

`src/http.mjs`, `test/http.test.mjs`. The shared files as the README allows (`bin/cortex.mjs`, `README.md`, `docs/plan.md`).

## Done when

`npm test` passes, with tests that start the server on a free port and, over real HTTP:
- `initialize` returns the short instructions and a session ID;
- `tools/call cortex_start` returns the playbook;
- a request without the token gets 401;
- a request with an unknown session ID is refused;
- two sessions keep separate agent names.

## Not in scope

OAuth, TLS, and hosting.
