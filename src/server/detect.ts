export interface DetectResult {
  /** True when the command should be started detached. */
  matched: boolean
  /** The detected port from the command, if any. */
  port?: number
  /** Normalized base command, e.g. "npm run dev". */
  base: string
}

export interface DetectInput {
  command: string
  allowlist: string[]
  defaultPort: number
}

/** Sub-commands/args that mean the matched binary is NOT a dev server. */
const BLOCKLIST = new Set([
  "build",
  "test",
  "lint",
  "typecheck",
  "tsc",
  "--version",
  "-v",
  "--help",
  "-h",
  "--list",
  "create",
  "init",
  "add",
  "remove",
  "uninstall",
  "install",
])

const PORT_PATTERNS: RegExp[] = [
  /(?:^|\s)-p\s+(\d{1,5})(?:\s|$)/,
  /(?:^|\s)--port\s+(\d{1,5})(?:\s|$)/,
  /(?:^|\s)--port=(\d{1,5})(?:\s|$)/,
  /(?:^|\s)--\s+-p\s+(\d{1,5})(?:\s|$)/,
  /PORT=(\d{1,5})(?:\s|$)/,
]

export function extractPort(command: string): number | undefined {
  for (const pattern of PORT_PATTERNS) {
    const match = command.match(pattern)
    if (match?.[1]) {
      const value = Number(match[1])
      if (value > 0 && value < 65536) return value
    }
  }
  return undefined
}

/** Lowercases and collapses whitespace, strips surrounding quotes. */
export function normalizeCommand(command: string): string {
  return command.replace(/["'`]/g, "").replace(/\s+/g, " ").trim()
}

/** Strips leading env assignments (VAR=value …) so the command starts at the binary. */
function stripEnvPrefix(command: string): string {
  return command.replace(/^(?:\s*[A-Za-z_][A-Za-z0-9_]*=(\S+)\s*)+/, "")
}

/** Returns the first whitespace-delimited token after the matched allowlist item, if any. */
function nextToken(command: string, prefix: string): string | undefined {
  const rest = command.slice(prefix.length).trimStart()
  const token = rest.split(/\s+/)[0]
  return token ?? undefined
}

export function detectDevServer(input: DetectInput): DetectResult {
  const normalized = normalizeCommand(input.command)
  const withoutEnv = stripEnvPrefix(normalized)
  const port = extractPort(input.command)

  for (const item of input.allowlist) {
    // Anchor the allowlist item to the command start (after any env prefix).
    const pattern = new RegExp(`^${escapeRegExp(item)}(?:\\s|$)`)
    const match = withoutEnv.match(pattern)
    if (!match) continue

    // Reject clearly non-dev invocations (vite build, nodemon --version, npm run test…).
    const token = nextToken(withoutEnv, match[0].trimEnd())
    if (token && BLOCKLIST.has(token)) continue

    return { matched: true, port: port ?? input.defaultPort, base: item }
  }

  return { matched: false, port, base: normalized }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
