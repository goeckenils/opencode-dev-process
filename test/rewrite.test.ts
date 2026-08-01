import { describe, expect, it } from "vitest"
import {
  buildPosixCommand,
  buildRewriteCommand,
  buildWindowsScript,
  POLL_ATTEMPTS,
} from "../src/server/rewrite"

const base = {
  command: "npm run dev -- -p 3100",
  cwd: "C:\\dev\\app",
  logOut: "C:\\logs\\id.out.log",
  logErr: "C:\\logs\\id.err.log",
  scriptPath: "C:\\logs\\id.ps1",
  port: 3100,
}

describe("buildWindowsScript", () => {
  it("starts detached with redirects", () => {
    const script = buildWindowsScript(base)
    expect(script).toContain("Start-Process -FilePath 'cmd.exe'")
    expect(script).toContain("npm run dev -- -p 3100")
    expect(script).toContain("-RedirectStandardOutput $logOut")
    expect(script).toContain("-WindowStyle Hidden")
  })

  it("does not pre-kill an existing listener (idempotent)", () => {
    const script = buildWindowsScript(base)
    expect(script).not.toContain("Stop-Process")
  })

  it("polls the port bounded", () => {
    const script = buildWindowsScript(base)
    expect(script).toContain(`for ($i = 0; $i -lt ${POLL_ATTEMPTS}; $i++)`)
    expect(script).toContain('Write-Output "UP PID $pidFound"')
  })

  it("skips port poll and uses pid fallback when port is unknown", () => {
    const script = buildWindowsScript({ ...base, port: undefined })
    expect(script).not.toContain("Get-NetTCPConnection")
    expect(script).toContain("Get-Process -Id $p.Id")
    expect(script).toContain('Write-Output "FAILED"')
  })

  it("escapes single quotes in paths", () => {
    const script = buildWindowsScript({
      ...base,
      cwd: "C:\\dev\\it's",
      logOut: "C:\\logs\\it's.out.log",
    })
    expect(script).toContain("C:\\dev\\it''s")
  })

  it("handles commands with embedded double quotes", () => {
    const script = buildWindowsScript({ ...base, command: 'npm run dev -- --name "my app"' })
    expect(script).toContain('npm run dev -- --name "my app"')
  })
})

describe("buildPosixCommand", () => {
  it("starts with setsid nohup and redirects", () => {
    const cmd = buildPosixCommand({
      ...base,
      cwd: "/dev/app",
      logOut: "/logs/id.out.log",
      logErr: "/logs/id.err.log",
    })
    expect(cmd).toContain("setsid nohup sh -c 'npm run dev -- -p 3100'")
    expect(cmd).toContain("> '/logs/id.out.log' 2> '/logs/id.err.log'")
    expect(cmd).toContain("&")
  })

  it("polls the port with lsof", () => {
    const cmd = buildPosixCommand(base)
    expect(cmd).toContain("lsof -t -iTCP:3100 -sTCP:LISTEN")
    expect(cmd).toContain('echo "UP PID $pid"')
  })

  it("uses kill -0 fallback when port is unknown", () => {
    const cmd = buildPosixCommand({ ...base, port: undefined })
    expect(cmd).toContain("kill -0 $spawned")
  })
})

describe("buildRewriteCommand", () => {
  it("returns a powershell invocation on win32", () => {
    const result = buildRewriteCommand(base, "win32")
    expect(result.command).toContain("powershell.exe")
    expect(result.command).toContain("-File")
    expect(result.windowsScript).toBeTruthy()
  })

  it("returns the posix command on linux", () => {
    const result = buildRewriteCommand(base, "linux")
    expect(result.command).toContain("setsid")
    expect(result.windowsScript).toBeUndefined()
  })
})
