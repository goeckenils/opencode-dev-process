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

## Update — wrapper-aware detection (no AGENTS.md instruction required)

The plugin must work without any AGENTS.md instruction telling the agent to
type a bare `npm run dev`. Real agents wrap dev-server commands in shell
syntax (`cmd /c start /B …`, `Start-Process -FilePath … -ArgumentList …`,
`powershell -Command "…"`, `$` prompt echoes). The detection therefore unwraps
known wrapper prefixes before matching the allowlist:

- `detect.ts` `unwrapCommand` recursively strips `cmd /c`, `start /B`,
  `powershell -Command/-c`, `&`/`;`/`|` prefixes, `$` prompts, and reconstructs
  `Start-Process -FilePath X -ArgumentList …` into `X <args…>` (with `.cmd`/
  `.exe` suffixes normalised). A balanced outer quote pair is stripped last.
- The port is extracted from the unwrapped command (quotes in the raw command
  can hide `-p 3100` from the raw regex).
- `DetectResult.canonical` carries the normalised inner command; the rewrite
  and registry use it instead of the raw wrapper string, so the generated
  detached start is clean (no nested `cmd /c start /B`).

The allowlist is still anchored to the command start and the blocklist still
rejects `vite build`, `nodemon --version`, `npm run test`, `grep vite`, so
non-dev invocations are not hijacked.
