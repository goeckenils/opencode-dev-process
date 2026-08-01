export type ProcessStatus = "running" | "stopped" | "external"

export interface RegistryEntry {
  /** Stable id for the process (also used for log file names). */
  id: string
  /** The original command the agent typed, e.g. "npm run dev -- -p 3100". */
  command: string
  /** Working directory the process was started in. */
  cwd: string
  /** Resolved listener port, if known. */
  port?: number
  /** Process id of the detached process (may differ from the port listener pid). */
  pid?: number
  /** Absolute path to the redirected stdout log. */
  logOut?: string
  /** Absolute path to the redirected stderr log. */
  logErr?: string
  /** Epoch ms when the process was started. */
  startedAt: number
  /** Epoch ms of the last liveness check. */
  lastSeen: number
  status: ProcessStatus
  /** True when the process was not started through this plugin. */
  external?: boolean
}

export interface Registry {
  version: 1
  entries: Record<string, RegistryEntry>
}

export interface Options {
  /** Command allowlist for auto-detached starts. */
  allowlist?: string[]
  /** Absolute path to the registry JSON file. */
  registryPath?: string
  /** Absolute path to the directory holding per-process log files. */
  logDir?: string
  /** Seconds a stopped entry stays in the registry before cleanup. */
  maxRetentionSec?: number
  /** Common dev ports considered for the "external listener" scan. */
  devPorts?: number[]
  /** Default port used when a dev command has no explicit port. */
  defaultPort?: number
}
