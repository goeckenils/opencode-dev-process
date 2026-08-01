import fs from "node:fs/promises"
import path from "path"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import type { Options, RegistryEntry } from "../shared/types"
import { resolveOptions } from "../shared/paths"
import { detectDevServer } from "./detect"
import { buildRewriteCommand } from "./rewrite"
import { makeId, parseStartOutput, resolveLogPaths } from "./spawn"
import { readRegistry, upsertEntry } from "./registry"

const id = "opencode-dev-process"

/** Machine-readable markers we append to the rewritten command output. */
const MARKER_LOG = "ODP_LOG"
const MARKER_PORT = "ODP_PORT"
const MARKER_PID = "ODP_PID"

interface StartIntent {
  callID: string
  command: string
  cwd: string
  port?: number
  logOut: string
  logErr: string
  scriptPath: string
}

interface IdempotentIntent {
  callID: string
  command: string
  port: number
  pid: number
}

interface DevProcessPlugin {
  options: ReturnType<typeof resolveOptions>
  /** Pending detached-start intents keyed by tool call id. */
  pending: Map<string, StartIntent>
  /** A start that was skipped because a server already runs on the port. */
  idempotent: Map<string, IdempotentIntent>
}

/** Finds a running registry entry that already listens on the target port. */
async function runningOnPort(options: ReturnType<typeof resolveOptions>, port: number) {
  const registry = await readRegistry(options.registryPath)
  for (const entry of Object.values(registry.entries)) {
    if (entry.port === port && entry.status === "running" && entry.pid) return entry
  }
  return undefined
}

export const server: Plugin = async (input: PluginInput, rawOptions?: Record<string, unknown>) => {
  const options = resolveOptions(rawOptions as Options)
  const state: DevProcessPlugin = { options, pending: new Map(), idempotent: new Map() }

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

      // Idempotent start: if a registered server already listens on the port,
      // skip the rewrite entirely and report "already running".
      if (detected.port !== undefined) {
        const existing = await runningOnPort(options, detected.port)
        if (existing?.pid) {
          state.idempotent.set(call.callID, {
            callID: call.callID,
            command,
            port: detected.port,
            pid: existing.pid,
          })
          output.args.command = command
          return
        }
      }

      await ensureLogDir()

      const procId = makeId()
      const { logOut, logErr, scriptPath } = resolveLogPaths(options.logDir, procId)
      const intent: StartIntent = { callID: call.callID, command, cwd, port: detected.port, logOut, logErr, scriptPath }
      state.pending.set(call.callID, intent)
      const rewrite = buildRewriteCommand(
        { command, cwd, logOut, logErr, scriptPath, port: detected.port },
        process.platform,
      )

      if (rewrite.windowsScript) {
        await fs.writeFile(scriptPath, rewrite.windowsScript, "utf8")
      }

      output.args.command = rewrite.command
    },

    "tool.execute.after": async (call, result) => {
      if (call.tool !== "bash") return

      const idempotent = state.idempotent.get(call.callID)
      if (idempotent) {
        state.idempotent.delete(call.callID)
        result.output = `✓ ${idempotent.command} is already running on :${idempotent.port} (PID ${idempotent.pid}). Logs: ${options.registryPath}`
        return
      }

      const intent = state.pending.get(call.callID)
      if (!intent) return
      state.pending.delete(call.callID)

      const parsed = parseStartOutput(result.output)
      const failed = parsed.failed || !parsed.ok
      const entry: RegistryEntry = {
        id: makeId(),
        command: intent.command,
        cwd: intent.cwd,
        port: intent.port,
        pid: failed ? undefined : parsed.upPid ?? parsed.spawnedPid,
        logOut: intent.logOut,
        logErr: intent.logErr,
        startedAt: Date.now(),
        lastSeen: Date.now(),
        status: failed ? "stopped" : "running",
      }

      await upsertEntry(options.registryPath, entry)

      // Cleanup the generated script file.
      await fs.rm(intent.scriptPath, { force: true }).catch(() => {})

      if (failed) {
        result.metadata = { ...result.metadata, isError: true }
        result.output = `✗ ${intent.command} failed to start. Check the log: ${intent.logErr}\n\n${result.output}`
        return
      }

      result.output = `${summaryFor(entry)}\n\n` +
        `${MARKER_LOG} ${entry.logOut}\n` +
        `${MARKER_PORT} ${entry.port ?? "unknown"}\n` +
        `${MARKER_PID} ${entry.pid ?? "unknown"}`
    },
  }
}

function summaryFor(entry: RegistryEntry): string {
  const port = entry.port ? ` on :${entry.port}` : ""
  const pid = entry.pid ? ` (PID ${entry.pid})` : ""
  return `✓ ${entry.command} is running${port}${pid}. Logs: ${entry.logOut}`
}

export default { id, server }
