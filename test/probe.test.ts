import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import type { Options, RegistryEntry } from "../src/shared/types"
import { resolveOptions } from "../src/shared/paths"
import { writeRegistry } from "../src/server/registry"
import {
  isPidAlive,
  isPortListening,
  killEntry,
  reconcile,
  scanExternal,
  type ExecFn,
} from "../src/tui/probe"

async function tmpRegistry(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-probe-"))
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

const fakeOptions = (over: Partial<Options> = {}) => resolveOptions(over)

describe("isPidAlive", () => {
  it("returns false when exec returns nothing", async () => {
    expect(await isPidAlive(1234, async () => "")).toBe(false)
  })

  it("returns true when the pid is found", async () => {
    const isWin = process.platform === "win32"
    const output = isWin ? `"1234","node.exe"` : "alive"
    expect(await isPidAlive(1234, async () => output)).toBe(true)
  })
})

describe("isPortListening", () => {
  it("returns true when a listener exists", async () => {
    expect(await isPortListening(3100, async () => "LISTENING")).toBe(true)
  })

  it("returns false when no listener exists", async () => {
    expect(await isPortListening(3100, async () => "")).toBe(false)
  })
})

describe("reconcile", () => {
  it("marks a running entry stopped when the pid is dead", async () => {
    const { file } = await tmpRegistry()
    await writeRegistry(file, { version: 1, entries: { a: entry({ pid: 999 }) } })
    const registry = await reconcile(file, { maxRetentionSec: 30 }, async () => "")
    expect(registry.entries.a.status).toBe("stopped")
  })

  it("keeps a running entry running when the pid is alive", async () => {
    const { file } = await tmpRegistry()
    await writeRegistry(file, { version: 1, entries: { a: entry({ pid: 1 }) } })
    const output = process.platform === "win32" ? `"1","node.exe"` : "alive"
    const registry = await reconcile(file, { maxRetentionSec: 30 }, async () => output)
    expect(registry.entries.a.status).toBe("running")
  })

  it("persists the reconciled status back to the registry", async () => {
    const { file } = await tmpRegistry()
    await writeRegistry(file, { version: 1, entries: { a: entry({ pid: 999 }) } })
    await reconcile(file, { maxRetentionSec: 30 }, async () => "")
    const raw = await fs.readFile(file, "utf8")
    const persisted = JSON.parse(raw)
    expect(persisted.entries.a.status).toBe("stopped")
  })

  it("prunes stopped entries older than the retention window", async () => {
    const { file } = await tmpRegistry()
    await writeRegistry(file, {
      version: 1,
      entries: {
        old: entry({ id: "old", status: "stopped", lastSeen: Date.now() - 60000 }),
      },
    })
    const registry = await reconcile(file, { maxRetentionSec: 30 }, async () => "")
    expect(Object.keys(registry.entries)).not.toContain("old")
  })
})

describe("scanExternal", () => {
  it("returns external entries for ports with listeners not in the registry", async () => {
    const registry = { version: 1 as const, entries: { a: entry({ port: 3100 }) } }
    // Only 5173 is "listening"; 3100 is in the registry; 3000 is not listening.
    const external = await scanExternal(
      fakeOptions({ devPorts: [3000, 3100, 5173] }),
      registry,
      async (_cmd, args) => (args.some((a) => a.includes("5173")) ? "LISTENING" : ""),
    )
    expect(external).toHaveLength(1)
    expect(external[0]).toMatchObject({ port: 5173, external: true })
  })
})

describe("killEntry", () => {
  it("marks the entry stopped after killing", async () => {
    const { file } = await tmpRegistry()
    await writeRegistry(file, { version: 1, entries: { a: entry({ pid: 1234, status: "running" }) } })
    const exec: ExecFn = async () => ""
    await killEntry(file, "a", exec)
    const raw = await fs.readFile(file, "utf8")
    const registry = JSON.parse(raw)
    expect(registry.entries.a.status).toBe("stopped")
  })
})
