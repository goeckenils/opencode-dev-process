import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import type { Hooks } from "@opencode-ai/plugin"
import { server } from "../src/server/index"
import { readRegistry, writeRegistry } from "../src/server/registry"
import type { RegistryEntry } from "../src/shared/types"

async function makePlugin(logDir: string, registryPath: string) {
  const input = {
    directory: "C:\\dev\\app",
    worktree: "C:\\dev\\app",
    project: {} as any,
    serverUrl: new URL("http://localhost:4096"),
    $: undefined as any,
    client: {} as any,
    experimental_workspace: { register: () => {} },
  }
  const hooks = (await server(input, {
    logDir,
    registryPath,
    allowlist: ["npm run dev"],
    defaultPort: 3000,
  })) as unknown as Hooks
  return hooks
}

async function tmpDir(): Promise<{ dir: string; registryPath: string; logDir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-hook-"))
  return { dir, registryPath: path.join(dir, "processes.json"), logDir: path.join(dir, "logs") }
}

describe("server plugin hook flow", () => {
  it("rewrites a dev-server bash command and records a running entry", async () => {
    const { registryPath, logDir } = await tmpDir()
    const hooks = await makePlugin(logDir, registryPath)

    const output = { args: { command: "npm run dev -- -p 3100" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.command).not.toBe("npm run dev -- -p 3100")

    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "c1", args: output.args },
      { title: "bash", output: "UP PID 4242", metadata: {} },
    )

    const registry = await readRegistry(registryPath)
    const entries = Object.values(registry.entries)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ command: "npm run dev -- -p 3100", port: 3100, pid: 4242, status: "running" })

    const scriptFiles = (await fs.readdir(logDir)).filter((f) => f.endsWith(".ps1"))
    expect(scriptFiles).toHaveLength(0)
  })

  it("records a failed start as stopped and flags isError", async () => {
    const { registryPath, logDir } = await tmpDir()
    const hooks = await makePlugin(logDir, registryPath)

    const output = { args: { command: "npm run dev" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    const result = { title: "bash", output: "powershell.exe : command not found", metadata: {} }
    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "c1", args: output.args },
      result,
    )

    const registry = await readRegistry(registryPath)
    expect(Object.values(registry.entries)[0]).toMatchObject({ status: "stopped" })
    expect(result.metadata.isError).toBe(true)
    expect(result.output).toContain("failed to start")
  })

  it("reports already running and skips a second start when a registry server owns the port", async () => {
    const { registryPath, logDir } = await tmpDir()
    const existing: RegistryEntry = {
      id: "running-1",
      command: "npm run dev -- -p 3100",
      cwd: "C:\\dev\\app",
      port: 3100,
      pid: 4242,
      logOut: "C:\\logs\\a.out.log",
      logErr: "C:\\logs\\a.err.log",
      startedAt: Date.now(),
      lastSeen: Date.now(),
      status: "running",
    }
    await writeRegistry(registryPath, { version: 1, entries: { "running-1": existing } })

    const hooks = await makePlugin(logDir, registryPath)
    const output = { args: { command: "npm run dev -- -p 3100" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    // The command is left untouched so the tool runs the original (no double start).
    expect(output.args.command).toBe("npm run dev -- -p 3100")

    const result = { title: "bash", output: "UP PID 4242", metadata: {} }
    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "c1", args: output.args },
      result,
    )
    expect(result.output).toContain("already running")
    expect(result.output).toContain("4242")
  })

  it("does not leak a stale intent across aborted calls", async () => {
    const { registryPath, logDir } = await tmpDir()
    const hooks = await makePlugin(logDir, registryPath)

    // A dev-server call sets an intent but never completes.
    const devOutput = { args: { command: "npm run dev" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "dev-1" }, devOutput)

    // An unrelated bash call completes; it must not consume the stale intent.
    const otherOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "other-1" }, otherOutput)
    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "other-1", args: otherOutput.args },
      { title: "bash", output: "On branch main", metadata: {} },
    )

    const registry = await readRegistry(registryPath)
    expect(Object.values(registry.entries)).toHaveLength(0)
  })

  it("leaves non-dev-server commands untouched", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-hook-"))
    const hooks = await makePlugin(path.join(dir, "logs"), path.join(dir, "processes.json"))

    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.command).toBe("git status")
  })

  it("ignores non-bash tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-hook-"))
    const hooks = await makePlugin(path.join(dir, "logs"), path.join(dir, "processes.json"))

    const output = { args: { command: "npm run dev" } }
    await hooks["tool.execute.before"]!({ tool: "read", sessionID: "s1", callID: "c1" }, output)
    expect(output.args.command).toBe("npm run dev")
  })
})
