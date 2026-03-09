import { type Accessor, createMemo, createSignal, onMount, Show } from "solid-js"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "../../context/keybind"
import { useCommandDialog } from "@tui/component/dialog-command"

const ContextInfo = (props: { context: Accessor<string | undefined>; credits: Accessor<number | null> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="none">
          {props.context()}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          Credits: {props.credits() !== null ? `${props.credits()}/250` : "—"}
        </text>
      </box>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const keybind = useKeybind()
  const command = useCommandDialog()

  // Credits fetching (same as prompt component)
  const [credits, setCredits] = createSignal<number | null>(null)
  async function fetchCredits() {
    const baseURL = process.env["VIBEDUEL_BASE_URL"] ?? "https://api.vibeduel.ai/v1"
    const apiKey = process.env["VIBEDUEL_API_KEY"]
    if (!apiKey) return
    const res = await fetch(`${baseURL.replace(/\/v1$/, "")}/v1/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const data = await res.json()
      setCredits(data.credits)
    }
  }
  onMount(() => fetchCredits())

  // Get children sessions for this subagent
  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })

  const hasMultipleChildren = createMemo(() => children().filter((x) => !!x.parentID).length > 1)

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as
      | AssistantMessage
      | undefined
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()

  // For subagent sessions (when parentID exists)
  const isSubagent = createMemo(() => false)

  // Hover states for buttons
  const [parentHover, setParentHover] = createSignal(false)
  const [prevHover, setPrevHover] = createSignal(false)
  const [nextHover, setNextHover] = createSignal(false)

  return (
    <Show when={isSubagent()}>
      <box flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
        <box flexDirection="row" gap={2} alignItems="center">
          {/* Parent button */}
          <box
            onMouseOver={() => setParentHover(true)}
            onMouseOut={() => setParentHover(false)}
            onMouseUp={() => command.trigger("session.parent")}
            backgroundColor={parentHover() ? theme.backgroundElement : "transparent"}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.text}>
              Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
            </text>
          </box>

          {/* Prev button - only show when multiple children */}
          <Show when={hasMultipleChildren()}>
            <box
              onMouseOver={() => setPrevHover(true)}
              onMouseOut={() => setPrevHover(false)}
              onMouseUp={() => command.trigger("session.child.previous")}
              backgroundColor={prevHover() ? theme.backgroundElement : "transparent"}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.text}>
                Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
              </text>
            </box>
          </Show>

          {/* Next button - only show when multiple children */}
          <Show when={hasMultipleChildren()}>
            <box
              onMouseOver={() => setNextHover(true)}
              onMouseOut={() => setNextHover(false)}
              onMouseUp={() => command.trigger("session.child.next")}
              backgroundColor={nextHover() ? theme.backgroundElement : "transparent"}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.text}>
                Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
              </text>
            </box>
          </Show>

          <box flexGrow={1} flexShrink={1} />

          <ContextInfo context={context} credits={credits} />
        </box>
      </box>
    </Show>
  )
}
