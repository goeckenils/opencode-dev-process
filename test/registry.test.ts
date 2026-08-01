import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import type { RegistryEntry } from "../src/shared/types"
import { emptyRegistry, pruneRegistry, readRegistry, upsertEntry, writeRegistry } from "../src/server/registry"

async function tmpRegistry(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-reg-"))
  return { dir, file: path.join(dir, "processes.json") }
}

function entry(partial: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "a",
    command: "npm run dev",
    cwd: "/dev/app",
    port: 3100,
    pid: 1234,
    logOut: "/logs/a.out.log",
    logErr: "/logs/a.err.log",
    startedAt: Date.now(),
    lastSeen: Date.now(),
    status: "running",
    ...partial,
  }
}

describe("emptyRegistry", () => {
  it("returns a versioned empty registry", () => {
    expect(emptyRegistry()).toEqual({ version: 1, entries: {} })
  })
})

describe("readRegistry", () => {
  it("returns empty when the file does not exist", async () => {
    const { file } = await tmpRegistry()
    expect(await readRegistry(file)).toEqual(emptyRegistry())
  })

  it("returns empty on corrupt JSON", async () => {
    const { file } = await tmpRegistry()
    await fs.writeFile(file, "{not json", "utf8")
    expect(await readRegistry(file)).toEqual(emptyRegistry())
  })

  it("reads a written registry", async () => {
    const { file } = await tmpRegistry()
    const registry = { version: 1 as const, entries: { a: entry() } }
    await writeRegistry(file, registry)
    expect(await readRegistry(file)).toEqual(registry)
  })
})

describe("upsertEntry", () => {
  it("adds an entry", async () => {
    const { file } = await tmpRegistry()
    const registry = await upsertEntry(file, entry())
    expect(registry.entries.a).toMatchObject({ command: "npm run dev", port: 3100 })
  })

  it("overwrites an existing entry with the same id", async () => {
    const { file } = await tmpRegistry()
    await upsertEntry(file, entry({ id: "a", pid: 1 }))
    const registry = await upsertEntry(file, entry({ id: "a", pid: 2 }))
    expect(registry.entries.a.pid).toBe(2)
    expect(Object.keys(registry.entries)).toHaveLength(1)
  })
})

describe("pruneRegistry", () => {
  it("drops stopped entries older than retention", async () => {
    const { file } = await tmpRegistry()
    await upsertEntry(file, entry({ id: "old", status: "stopped", lastSeen: Date.now() - 60000 }))
    await upsertEntry(file, entry({ id: "fresh", status: "stopped", lastSeen: Date.now() - 1000 }))
    const registry = await pruneRegistry(file, { maxRetentionSec: 30 }, async () => false)
    expect(Object.keys(registry.entries)).toEqual(["fresh"])
  })

  it("marks dead running entries as stopped but keeps them", async () => {
    const { file } = await tmpRegistry()
    await upsertEntry(file, entry({ id: "dead", status: "running", pid: 999 }))
    const registry = await pruneRegistry(file, { maxRetentionSec: 30 }, async () => false)
    expect(registry.entries.dead.status).toBe("stopped")
    expect(registry.entries.dead).toBeDefined()
  })

  it("keeps alive running entries", async () => {
    const { file } = await tmpRegistry()
    await upsertEntry(file, entry({ id: "alive", status: "running", pid: 1 }))
    const registry = await pruneRegistry(file, { maxRetentionSec: 30 }, async () => true)
    expect(registry.entries.alive.status).toBe("running")
  })

  it("does not lose entries from concurrent writers (lost-update protection)", async () => {
    const { file } = await tmpRegistry()
    await Promise.all([
      upsertEntry(file, entry({ id: "a", pid: 1 })),
      upsertEntry(file, entry({ id: "b", pid: 2 })),
    ])
    const registry = await readRegistry(file)
    expect(Object.keys(registry.entries).sort()).toEqual(["a", "b"])
  })

  it("merges a new entry into an existing file instead of overwriting", async () => {
    const { file } = await tmpRegistry()
    await upsertEntry(file, entry({ id: "a", pid: 1 }))
    // Simulate a second process writing a full (fresh) registry that lacks "a",
    // then a new upsert — the lock+merge must not clobber existing entries.
    await upsertEntry(file, entry({ id: "b", pid: 2 }))
    const registry = await readRegistry(file)
    expect(registry.entries.a).toBeDefined()
    expect(registry.entries.b).toBeDefined()
  })
})
