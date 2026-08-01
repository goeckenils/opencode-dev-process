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

  it("returns base even when unmatched", () => {
    const result = detectDevServer({ command: "ls -la", allowlist, defaultPort: 3000 })
    expect(result.matched).toBe(false)
    expect(result.base).toBe("ls -la")
  })
})
