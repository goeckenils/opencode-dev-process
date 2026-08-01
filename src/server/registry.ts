import fs from "node:fs/promises"
import path from "path"
import crypto from "node:crypto"
import type { Options, Registry, RegistryEntry } from "../shared/types"

/** Serializes read-modify-write cycles per registry path (in-process). */
const writeQueues = new Map<string, Promise<unknown>>()

/** Milliseconds to wait between lock acquisition attempts. */
const LOCK_RETRY_MS = 25
/** Maximum total time to wait for the cross-process lock. */
const LOCK_TIMEOUT_MS = 5000

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
 * Acquires an exclusive cross-process lock for the registry path using an
 * atomic `O_EXCL` lock file. Releases it when the returned function is called.
 */
async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const token = crypto.randomBytes(8).toString("hex")
  const started = Date.now()
  for (;;) {
    try {
      await fs.writeFile(lockPath, token, { flag: "wx" })
      break
    } catch {
      // Another process holds the lock. If the lock file is stale (older than
      // the timeout), remove it and retry.
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        try {
          const stat = await fs.stat(lockPath)
          if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) await fs.rm(lockPath, { force: true })
        } catch {
          // Lock file vanished; retry.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
  return async () => {
    await fs.rm(lockPath, { force: true }).catch(() => {})
  }
}

/**
 * Writes the registry atomically under a cross-process lock: read the latest
 * on-disk state, apply `mutate`, then write to a unique temp file and rename
 * over the target. Merging inside the lock prevents concurrent opencode
 * instances from clobbering each other's entries.
 */
async function writeRegistryLocked(
  registryPath: string,
  mutate: (registry: Registry) => Registry,
): Promise<Registry> {
  const dir = path.dirname(registryPath)
  await fs.mkdir(dir, { recursive: true })
  const lockPath = path.join(dir, `.${path.basename(registryPath)}.lock`)
  const release = await acquireLock(lockPath)
  try {
    // Re-read inside the lock so we merge against the freshest on-disk state.
    const registry = await readRegistry(registryPath)
    const next = mutate(registry)
    const temp = path.join(dir, `.${path.basename(registryPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`)
    try {
      await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf8")
      await fs.rename(temp, registryPath)
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {})
    }
    return next
  } finally {
    await release()
  }
}

export async function writeRegistry(registryPath: string, registry: Registry): Promise<void> {
  await writeRegistryLocked(registryPath, () => registry)
}

export async function upsertEntry(registryPath: string, entry: RegistryEntry): Promise<Registry> {
  return withQueue(registryPath, () =>
    writeRegistryLocked(registryPath, (registry) => {
      registry.entries[entry.id] = entry
      return registry
    }),
  )
}

/**
 * Purges stopped entries older than maxRetentionSec and reconciles liveness
 * using the provided predicate. Returns the pruned registry.
 *
 * Liveness probes run outside the lock (they are slow); the filtered result is
 * then merged under the lock so concurrent writers are not lost.
 */
export async function pruneRegistry(
  registryPath: string,
  options: Pick<Required<Options>, "maxRetentionSec">,
  isAlive: (entry: RegistryEntry) => Promise<boolean>,
): Promise<Registry> {
  const now = Date.now()
  const snapshot = await readRegistry(registryPath)

  // Determine which running entries are still alive (parallel, outside lock).
  const aliveResults = await Promise.all(
    Object.entries(snapshot.entries).map(async ([id, entry]) => {
      let alive = true
      if (entry.status === "running" && entry.pid) {
        alive = await isAlive(entry).catch(() => true)
      }
      return { id, entry, alive }
    }),
  )

  return withQueue(registryPath, () =>
    writeRegistryLocked(registryPath, (registry) => {
      const retained = new Map<string, RegistryEntry>()
      for (const [id, entry] of Object.entries(registry.entries)) {
        const probe = aliveResults.find((item) => item.id === id)
        const alive = probe?.alive ?? true
        const stopped = entry.status === "stopped"
        const stale = now - entry.lastSeen > options.maxRetentionSec * 1000

        if (stopped && stale) continue
        if (entry.status === "running" && !alive) {
          retained.set(id, { ...entry, status: "stopped", lastSeen: now })
          continue
        }
        retained.set(id, entry)
      }
      registry.entries = Object.fromEntries(retained)
      return registry
    }),
  )
}
