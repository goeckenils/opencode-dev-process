import { describe, expect, it } from "vitest"
import { detectDevServer, extractPort, normalizeCommand } from "../src/server/detect"
import { DEFAULT_OPTIONS } from "../src/shared/paths"

const allowlist = DEFAULT_OPTIONS.allowlist

describe("extractPort", () => {
  it("extracts -p 3100", () => {
    expect(extractPort("npm run dev -- -p 3100")).toBe(3100)
  })

  it("extracts --port 8080", () => {
    expect(extractPort("npm run start -- --port 8080")).toBe(8080)
  })

  it("extracts --port=5173", () => {
    expect(extractPort("vite --port=5173")).toBe(5173)
  })

  it("extracts PORT=3000 env prefix", () => {
    expect(extractPort("PORT=3000 npm run dev")).toBe(3000)
  })

  it("returns undefined when no port is present", () => {
    expect(extractPort("npm run dev")).toBeUndefined()
  })

  it("ignores invalid ports", () => {
    expect(extractPort("npm run dev -- -p 99999")).toBeUndefined()
    expect(extractPort("npm run dev -- -p abc")).toBeUndefined()
  })
})

describe("normalizeCommand", () => {
  it("collapses whitespace", () => {
    expect(normalizeCommand("npm   run   dev")).toBe("npm run dev")
  })

  it("strips quotes", () => {
    expect(normalizeCommand('"npm run dev"')).toBe("npm run dev")
  })
})

describe("detectDevServer", () => {
  it("matches npm run dev", () => {
    expect(detectDevServer({ command: "npm run dev", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: true,
      base: "npm run dev",
    })
  })

  it("matches npm run dev with port", () => {
    expect(
      detectDevServer({ command: "npm run dev -- -p 3100", allowlist, defaultPort: 3000 }),
    ).toMatchObject({ matched: true, port: 3100 })
  })

  it("applies defaultPort when no explicit port is present", () => {
    expect(detectDevServer({ command: "npm run dev", allowlist, defaultPort: 3100 })).toMatchObject({
      matched: true,
      port: 3100,
    })
  })

  it("matches vite", () => {
    expect(detectDevServer({ command: "vite", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: true,
      base: "vite",
    })
  })

  it("matches npx next dev", () => {
    expect(detectDevServer({ command: "npx next dev", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: true,
    })
  })

  it("matches with an env prefix", () => {
    expect(detectDevServer({ command: "PORT=5173 vite", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: true,
      port: 5173,
    })
  })

  it("does not match npm run build", () => {
    expect(detectDevServer({ command: "npm run build", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("does not match arbitrary commands", () => {
    expect(detectDevServer({ command: "git status", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("does not match npm run development (prefix collision)", () => {
    expect(detectDevServer({ command: "npm run development", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("does not hijack grep vite", () => {
    expect(detectDevServer({ command: "grep vite .", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("does not hijack vite build", () => {
    expect(detectDevServer({ command: "vite build", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("does not hijack nodemon --version", () => {
    expect(detectDevServer({ command: "nodemon --version", allowlist, defaultPort: 3000 })).toMatchObject({
      matched: false,
    })
  })

  it("returns base even when unmatched", () => {
    const result = detectDevServer({ command: "ls -la", allowlist, defaultPort: 3000 })
    expect(result.matched).toBe(false)
    expect(result.base).toBe("ls -la")
  })
})

describe("detectDevServer with wrappers", () => {
  it("matches cmd /c start /B npx next dev with port", () => {
    const result = detectDevServer({
      command: 'cmd /c "start /B npx next dev -p 3100"',
      allowlist,
      defaultPort: 3000,
    })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
    expect(result.canonical).toContain("npx next dev")
  })

  it("matches bare cmd /c npx next dev", () => {
    const result = detectDevServer({ command: "cmd /c npx next dev -p 3100", allowlist, defaultPort: 3000 })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
  })

  it("matches Start-Process with npm.cmd argument list", () => {
    const result = detectDevServer({
      command: 'Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev","--","-p","3100" -WindowStyle Hidden',
      allowlist,
      defaultPort: 3000,
    })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
    expect(result.canonical).toContain("npm run dev")
  })

  it("matches Start-Process with single-string argument list", () => {
    const result = detectDevServer({
      command: 'Start-Process -FilePath "npx" -ArgumentList "next dev -p 3100"',
      allowlist,
      defaultPort: 3000,
    })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
  })

  it("matches powershell -Command npm run dev", () => {
    const result = detectDevServer({
      command: 'powershell.exe -NoProfile -Command "npm run dev -- -p 3100"',
      allowlist,
      defaultPort: 3000,
    })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
  })

  it("matches a $ prompt echo", () => {
    const result = detectDevServer({ command: "$ npx next dev -p 3100", allowlist, defaultPort: 3000 })
    expect(result.matched).toBe(true)
    expect(result.port).toBe(3100)
  })

  it("does not match Start-Process for a non-dev command", () => {
    const result = detectDevServer({
      command: 'Start-Process -FilePath "npm.cmd" -ArgumentList "run","build"',
      allowlist,
      defaultPort: 3000,
    })
    expect(result.matched).toBe(false)
  })
})
