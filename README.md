<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/graph.svg?title=opencode-dev-process&subtitle=Start+dev+servers+detached%2C+watch+them+in+the+sidebar&logo=nodejs&mode=dark&theme=zinc" />
    <img alt="opencode-dev-process" src="https://shieldcn.dev/header/graph.svg?title=opencode-dev-process&subtitle=Start+dev+servers+detached%2C+watch+them+in+the+sidebar&logo=nodejs&mode=light&theme=zinc" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/goeckenils/opencode-dev-process">
    <img alt="GitHub stars" src="https://shieldcn.dev/github/stars/goeckenils/opencode-dev-process.svg?variant=secondary" />
  </a>
  <a href="https://github.com/goeckenils/opencode-dev-process/blob/main/LICENSE">
    <img alt="License" src="https://shieldcn.dev/github/license/goeckenils/opencode-dev-process.svg?variant=secondary" />
  </a>
  <a href="https://github.com/goeckenils/opencode-dev-process/actions">
    <img alt="CI status" src="https://shieldcn.dev/github/ci/goeckenils/opencode-dev-process.svg?workflow=ci&branch=main" />
  </a>
  <a href="https://github.com/goeckenils/opencode-dev-process">
    <img alt="Last commit" src="https://shieldcn.dev/github/last-commit/goeckenils/opencode-dev-process.svg?variant=secondary" />
  </a>
  <a href="https://www.npmjs.com/package/opencode-dev-process">
    <img alt="npm version" src="https://shieldcn.dev/npm/opencode-dev-process.svg?variant=secondary" />
  </a>
</p>

<p align="center"><strong>Stop the agent-shell deadlock.</strong> When the AI agent runs <code>npm run dev</code>, the bash tool blocks until the 2-minute timeout — then the agent retries in a loop. This plugin intercepts those commands, starts the server as a detached background process, and shows every running dev server live in the OpenCode right sidebar with a kill button and log access.</p>

---

## What it does

- **Detached starts** — `npm run dev`, `next dev`, `vite`, `nodemon` and friends
  are rewritten on the fly into non-blocking background launches. The agent
  shell is released immediately instead of hanging.
- **Live sidebar block** — a "Dev Servers" block in the right sidebar lists
  every running server: command, port, PID, and a status dot. Polls every 3 s.
- **Kill + logs** — stop a server (kills the whole process tree) or open its
  stdout/stderr log files with one click.
- **Idempotent** — if a registered server already listens on the target port,
  the plugin leaves the command untouched and reports "already running"
  instead of starting a second copy.
- **External listeners** — servers started outside the plugin (on known dev
  ports) show up read-only, so a blocked port is never a mystery.
- **Cross-platform** — Windows (PowerShell) and macOS/Linux (nohup).

## Installation

Add the plugin to your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-dev-process"]
}
```

Or use a local checkout while developing:

```jsonc
{
  "plugin": ["file:///path/to/opencode-dev-process/src/server/index.ts"]
}
```

Restart OpenCode. The plugin ships two entry points — the server hooks and the
TUI sidebar block — installed together by the single package.

## Usage

Just ask the agent to start your dev server as usual:

```
start the dev server on port 3100
```

The agent runs `npm run dev -- -p 3100`; the plugin intercepts it, starts the
server detached, and answers:

```
✓ npm run dev -- -p 3100 is running on :3100 (PID 1234). Logs: ~/.config/opencode/process-logs/abc123.out.log
```

The "Dev Servers" block in the sidebar shows it live:

```
Dev Servers (1 running)
• npm run dev -- -p 3100 :3100 PID 1234 [log][✕]
```

Click `[✕]` to kill the process tree, `[log]` to open the log files.

## Configuration

All options are optional; defaults apply.

| Option | Default | Description |
|---|---|---|
| `allowlist` | `npm/pnpm/yarn/bun run dev\|start\|preview\|serve`, `next dev`, `vite`, `nodemon`, `npx … dev` | Commands treated as dev servers and started detached. |
| `registryPath` | `~/.config/opencode/processes.json` | Where the shared registry lives. |
| `logDir` | `~/.config/opencode/process-logs/` | Where per-process log files are written. |
| `maxRetentionSec` | `30` | How long a stopped entry stays in the sidebar before cleanup. |
| `devPorts` | `[3000, 3100, 5173, 8080, 4000, 5000, 8000, 4200, 5174, 8081]` | Ports scanned for external listeners. |
| `defaultPort` | `3000` | Port assumed when a dev command has no explicit port. |

Example:

```jsonc
{
  "plugin": [
    [
      "opencode-dev-process",
      {
        "allowlist": ["next dev", "vite"],
        "defaultPort": 3100
      }
    ]
  ]
}
```

## How it works

```
agent runs "npm run dev -- -p 3100"
        │
        ▼
┌─────────────────────┐   tool.execute.before   ┌──────────────────────┐
│  Server plugin      │ ──────────────────────▶ │ detect + rewrite     │
│  (bash tool hook)   │                         │ → detached start cmd │
└─────────────────────┘                         └──────────────────────┘
        │ tool.execute.after: parse result, write registry
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Registry file  ~/.config/opencode/processes.json           │
│  { entries: { id: { command, port, pid, logs, status } } } │
└─────────────────────────────────────────────────────────────┘
        ▲                                    │
        │ reads + reconciles                 │ kills / opens logs
┌───────┴───────────────┐          ┌─────────▼──────────┐
│  TUI plugin           │          │  OS (taskkill,     │
│  sidebar_content slot │          │  Start-Process,    │
│  poll every 3s        │          │  nohup, lsof, …)   │
└───────────────────────┘          └────────────────────┘
```

The **registry** is the single contract between the two plugin halves — a JSON
file written atomically by the server, read and reconciled by the TUI.

## Development

```bash
bun install
bun run lint        # oxlint
bun run typecheck   # tsc --noEmit
bun run test        # vitest
bun run build       # builds dist/server + dist/tui
```

Tests focus on the highest seam: the pure detection and rewrite functions
(`src/server/detect.ts`, `src/server/rewrite.ts`) plus registry read/write and
the OS probe helpers with injected execs.

## Roadmap

- [ ] npm publish automation on version tags
- [ ] Docker/WSL support
- [ ] Monitoring of non-dev processes

## License

[MIT](./LICENSE) © 2026 Nils Goecke

## Contributors

[![Contributors](https://shieldcn.dev/contributors/goeckenils/opencode-dev-process.svg)](https://github.com/goeckenils/opencode-dev-process/graphs/contributors)
