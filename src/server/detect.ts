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

export function detectDevServer(input: DetectInput): DetectResult {
  const normalized = normalizeCommand(input.command)
  const port = extractPort(input.command)

  for (const item of input.allowlist) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(item)}(?:\\s|$|\\s+-)`)
    if (pattern.test(normalized)) {
      return { matched: true, port, base: item }
    }
  }

  return { matched: false, port, base: normalized }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
