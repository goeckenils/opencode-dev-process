/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Options, RegistryEntry } from "../shared/types"
import {
  entriesOf,
  killEntry,
  loadOptions,
  openFile,
  reconcile,
  scanExternal,
} from "./probe"

const id = "opencode-dev-process"
const POLL_MS = 3000
const STALE_MS = 30_000

function View(props: { api: TuiPluginApi; options: Required<Options>; sessionID: string }) {
  const theme = () => props.api.theme.current
  const [entries, setEntries] = createSignal<RegistryEntry[]>([])
  const [external, setExternal] = createSignal<RegistryEntry[]>([])
  const [collapsed, setCollapsed] = createSignal(false)

  const refresh = async () => {
    try {
      const reconciled = await reconcile(props.options.registryPath)
      const list = entriesOf(reconciled)
      const now = Date.now()
      setEntries(
        list.filter(
          (entry) =>
            entry.status === "running" ||
            (entry.status === "stopped" && now - entry.lastSeen < STALE_MS),
        ),
      )
      setExternal(await scanExternal(props.options, reconciled))
    } catch {
      // Registry not readable yet; keep the previous view.
    }
  }

  const timer = setInterval(refresh, POLL_MS)
  refresh()
  onCleanup(() => clearInterval(timer))

  const onKill = async (entry: RegistryEntry) => {
    await killEntry(props.options.registryPath, entry.id)
    await refresh()
  }

  const onOpenLog = (entry: RegistryEntry) => {
    if (entry.logOut) openFile(entry.logOut)
    if (entry.logErr) openFile(entry.logErr)
  }

  const dot = (entry: RegistryEntry) => {
    if (entry.status === "running") return theme().success
    return theme().textMuted
  }

  const runningCount = createMemo(() => entries().filter((e) => e.status === "running").length)
  const total = createMemo(() => runningCount() + external().filter((e) => e.status === "running").length)

  return (
    <box>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => setCollapsed((value) => !value)}
      >
        <text fg={theme().text}>
          <b>Dev Servers</b>
          <Show when={!collapsed()}>
            <span style={{ fg: theme().textMuted }}> ({total()} running)</span>
          </Show>
        </text>
      </box>

      <Show when={!collapsed()}>
        <Show when={entries().length > 0}>
          <For each={entries()}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: dot(entry) }}>
                  •
                </text>
                <text fg={theme().text} wrapMode="word">
                  {entry.command}
                  <Show when={entry.port}>
                    <span style={{ fg: theme().textMuted }}> :{entry.port}</span>
                  </Show>
                  <Show when={entry.pid}>
                    <span style={{ fg: theme().textMuted }}> PID {entry.pid}</span>
                  </Show>
                  <Show when={entry.status === "stopped"}>
                    <span style={{ fg: theme().textMuted }}> stopped</span>
                  </Show>
                </text>
                <Show when={!entry.external}>
                  <text fg={theme().textMuted} onMouseDown={() => onOpenLog(entry)}>
                    [log]
                  </text>
                  <text fg={theme().error} onMouseDown={() => onKill(entry)}>
                    [✕]
                  </text>
                </Show>
              </box>
            )}
          </For>
        </Show>

        <Show when={external().length > 0}>
          <For each={external()}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: theme().textMuted }}>
                  •
                </text>
                <text fg={theme().text} wrapMode="word">
                  {entry.command}
                  <span style={{ fg: theme().textMuted }}> (external)</span>
                </text>
              </box>
            )}
          </For>
        </Show>

        <Show when={entries().length === 0 && external().length === 0}>
          <text fg={theme().textMuted}>No dev servers running</text>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const opts = loadOptions(options as Record<string, unknown> | undefined)
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} options={opts} sessionID={props.session_id} />
      },
    },
  })
}

export default { id, tui }
