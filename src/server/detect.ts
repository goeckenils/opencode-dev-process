export interface DetectResult {
  /** True when the command should be started detached. */
  matched: boolean
  /** The detected port from the command, if any. */
  port?: number
  /** Normalized base command, e.g. "npm run dev". */
  base: string
  /** The normalized inner dev command after unwrapping shell wrappers. */
  canonical?: string
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

/**
 * Splits a quoted command string into tokens, honoring double and single quotes.
 * Used to reconstruct `Start-Process -ArgumentList` values into a command line.
 */
export function tokenizeQuoted(command: string): string[] {
  const tokens: string[] = []
  // Match double/single-quoted strings OR bare tokens, skipping separators (commas/whitespace).
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s,]+)/g
  for (const match of command.matchAll(re)) {
    const token = match[1] ?? match[2] ?? match[3]
    if (token !== undefined) tokens.push(token)
  }
  return tokens
}

/**
 * Extracts the inner command from a `Start-Process -FilePath X -ArgumentList ...`
 * invocation by reconstructing `X <args…>` from the flag values.
 */
export function unwrapStartProcess(command: string): string | undefined {
  const m = command.match(/^Start-Process\s+(.*)$/i)
  if (!m) return undefined

  const body = m[1]!
  const filePath = body.match(/-FilePath\s+(?:"([^"]*)"|'([^']*)'|(\S+))/i)
  if (!filePath) return undefined
  const rawExe = filePath[1] ?? filePath[2] ?? filePath[3]
  if (!rawExe) return undefined
  // `Start-Process -FilePath "npm.cmd"` → treat as `npm` for allowlist matching.
  const exe = rawExe.replace(/\.(?:cmd|exe)$/i, "")

  // ArgumentList: a comma-separated list of quoted strings (optionally a single
  // quoted string). Stop before the next PowerShell flag (-Flag) or end.
  const argsMatch = body.match(
    /-ArgumentList\s+((?:"[^"]*"|'[^']*')(?:\s*,\s*(?:"[^"]*"|'[^']*'))*)/i,
  )
  const tokens = argsMatch?.[1] ? tokenizeQuoted(argsMatch[1]) : []
  const rest = [exe, ...tokens].join(" ")
  return rest
}

/**
 * Recursively strips common shell wrappers from the front of a command until
 * stable. Handles cmd /c, start /B, powershell -Command/-c, `&`/`;`/`|` prefixes,
 * `$` prompt echoes, and the `Start-Process -FilePath … -ArgumentList …` form.
 */
export function unwrapCommand(command: string): string {
  let current = command.trim()
  const seen = new Set<string>()

  while (!seen.has(current)) {
    seen.add(current)

    // $ prompt echo
    if (/^\$\s+/.test(current)) {
      current = current.replace(/^\$\s+/, "")
      continue
    }

    // PowerShell variable assignment prefix: `$var = "…"; $var = $other; $var = 1; `
    // Only strip when a Start-Process call or another assignment follows, so a
    // lone `$x = "npm run dev"` is not mistaken for a dev-server start.
    const assign = current.match(/^\$[A-Za-z_]\w*\s*=\s*[^;]*;\s*/)
    if (assign) {
      const rest = current.slice(assign[0].length)
      if (/^\$[A-Za-z_]\w*\s*=\s*(?:Start-Process\s|"|'|\$)/i.test(rest) || /^Start-Process/i.test(rest)) {
        current = rest
        continue
      }
    }

    // $proc = Start-Process … — assignment directly before the call.
    const spAssign = current.match(/^\$[A-Za-z_]\w*\s*=\s*(Start-Process\s+.*)$/i)
    if (spAssign?.[1]) {
      current = spAssign[1]
      continue
    }

    // & ; | separators at the start
    const sep = current.match(/^[&;|]\s+/)
    if (sep) {
      current = current.slice(sep[0].length)
      continue
    }

    // cmd /c "start /B …" / cmd.exe /c … / cmd /d /s /c …
    const cmd = current.match(
      /^cmd(?:\.exe)?\s+\/d\s+\/s\s+\/c\s+/i,
    ) ?? current.match(/^cmd(?:\.exe)?\s+\/c\s+/i)
    if (cmd) {
      const hadLeadingQuote = /^["']/.test(current.slice(cmd[0].length))
      current = current.slice(cmd[0].length).replace(/^["']/, "")
      // A trailing quote closes the cmd /c "…" wrapper — but only if the wrapper
      // actually opened with a quote. Never strip an ArgumentList's trailing quote.
      if (hadLeadingQuote && !/^Start-Process/i.test(current)) current = current.replace(/["']$/, "")
      continue
    }

    // start /B …
    const startB = current.match(/^start\s+\/b\s+/i)
    if (startB) {
      const hadLeadingQuote = /^["']/.test(current.slice(startB[0].length))
      current = current.slice(startB[0].length).replace(/^["']/, "")
      if (hadLeadingQuote && !/^Start-Process/i.test(current)) current = current.replace(/["']$/, "")
      continue
    }

    // powershell [-NoProfile …] -Command "<…>" / -c "<…>"
    const ps = current.match(/^powershell(?:\.exe)?\s+(?:-[A-Za-z]+\s+)*-Command\s+/i) ??
      current.match(/^powershell(?:\.exe)?\s+(?:-[A-Za-z]+\s+)*-c\s+/i)
    if (ps) {
      const hadLeadingQuote = /^["']/.test(current.slice(ps[0].length))
      current = current.slice(ps[0].length).replace(/^["']/, "")
      if (hadLeadingQuote && !/^Start-Process/i.test(current)) current = current.replace(/["']$/, "")
      continue
    }

    // Start-Process -FilePath X -ArgumentList …
    const sp = unwrapStartProcess(current)
    if (sp) {
      current = sp
      continue
    }

    break
  }

  // Strip a balanced pair of surrounding quotes (e.g. cmd /c "…").
  if (current.length >= 2) {
    const first = current[0]
    const last = current[current.length - 1]
    if (first === last && (first === '"' || first === "'")) {
      current = current.slice(1, -1)
    }
  }

  return current
}

export function detectDevServer(input: DetectInput): DetectResult {
  const normalized = normalizeCommand(input.command)
  const unwrapped = unwrapCommand(input.command)
  const withoutEnv = stripEnvPrefix(normalizeCommand(unwrapped))
  const port = extractPort(unwrapped) ?? extractPort(input.command)

  for (const item of input.allowlist) {
    // Anchor the allowlist item to the command start (after any env prefix).
    const pattern = new RegExp(`^${escapeRegExp(item)}(?:\\s|$)`)
    const match = withoutEnv.match(pattern)
    if (!match) continue

    // Reject clearly non-dev invocations (vite build, nodemon --version, npm run test…).
    const token = nextToken(withoutEnv, match[0].trimEnd())
    if (token && BLOCKLIST.has(token)) continue

    return { matched: true, port: port ?? input.defaultPort, base: item, canonical: withoutEnv }
  }

  return { matched: false, port, base: normalized }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
