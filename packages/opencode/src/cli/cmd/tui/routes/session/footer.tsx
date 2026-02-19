import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { useRoute } from "../../context/route"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Show when={connected()}>
          <Show when={permissions().length > 0}>
            <text fg={theme.warning}>
              <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
              {permissions().length > 1 ? "s" : ""}
            </text>
          </Show>
          <text fg={theme.text}>
            <span style={{ fg: theme.success }}>•</span> {lsp().length} LSP
          </text>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: theme.success }}>⊙ </span>
                </Match>
              </Switch>
              {mcp()} MCP
            </text>
          </Show>
          <text fg={theme.textMuted}>/status</text>
        </Show>
      </box>
    </box>
  )
}
