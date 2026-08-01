import fs from "node:fs/promises"
import path from "path"
import crypto from "node:crypto"
import type { Options, Registry, RegistryEntry } from "../shared/types"

/** Serializes read-modify-write cycles per registry path (in-process). */
const writeQueues = new Map<string, Promise<unknown>>()

function withQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  writeQueues.set(key, next.catch(() => {}))
  return next
}

export function emptyRegistry(): Registry {
  return { version: 1, entries: {} }
}

export async function readRegistry(registryPath: string): Promise<Registry> {
  try {
    const raw = await fs.readFile(registryPath, "utf8")
    const parsed = JSON.parse(raw) as Registry
    if (!parsed || parsed.version !== 1 || !parsed.entries) return emptyRegistry()
    return parsed
  } catch {
    return emptyRegistry()
  }
}

/**
 * Writes the registry atomically: write to a unique temp file in the same
 * directory, then rename over the target. Concurrent writers are serialized
 * per path through an in-process queue.
 */
export async function writeRegistry(registryPath: string, registry: Registry): Promise<void> {
  const dir = path.dirname(registryPath)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(registryPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`)
  try {
    await fs.writeFile(temp, JSON.stringify(registry, null, 2), "utf8")
    await fs.rename(temp, registryPath)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}

export async function upsertEntry(registryPath: string, entry: RegistryEntry): Promise<Registry> {
  return withQueue(registryPath, async () => {
    const registry = await readRegistry(registryPath)
    registry.entries[entry.id] = entry
    await writeRegistry(registryPath, registry)
    return registry
  })
}

/**
 * Purges stopped entries older than maxRetentionSec and reconciles liveness
 * using the provided predicate. Returns the pruned registry.
 */
export async function pruneRegistry(
  registryPath: string,
  options: Pick<Required<Options>, "maxRetentionSec">,
  isAlive: (entry: RegistryEntry) => Promise<boolean>,
): Promise<Registry> {
  return withQueue(registryPath, async () => {
    const registry = await readRegistry(registryPath)
    const now = Date.now()
    const retained = new Map<string, RegistryEntry>()

    for (const [id, entry] of Object.entries(registry.entries)) {
      const stopped = entry.status === "stopped"
      const stale = now - entry.lastSeen > options.maxRetentionSec * 1000

      if (stopped && stale) continue

      if (entry.status === "running" && entry.pid) {
        const alive = await isAlive(entry)
        if (!alive) {
          retained.set(id, { ...entry, status: "stopped", lastSeen: now })
          continue
        }
      }

      retained.set(id, entry)
    }

    registry.entries = Object.fromEntries(retained)
    await writeRegistry(registryPath, registry)
    return registry
  })
}
