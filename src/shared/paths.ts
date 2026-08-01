import os from "os"
import path from "path"
import type { Options } from "./types"

const APP_DIR = ".opencode"
const STATE_FILE = "processes.json"
const LOG_DIR = "process-logs"

export const DEFAULT_DEV_PORTS = [3000, 3100, 5173, 8080, 4000, 5000, 8000, 4200, 5174, 8081]

export const DEFAULT_OPTIONS: Required<Options> = {
  allowlist: [
    "npm run dev",
    "npm run start",
    "npm run preview",
    "npm run serve",
    "npm dev",
    "npm start",
    "pnpm run dev",
    "pnpm run start",
    "pnpm run preview",
    "pnpm run serve",
    "pnpm dev",
    "pnpm start",
    "yarn run dev",
    "yarn run start",
    "yarn run preview",
    "yarn run serve",
    "yarn dev",
    "yarn start",
    "bun run dev",
    "bun run start",
    "bun run preview",
    "bun run serve",
    "bun dev",
    "bun start",
    "next dev",
    "next start",
    "vite",
    "vite dev",
    "nodemon",
    "npx next dev",
    "npx vite",
  ],
  registryPath: path.join(os.homedir(), ".config", APP_DIR, STATE_FILE),
  logDir: path.join(os.homedir(), ".config", APP_DIR, LOG_DIR),
  maxRetentionSec: 30,
  devPorts: DEFAULT_DEV_PORTS,
  defaultPort: 3000,
}

export function resolveOptions(options: Options | undefined): Required<Options> {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    allowlist: options?.allowlist?.length ? options.allowlist : DEFAULT_OPTIONS.allowlist,
    devPorts: options?.devPorts?.length ? options.devPorts : DEFAULT_OPTIONS.devPorts,
  }
}
