import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Options, Registry, RegistryEntry } from "../shared/types"
import { resolveOptions } from "../shared/paths"
import { pruneRegistry, readRegistry, writeRegistry } from "../server/registry"

const execFileAsync = promisify(execFile)

export type ExecFn = (command: string, args: string[], timeoutMs: number) => Promise<string>

const defaultExec: ExecFn = async (command, args, timeoutMs) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
    })
    return stdout
  } catch {
    return ""
  }
}

/** True when a listener is bound on the given port. */
export async function isPortListening(port: number, exec: ExecFn = defaultExec): Promise<boolean> {
  if (process.platform === "win32") {
    const out = await exec(
      "powershell.exe",
      ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`],
      5000,
    )
    return out.trim().length > 0
  }
  const out = await exec("/bin/sh", ["-c", `lsof -iTCP:${port} -sTCP:LISTEN 2>/dev/null | head -1`], 5000)
  return out.trim().length > 0
}

/** True when a process with the given pid exists. */
export async function isPidAlive(pid: number, exec: ExecFn = defaultExec): Promise<boolean> {
  if (process.platform === "win32") {
    const out = await exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 5000)
    return out.includes(`"${pid}"`)
  }
  const out = await exec("/bin/sh", ["-c", `kill -0 ${pid} 2>/dev/null && echo alive`], 5000)
  return out.includes("alive")
}

/**
 * Reconciles registry liveness against the OS and persists any status change.
 * Running entries that are no longer alive become "stopped". Stale stopped
 * entries are pruned after the retention window.
 */
export async function reconcile(
  registryPath: string,
  options: Pick<Required<Options>, "maxRetentionSec">,
  exec: ExecFn = defaultExec,
): Promise<Registry> {
  const registry = await readRegistry(registryPath)
  let changed = false
  for (const entry of Object.values(registry.entries)) {
    if (entry.status !== "running") continue
    const alive = entry.pid ? await isPidAlive(entry.pid, exec) : entry.port ? await isPortListening(entry.port, exec) : false
    if (!alive) {
      entry.status = "stopped"
      entry.lastSeen = Date.now()
      changed = true
    }
  }
  if (changed) await writeRegistry(registryPath, registry)
  // Retire stopped entries older than the retention window.
  return pruneRegistry(registryPath, options, async (entry) =>
    entry.pid ? isPidAlive(entry.pid, exec) : entry.port ? isPortListening(entry.port, exec) : false,
  )
}

/** Scans configured dev ports for listeners not tracked in the registry (parallel). */
export async function scanExternal(options: Required<Options>, registry: Registry, exec: ExecFn = defaultExec) {
  const trackedPorts = new Set(Object.values(registry.entries).map((e) => e.port).filter((p): p is number => p !== undefined))
  const candidates = options.devPorts.filter((port) => !trackedPorts.has(port))

  const listening = await Promise.all(
    candidates.map(async (port) => ({ port, up: await isPortListening(port, exec) })),
  )

  return listening
    .filter((item) => item.up)
    .map<RegistryEntry>((item) => ({
      id: `external:${item.port}`,
      command: `listener on :${item.port}`,
      cwd: "",
      port: item.port,
      status: "running",
      startedAt: Date.now(),
      lastSeen: Date.now(),
      external: true,
    }))
}

/** Kills a process tree by pid and marks the registry entry stopped. */
export async function killEntry(registryPath: string, id: string, exec: ExecFn = defaultExec): Promise<void> {
  const registry = await readRegistry(registryPath)
  const entry = registry.entries[id]
  if (!entry?.pid) return

  if (process.platform === "win32") {
    await exec("taskkill", ["/PID", String(entry.pid), "/T", "/F"], 10000)
  } else {
    await exec(
      "/bin/sh",
      ["-c", `kill -TERM -- -${entry.pid} 2>/dev/null; kill -TERM ${entry.pid} 2>/dev/null; pkill -TERM -P ${entry.pid} 2>/dev/null`],
      5000,
    )
  }

  registry.entries[id] = { ...entry, status: "stopped", lastSeen: Date.now() }
  await writeRegistry(registryPath, registry)
}

/** Opens a file with the platform default handler. */
export function openFile(file: string): void {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file]
  execFile(cmd, args, { windowsHide: true, detached: true, stdio: "ignore" } as never).unref()
}

export function loadOptions(raw: Record<string, unknown> | undefined): Required<Options> {
  return resolveOptions(raw as Options)
}

export function entriesOf(registry: Registry): RegistryEntry[] {
  return Object.values(registry.entries)
}
