import fs from "node:fs/promises"
import path from "path"
import type { Options, Registry, RegistryEntry } from "../shared/types"

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
 * Writes the registry atomically: write to a temp file in the same directory,
 * then rename over the target. Concurrent writers each read-modify-write the
 * latest snapshot, so a lost update requires two writers racing within the
 * read+write window of a single process.
 */
export async function writeRegistry(registryPath: string, registry: Registry): Promise<void> {
  const dir = path.dirname(registryPath)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(registryPath)}.${process.pid}.tmp`)
  await fs.writeFile(temp, JSON.stringify(registry, null, 2), "utf8")
  await fs.rename(temp, registryPath)
}

export async function upsertEntry(registryPath: string, entry: RegistryEntry): Promise<Registry> {
  const registry = await readRegistry(registryPath)
  registry.entries[entry.id] = entry
  await writeRegistry(registryPath, registry)
  return registry
}

export async function removeEntry(registryPath: string, id: string): Promise<Registry> {
  const registry = await readRegistry(registryPath)
  delete registry.entries[id]
  await writeRegistry(registryPath, registry)
  return registry
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
}
