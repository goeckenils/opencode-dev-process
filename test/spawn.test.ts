import { describe, expect, it } from "vitest"
import path from "path"
import {
  findPortPid,
  isProcessAlive,
  killProcessTree,
  makeId,
  parseStartOutput,
  resolveLogPaths,
  runDetached,
  type ExecFn,
} from "../src/server/spawn"

describe("makeId", () => {
  it("produces a stable hex id", () => {
    const id = makeId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe("resolveLogPaths", () => {
  it("returns log and script paths in the log dir", () => {
    const { logOut, logErr, scriptPath } = resolveLogPaths("/logs", "abc123")
    expect(logOut).toBe(path.join("/logs", "abc123.out.log"))
    expect(logErr).toBe(path.join("/logs", "abc123.err.log"))
    expect(scriptPath).toBe(path.join("/logs", "abc123.ps1"))
  })
})

describe("parseStartOutput", () => {
  it("parses UP PID", () => {
    expect(parseStartOutput("UP PID 1234")).toEqual({ ok: true, upPid: 1234, failed: false, raw: "UP PID 1234" })
  })

  it("parses SPAWNED", () => {
    expect(parseStartOutput("SPAWNED 5678")).toEqual({ ok: true, spawnedPid: 5678, failed: false, raw: "SPAWNED 5678" })
  })

  it("parses FAILED", () => {
    expect(parseStartOutput("FAILED")).toEqual({ ok: false, failed: true, raw: "FAILED" })
  })

  it("handles noisy output", () => {
    expect(parseStartOutput("\nUP PID 99\n")).toEqual({ ok: true, upPid: 99, failed: false, raw: "UP PID 99" })
  })

  it("reports unknown output as not-ok without failed", () => {
    expect(parseStartOutput("something else")).toEqual({ ok: false, failed: false, raw: "something else" })
  })
})

describe("runDetached", () => {
  it("runs a powershell script on win32", async () => {
    const exec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe("powershell.exe")
      expect(args).toContain("-File")
      return { stdout: "UP PID 42\n", stderr: "", exitCode: 0 }
    }
    const result = await runDetached("C:\\logs\\id.ps1", "C:\\dev", 10000, {
      logDir: "C:\\logs",
      exec,
    })
    expect(result).toEqual({ ok: true, upPid: 42, failed: false, raw: "UP PID 42" })
  })
})

describe("findPortPid", () => {
  it("returns undefined when the port is not in use", async () => {
    const result = await findPortPid(3000, async () => ({ stdout: "", stderr: "", exitCode: 1 }))
    expect(result).toBeUndefined()
  })

  it("parses a numeric pid from powershell output", async () => {
    const result = await findPortPid(3000, async () => ({ stdout: "4321\n", stderr: "", exitCode: 0 }))
    expect(result).toBe(4321)
  })
})

describe("isProcessAlive", () => {
  it("returns false for empty output", async () => {
    const alive = await isProcessAlive(999999, async () => ({ stdout: "", stderr: "", exitCode: 1 }))
    expect(alive).toBe(false)
  })

  it("returns true when the process is found", async () => {
    const isWin = process.platform === "win32"
    const output = isWin ? `"4321","node.exe","","","0"` : "alive\n"
    const alive = await isProcessAlive(4321, async () => ({ stdout: output, stderr: "", exitCode: 0 }))
    expect(alive).toBe(true)
  })
})

describe("killProcessTree", () => {
  it("does not throw on exec failure", async () => {
    const exec: ExecFn = async () => {
      throw new Error("boom")
    }
    await expect(killProcessTree(1, exec)).resolves.toBeUndefined()
  })
})
