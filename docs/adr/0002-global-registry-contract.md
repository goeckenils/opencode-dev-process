# ADR-0002 — Global registry file with atomic writes as the server→TUI contract

**Status:** Accepted

**Context:** The server plugin and the TUI plugin run in separate processes
with independent working directories. The TUI needs to know what the server
started, and both may write (start, kill, reconcile). We need one shared,
observable source of truth.

**Decision:** Both plugins communicate through a single JSON registry file at
`~/.config/opencode/processes.json` (configurable). Writes are atomic
(temp-file + rename) and follow a read-modify-write merge so concurrent
writers do not corrupt the file. Defaults keep log files next to it under
`~/.config/opencode/process-logs/`.

**Alternatives considered:**
- **Per-project `.opencode/processes.json`** — tidier per project, but the two
  processes can resolve different project directories, breaking visibility.
- **In-memory only** — the TUI process can't read the server's memory.

**Consequences:** A single file is the contract; the schema lives in
`src/shared/types.ts`. A lost update is possible if two writers race within
the read+write window of one write; acceptable for a single-user tool.
