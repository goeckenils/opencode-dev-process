import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "os"
import path from "path"
import crypto from "node:crypto"
import type { Options } from "../shared/types"

const execFileAsync = promisify(execFile)

export function makeId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function resolveLogPaths(logDir: string, id: string): { logOut: string; logErr: string; scriptPath: string } {
  return {
    logOut: path.join(logDir, `${id}.out.log`),
    logErr: path.join(logDir, `${id}.err.log`),
    scriptPath: path.join(logDir, `${id}.ps1`),
  }
}

export interface ParsedStart {
  ok: boolean
  upPid?: number
  spawnedPid?: number
  failed: boolean
  /** Raw normalized output for diagnostics. */
  raw: string
}

/** Parses the machine-readable output produced by the generated start script. */
export function parseStartOutput(output: string): ParsedStart {
  const raw = output.trim()
  const up = raw.match(/UP PID (\d+)/)
  if (up?.[1]) return { ok: true, upPid: Number(up[1]), failed: false, raw }
  const spawned = raw.match(/SPAWNED (\d+)/)
  if (spawned?.[1]) return { ok: true, spawnedPid: Number(spawned[1]), failed: false, raw }
  if (raw.includes("FAILED")) return { ok: false, failed: true, raw }
  return { ok: false, failed: false, raw }
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export type ExecFn = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<ExecResult>

const defaultExec: ExecFn = async (command, args, cwd, timeoutMs) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : "",
      stderr: typeof err.stderr === "string" ? err.stderr : "",
      exitCode: typeof err.code === "number" ? err.code : null,
    }
  }
}

export interface SpawnOptions extends Pick<Required<Options>, "logDir"> {
  exec?: ExecFn
}

/**
 * Runs the generated detached-start command and parses the result.
 * The bash tool never executes the raw command; this runs the rewrite directly.
 */
export async function runDetached(
  command: string,
  cwd: string,
  timeoutMs: number,
  options: SpawnOptions,
): Promise<ParsedStart> {
  const exec = options.exec ?? defaultExec

  let result: ExecResult
  if (process.platform === "win32") {
    result = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command], cwd, timeoutMs)
  } else {
    result = await exec("/bin/sh", ["-c", command], cwd, timeoutMs)
  }

  return parseStartOutput(`${result.stdout}\n${result.stderr}`)
}

/**
 * Checks whether a listener is bound on the given port and returns its pid.
 * Cross-platform via injected exec for testability.
 */
export async function findPortPid(port: number, exec: ExecFn = defaultExec): Promise<number | undefined> {
  try {
    if (process.platform === "win32") {
      const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1`
      const result = await exec("powershell.exe", ["-NoProfile", "-Command", script], os.homedir(), 5000)
      const pid = Number(result.stdout.trim().split(/\r?\n/)[0])
      return Number.isInteger(pid) && pid > 0 ? pid : undefined
    }
    const result = await exec("/bin/sh", ["-c", `lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null | head -1`], os.homedir(), 5000)
    const pid = Number(result.stdout.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

export async function isProcessAlive(pid: number, exec: ExecFn = defaultExec): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const result = await exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], os.homedir(), 5000)
      return result.stdout.includes(`"${pid}"`)
    }
    const result = await exec("/bin/sh", ["-c", `kill -0 ${pid} 2>/dev/null && echo alive`], os.homedir(), 5000)
    return result.stdout.includes("alive")
  } catch {
    return false
  }
}

export async function killProcessTree(pid: number, exec: ExecFn = defaultExec): Promise<void> {
  try {
    if (process.platform === "win32") {
      await exec("taskkill", ["/PID", String(pid), "/T", "/F"], os.homedir(), 10000)
    } else {
      await exec("/bin/sh", ["-c", `kill -TERM -${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`], os.homedir(), 5000)
    }
  } catch {
    // Best effort; the registry liveness check reconciles afterwards.
  }
}
