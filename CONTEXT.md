# Context — opencode-dev-process

A glossary of the domain terms used across this repository. Implementation
details live in the code and ADRs, not here.

## Glossary

| Term | Definition |
|---|---|
| **Detached start** | Launching a process so it keeps running after the tool call returns — stdout/stderr redirected to log files, no attached terminal. The opposite of a blocking/foreground start. |
| **Dev server** | A long-running process serving an application in development mode (e.g. `next dev`, `vite`, `npm run dev`). The plugin's primary target. |
| **Agent shell** | The shell the AI agent uses via the `bash` tool. A blocking command (like a bare `npm run dev`) hangs the tool call until timeout. |
| **Registry** | The shared JSON file (default `~/.config/opencode/processes.json`) that records every process the plugin started or observed. The single contract between the server plugin and the TUI plugin. |
| **Registry entry** | One record in the registry: id, command, cwd, port, pid, log paths, timestamps, status. |
| **Idempotent start** | Skipping a new start when a registered process already listens on the target port; reporting "already running" instead. |
| **External listener** | A process on a known dev port that was *not* started through the plugin (visible in the sidebar, not killable by it). |
| **Port poll** | The bounded wait loop after a detached start that confirms the listener is up before reporting success. |
| **Process tree** | The process plus its child processes. Killing the tree (`taskkill /T /F`, `kill -TERM -<pid>`) removes children (e.g. `node` under `npm.cmd`) too. |
| **Reconcile** | The TUI-side liveness pass that verifies running entries against the OS (PID/port) and marks dead ones as stopped. |
| **Prune** | Removing stopped entries older than the retention window from the registry. |

## Relationships

- A **dev server** becomes a **registry entry** when the **server plugin** performs a
  **detached start** via the `tool.execute` hooks.
- The **TUI plugin** reads the **registry**, runs **reconcile** against the OS, and
  renders entries in the sidebar; it can **kill** a process tree or **prune** stale entries.
- An **external listener** is observed by the TUI plugin's port scan and rendered
  read-only.
