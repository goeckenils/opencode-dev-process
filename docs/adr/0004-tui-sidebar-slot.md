# ADR-0004 — TUI sidebar block via the `sidebar_content` slot

**Status:** Accepted

**Context:** The user wants running dev servers visible "on the right" in the
TUI. The TUI exposes plugin slots; the sidebar panel renders
`sidebar_title`, `sidebar_content`, and `sidebar_footer` slots.

**Decision:** The TUI plugin registers a `sidebar_content` slot block (order
`100`, above the internal MCP block) named "Dev Servers". It polls every 3 s:
reconciles registry entries against the OS (PID/port), renders running +
recently stopped entries with a status dot, marks external listeners
read-only, and offers a kill action (`[✕]`) and a log action (`[log]`) per
entry.

**Alternatives considered:**
- **`sidebar_footer` (single winner)** — already used by the built-in
  "Getting started" block; slot collision.
- **Bottom status bar** — too narrow for name + port + PID + actions.

**Consequences:** The block uses `sidebar_content` so it coexists with the MCP
block. Rendering is SolidJS within the TUI plugin runtime; OS probes are
injected for unit-testing. Kill + log actions are mouse-driven (`onMouseDown`),
consistent with other sidebar blocks.
