export interface RewriteInput {
  /** The original command the agent typed, e.g. "npm run dev -- -p 3100". */
  command: string
  /** Working directory the process should start in. */
  cwd: string
  /** Absolute path to the stdout log file. */
  logOut: string
  /** Absolute path to the stderr log file. */
  logErr: string
  /** Absolute path to the generated PowerShell script (Windows only). */
  scriptPath: string
  /** Detected port, if any. */
  port?: number
}

export interface RewriteResult {
  /** The command string the bash tool will execute. */
  command: string
  /** Generated Windows PowerShell script content (Windows only). */
  windowsScript?: string
}

export const POLL_ATTEMPTS = 15
export const POLL_INTERVAL_SEC = 1

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Builds the PowerShell `.ps1` content for a detached start on Windows. */
export function buildWindowsScript(input: RewriteInput): string {
  const port = input.port
  const lines: string[] = []
  lines.push("$ErrorActionPreference = 'SilentlyContinue'")
  lines.push(`$logOut = ${psQuote(input.logOut)}`)
  lines.push(`$logErr = ${psQuote(input.logErr)}`)

  if (port !== undefined) {
    lines.push("")
    lines.push(`# Free the target port if a listener is present`)
    lines.push(
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
        `ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
    )
  }

  lines.push("")
  lines.push("# Start the dev server detached with redirected output")
  lines.push(
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',${psQuote(input.command)} ` +
      `-WorkingDirectory ${psQuote(input.cwd)} ` +
      `-RedirectStandardOutput $logOut -RedirectStandardError $logErr ` +
      `-WindowStyle Hidden -PassThru`,
  )

  lines.push("")
  if (port !== undefined) {
    lines.push(`# Bounded poll until the listener is up`)
    lines.push("$pidFound = $null")
    lines.push(`for ($i = 0; $i -lt ${POLL_ATTEMPTS}; $i++) {`)
    lines.push(
      `  $c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    )
    lines.push("  if ($c) { $pidFound = $c.OwningProcess; break }")
    lines.push(`  Start-Sleep -Seconds ${POLL_INTERVAL_SEC}`)
    lines.push("}")
    lines.push("if ($pidFound) {")
    lines.push('  Write-Output "UP PID $pidFound"')
    lines.push("} else {")
    lines.push('  Write-Output "SPAWNED $($p.Id)"')
    lines.push("}")
  } else {
    lines.push("# No port known; verify the spawned process is still alive")
    lines.push(`Start-Sleep -Seconds ${POLL_INTERVAL_SEC}`)
    lines.push("$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue")
    lines.push("if ($alive) {")
    lines.push('  Write-Output "SPAWNED $($p.Id)"')
    lines.push("} else {")
    lines.push('  Write-Output "FAILED"')
    lines.push("}")
  }

  return lines.join("\n")
}

/** Builds the POSIX shell command for a detached start. */
export function buildPosixCommand(input: RewriteInput): string {
  const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const port = input.port
  const parts: string[] = []
  parts.push(
    `nohup sh -c ${shQuote(input.command)} > ${shQuote(input.logOut)} 2> ${shQuote(input.logErr)} < /dev/null &`,
  )
  parts.push(`spawned=$!`)
  if (port !== undefined) {
    parts.push(`for i in $(seq 1 ${POLL_ATTEMPTS}); do`)
    parts.push(
      `  pid=$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || ss -ltnp 2>/dev/null | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)`,
    )
    parts.push(`  if [ -n "$pid" ]; then echo "UP PID $pid"; exit 0; fi`)
    parts.push(`  sleep ${POLL_INTERVAL_SEC}`)
    parts.push(`done`)
    parts.push(`echo "SPAWNED $spawned"`)
  } else {
    parts.push(`sleep ${POLL_INTERVAL_SEC}`)
    parts.push(`if kill -0 $spawned 2>/dev/null; then echo "SPAWNED $spawned"; else echo "FAILED"; fi`)
  }
  return parts.join("\n")
}

/** Builds the final command string the bash tool will run. */
export function buildRewriteCommand(input: RewriteInput, platform: NodeJS.Platform): RewriteResult {
  if (platform === "win32") {
    const script = buildWindowsScript(input)
    const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${JSON.stringify(input.scriptPath)}`
    return { command, windowsScript: script }
  }
  return { command: buildPosixCommand(input) }
}
