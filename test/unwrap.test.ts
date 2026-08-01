import { describe, expect, it } from "vitest"
import { tokenizeQuoted, unwrapCommand } from "../src/server/detect"

describe("unwrapCommand", () => {
  it("strips a $ prompt echo", () => {
    expect(unwrapCommand("$ npx next dev")).toBe("npx next dev")
  })

  it("strips cmd /c start /B", () => {
    expect(unwrapCommand('cmd /c "start /B npx next dev -p 3100"')).toBe("npx next dev -p 3100")
  })

  it("strips bare cmd /c", () => {
    expect(unwrapCommand("cmd /c npx next dev")).toBe("npx next dev")
  })

  it("strips start /B directly", () => {
    expect(unwrapCommand("start /B npm run dev")).toBe("npm run dev")
  })

  it("strips powershell -Command", () => {
    expect(unwrapCommand('powershell.exe -NoProfile -Command "npm run dev -- -p 3100"')).toBe(
      "npm run dev -- -p 3100",
    )
  })

  it("strips & separators", () => {
    expect(unwrapCommand("& npm run dev")).toBe("npm run dev")
  })

  it("reconstructs Start-Process -ArgumentList with quoted tokens", () => {
    expect(
      unwrapCommand('Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev","--","-p","3100" -WindowStyle Hidden'),
    ).toBe("npm run dev -- -p 3100")
  })

  it("reconstructs Start-Process with a single-string argument list", () => {
    expect(unwrapCommand('Start-Process -FilePath "npx" -ArgumentList "next dev -p 3100"')).toBe(
      "npx next dev -p 3100",
    )
  })

  it("leaves a plain command untouched", () => {
    expect(unwrapCommand("git status")).toBe("git status")
  })

  it("handles nesting: cmd /c start /B around Start-Process", () => {
    expect(
      unwrapCommand('cmd /c start /B Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev"'),
    ).toBe("npm run dev")
  })

  it("strips leading variable assignments before Start-Process", () => {
    expect(
      unwrapCommand(
        '$out = "C:\\x\\dev-server.log"; $err = "C:\\x\\dev-server.log.err"; $proc = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru; "PID: $($proc.Id)"',
      ),
    ).toBe("npm run dev")
  })

  it("strips a direct assignment before Start-Process", () => {
    expect(
      unwrapCommand('$p = Start-Process -FilePath "npx" -ArgumentList "next dev -p 3100"'),
    ).toBe("npx next dev -p 3100")
  })

  it("strips multiple assignments with a numeric value", () => {
    expect(
      unwrapCommand('$x = 1; $p = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev"'),
    ).toBe("npm run dev")
  })

  it("handles a path with spaces in the assignment value", () => {
    expect(
      unwrapCommand('$out = "C:\\My Folder\\dev.log"; $p = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev"'),
    ).toBe("npm run dev")
  })

  it("leaves a lone variable assignment untouched", () => {
    expect(unwrapCommand('$x = "npm run dev"')).toBe('$x = "npm run dev"')
  })
})

describe("tokenizeQuoted", () => {
  it("splits comma-separated quoted tokens", () => {
    expect(tokenizeQuoted('"run","dev","--","-p","3100"')).toEqual(["run", "dev", "--", "-p", "3100"])
  })

  it("handles a single quoted string with spaces", () => {
    expect(tokenizeQuoted('"next dev -p 3100"')).toEqual(["next dev -p 3100"])
  })

  it("handles unquoted tokens", () => {
    expect(tokenizeQuoted("run dev -- -p 3100")).toEqual(["run", "dev", "--", "-p", "3100"])
  })
})
