import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import type { Hooks } from "@opencode-ai/plugin"
import { server } from "../src/server/index"
import { readRegistry } from "../src/server/registry"

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
  })) as unknown as Hooks
  return hooks
}

describe("server plugin hook flow", () => {
  it("rewrites a dev-server bash command and records a running entry", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-hook-"))
    const registryPath = path.join(dir, "processes.json")
    const logDir = path.join(dir, "logs")
    const hooks = await makePlugin(logDir, registryPath)

    const output = { args: { command: "npm run dev -- -p 3100" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)

    // The bash tool then executes the rewritten command and reports success.
    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "c1", args: output.args },
      { title: "bash", output: "UP PID 4242", metadata: {} },
    )

    const registry = await readRegistry(registryPath)
    const entries = Object.values(registry.entries)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ command: "npm run dev -- -p 3100", port: 3100, pid: 4242, status: "running" })

    // Script file should be cleaned up.
    const scriptFiles = (await fs.readdir(logDir)).filter((f) => f.endsWith(".ps1"))
    expect(scriptFiles).toHaveLength(0)
  })

  it("records a failed start as stopped", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odp-hook-"))
    const registryPath = path.join(dir, "processes.json")
    const logDir = path.join(dir, "logs")
    const hooks = await makePlugin(logDir, registryPath)

    const output = { args: { command: "npm run dev" } }
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
    await hooks["tool.execute.after"]!(
      { tool: "bash", sessionID: "s1", callID: "c1", args: output.args },
      { title: "bash", output: "FAILED", metadata: {} },
    )

    const registry = await readRegistry(registryPath)
    expect(Object.values(registry.entries)[0]).toMatchObject({ status: "stopped" })
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
