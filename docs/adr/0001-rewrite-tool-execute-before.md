# ADR-0001 — Rewrite dev-server commands in `tool.execute.before` instead of a custom tool

**Status:** Accepted

**Context:** The agent tends to run `npm run dev` directly through the `bash`
tool, which blocks the tool call until the 2-minute timeout, then retries —
stuck in a loop. We need to make dev-server starts non-blocking without
teaching the agent a new workflow.

**Decision:** The server plugin hooks `tool.execute.before` for `tool ===
"bash"`, detects allowlisted dev-server commands, and rewrites
`output.args.command` into a detached-start script. `tool.execute.after`
parses the result and writes the registry.

**Alternatives considered:**
- **Custom tool (`dev_server`)** — explicit and controllable, but the agent
  must learn to use it; it would still occasionally run `npm run dev` directly
  and block.
- **Instructions/AGENTS.md only** — a shell-strategy document; relies on the
  agent complying and doesn't fix a direct `npm run dev`.

**Consequences:** Transparent for the agent — it types `npm run dev` and gets
back a clean "running on :3100 (PID …)" summary. The trade-off is magic: the
agent may not realise the process is detached, so the clean summary and the
sidebar block exist to close that gap.
