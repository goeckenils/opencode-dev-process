import { describe, expect, it } from "vitest"
import os from "os"
import path from "path"
import { DEFAULT_OPTIONS, resolveOptions } from "../src/shared/paths"

describe("resolveOptions", () => {
  it("uses defaults when no options are passed", () => {
    const opts = resolveOptions(undefined)
    expect(opts.allowlist).toContain("npm run dev")
    expect(opts.allowlist).toContain("vite")
    expect(opts.registryPath).toBe(DEFAULT_OPTIONS.registryPath)
    expect(opts.maxRetentionSec).toBe(30)
  })

  it("points the registry and logs at ~/.config/opencode", () => {
    const opts = resolveOptions(undefined)
    expect(opts.registryPath).toBe(path.join(os.homedir(), ".config", "opencode", "processes.json"))
    expect(opts.logDir).toBe(path.join(os.homedir(), ".config", "opencode", "process-logs"))
  })

  it("merges custom options over defaults", () => {
    const opts = resolveOptions({ maxRetentionSec: 5 })
    expect(opts.maxRetentionSec).toBe(5)
    expect(opts.allowlist).toContain("npm run dev")
  })

  it("replaces allowlist when a non-empty one is provided", () => {
    const opts = resolveOptions({ allowlist: ["next dev"] })
    expect(opts.allowlist).toEqual(["next dev"])
    expect(opts.allowlist).not.toContain("vite")
  })
})
