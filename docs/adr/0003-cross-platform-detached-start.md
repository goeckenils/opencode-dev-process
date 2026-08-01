# ADR-0003 — Cross-platform detached start: generated PowerShell script vs `nohup`

**Status:** Accepted

**Context:** The user works on Windows (PowerShell), but the plugin should
work on macOS/Linux too. A bare `npm run dev` (or `Start-Process` without
redirects) keeps stdout/stderr attached to the agent shell, so the tool call
blocks until the server exits.

**Decision:** The server plugin generates platform-specific detached-start
commands:
- **Windows:** a PowerShell `.ps1` script (kills an existing listener on the
  target port, starts `cmd.exe /d /s /c <command>` detached via
  `Start-Process` with `-RedirectStandardOutput/Error -WindowStyle Hidden`,
  then polls the port bounded). The `bash` tool runs
  `powershell.exe -NoProfile -File <script>`.
- **POSIX:** a `nohup sh -c '<command>' > log 2> log < /dev/null &` command
  with the same bounded port poll.

**Alternatives considered:**
- Inline `Start-Process` in one long shell line — brittle quoting across
  cmd→PowerShell; a generated `.ps1` file avoids that.
- Bundling a PTY dependency (e.g. `bun-pty`) — heavier, not needed for
  fire-and-forget servers.

**Consequences:** One code path per platform in `src/server/rewrite.ts`,
unit-tested as pure string builders. Windows-specific behaviour (hidden
window, `cmd.exe` wrapper) is encapsulated in the generated script.
