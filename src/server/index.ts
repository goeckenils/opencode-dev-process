import fs from "node:fs/promises"
import path from "path"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import type { Options, RegistryEntry } from "../shared/types"
import { resolveOptions } from "../shared/paths"
import { detectDevServer } from "./detect"
import { buildRewriteCommand, type RewriteResult } from "./rewrite"
import { makeId, parseStartOutput, resolveLogPaths } from "./spawn"
import { upsertEntry } from "./registry"

const id = "opencode-dev-process"

/** Machine-readable markers we append to the rewritten command output. */
const MARKER_LOG = "ODP_LOG"
const MARKER_PORT = "ODP_PORT"
const MARKER_PID = "ODP_PID"

interface StartIntent {
  command: string
  cwd: string
  port?: number
  logOut: string
  logErr: string
  scriptPath: string
}

interface DevProcessPlugin {
  options: ReturnType<typeof resolveOptions>
  intent?: StartIntent
  rewriteResult?: RewriteResult
}

export const server: Plugin = async (input: PluginInput, rawOptions?: Record<string, unknown>) => {
  const options = resolveOptions(rawOptions as Options)
  const state: DevProcessPlugin = { options }

  const ensureLogDir = async () => {
    await fs.mkdir(options.logDir, { recursive: true })
  }

  return {
    "tool.execute.before": async (call, output) => {
      if (call.tool !== "bash") return
      const command = output.args?.command
      if (typeof command !== "string") return

      const detected = detectDevServer({ command, allowlist: options.allowlist, defaultPort: options.defaultPort })
      if (!detected.matched) return

      const cwd = output.args?.workdir
        ? path.resolve(output.args.workdir)
        : path.resolve(input.directory ?? process.cwd())
      await ensureLogDir()

      const procId = makeId()
      const { logOut, logErr, scriptPath } = resolveLogPaths(options.logDir, procId)
      state.intent = { command, cwd, port: detected.port, logOut, logErr, scriptPath }
      state.rewriteResult = buildRewriteCommand(
        { command, cwd, logOut, logErr, scriptPath, port: detected.port },
        process.platform,
      )

      if (state.rewriteResult.windowsScript) {
        await fs.writeFile(scriptPath, state.rewriteResult.windowsScript, "utf8")
      }

      // Rewrite the command the bash tool will execute.
      output.args.command = state.rewriteResult.command
    },

    "tool.execute.after": async (_call, result) => {
      const intent = state.intent
      const rewrite = state.rewriteResult
      if (!intent || !rewrite) return

      const parsed = parseStartOutput(result.output)
      const entry: RegistryEntry = {
        id: makeId(),
        command: intent.command,
        cwd: intent.cwd,
        port: intent.port,
        pid: parsed.upPid ?? parsed.spawnedPid,
        logOut: intent.logOut,
        logErr: intent.logErr,
        startedAt: Date.now(),
        lastSeen: Date.now(),
        status: parsed.failed ? "stopped" : "running",
      }

      await upsertEntry(options.registryPath, entry)

      // Cleanup the generated script file.
      await fs.rm(intent.scriptPath, { force: true }).catch(() => {})

      // Provide a clean, consumable response to the agent.
      result.output = `${summaryFor(entry, parsed.failed)}\n\n` +
        `${MARKER_LOG} ${entry.logOut}\n` +
        `${MARKER_PORT} ${entry.port ?? "unknown"}\n` +
        `${MARKER_PID} ${entry.pid ?? "unknown"}`

      state.intent = undefined
      state.rewriteResult = undefined
    },
  }
}

function summaryFor(entry: RegistryEntry, failed: boolean): string {
  if (failed) {
    return `✗ ${entry.command} failed to start. Check the log: ${entry.logErr}`
  }
  const port = entry.port ? ` on :${entry.port}` : ""
  const pid = entry.pid ? ` (PID ${entry.pid})` : ""
  return `✓ ${entry.command} is running${port}${pid}. Logs: ${entry.logOut}`
}

export default { id, server }
