import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import type { Options, Registry, RegistryEntry } from "../shared/types"
import { resolveOptions } from "../shared/paths"
import { readRegistry, writeRegistry } from "../server/registry"

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
 * Reconciles registry liveness against the OS and returns a fresh view.
 * Running entries that are no longer alive become "stopped". Entries whose
 * port is now bound by a different process are also flagged stopped.
 */
export async function reconcile(registryPath: string, exec: ExecFn = defaultExec): Promise<Registry> {
  const registry = await readRegistry(registryPath)
  for (const entry of Object.values(registry.entries)) {
    if (entry.status !== "running") continue
    const alive = entry.pid ? await isPidAlive(entry.pid, exec) : entry.port ? await isPortListening(entry.port, exec) : false
    if (!alive) {
      entry.status = "stopped"
      entry.lastSeen = Date.now()
    }
  }
  return registry
}

/** Scans configured dev ports for listeners not tracked in the registry. */
export async function scanExternal(options: Required<Options>, registry: Registry, exec: ExecFn = defaultExec) {
  const external: RegistryEntry[] = []
  for (const port of options.devPorts) {
    if (Object.values(registry.entries).some((e) => e.port === port)) continue
    if (await isPortListening(port, exec)) {
      external.push({
        id: `external:${port}`,
        command: `listener on :${port}`,
        cwd: "",
        port,
        status: "running",
        startedAt: Date.now(),
        lastSeen: Date.now(),
        external: true,
      })
    }
  }
  return external
}

/** Kills a process tree by pid and marks the registry entry stopped. */
export async function killEntry(registryPath: string, id: string, exec: ExecFn = defaultExec): Promise<void> {
  const registry = await readRegistry(registryPath)
  const entry = registry.entries[id]
  if (!entry?.pid) return

  if (process.platform === "win32") {
    await exec("taskkill", ["/PID", String(entry.pid), "/T", "/F"], 10000)
  } else {
    await exec("/bin/sh", ["-c", `kill -TERM -${entry.pid} 2>/dev/null; kill -TERM ${entry.pid} 2>/dev/null`], 5000)
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

export async function readEntries(path: string): Promise<RegistryEntry[]> {
  try {
    const raw = await fs.readFile(path, "utf8")
    const parsed = JSON.parse(raw) as Registry
    return Object.values(parsed.entries ?? {})
  } catch {
    return []
  }
}
