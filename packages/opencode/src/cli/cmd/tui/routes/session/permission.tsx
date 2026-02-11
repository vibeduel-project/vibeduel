import { createStore } from "solid-js/store"
import { createMemo, createEffect, onCleanup, For, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useSync } from "../../context/sync"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Locale } from "@/util/locale"
import { Log } from "@/util/log"

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]


  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

const duelLog = Log.create({ service: "duel" })

function logToSide(side: "left" | "right", text: string) {
  duelLog.info(text, { side })
}

const promptStartTimes: Record<string, number> = {}

function EditBody(props: { request: PermissionRequest }) {
  const { theme, syntax } = useTheme()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => (props.request.metadata?.filepath as string) ?? "")
  const diff = createMemo(() => (props.request.metadata?.diff as string) ?? "")

  const view = createMemo(() => {
    const diffStyle = sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(filepath()))

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={theme.textMuted}>{"→"}</text>
        <text fg={theme.textMuted}>Edit {normalizePath(filepath())}</text>
      </box>
      <Show when={diff()}>
        <box maxHeight={Math.floor(dimensions().height / 4)} overflow="scroll">
          <diff
            diff={diff()}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={theme.text}
            addedBg={theme.diffAddedBg}
            removedBg={theme.diffRemovedBg}
            contextBg={theme.diffContextBg}
            addedSignColor={theme.diffHighlightAdded}
            removedSignColor={theme.diffHighlightRemoved}
            lineNumberFg={theme.diffLineNumber}
            lineNumberBg={theme.diffContextBg}
            addedLineNumberBg={theme.diffAddedLineNumberBg}
            removedLineNumberBg={theme.diffRemovedLineNumberBg}
          />
        </box>
      </Show>
    </box>
  )
}

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

export function PermissionPrompt(props: {
  request: PermissionRequest
  active: boolean
  side: "left" | "right"
  otherSessionID?: string
  onPermissionHandled?: (action: { toolCallID: string; messageID: string; startTime: number }) => void
}) {
  const sdk = useSDK()
  const [autoReplied, setAutoReplied] = createStore({ done: false })

  createEffect(() => {
    if (autoReplied.done) return
    if (props.request.permission === "edit") return
    setAutoReplied("done", true)
    logToSide(props.side, `Auto-allowing permission: ${props.request.permission} (${props.request.id})`)
    if (props.onPermissionHandled && props.request.tool) {
      props.onPermissionHandled({
        toolCallID: props.request.tool.callID,
        messageID: props.request.tool.messageID,
        startTime: Date.now(),
      })
    }
    sdk.client.permission.reply({
      reply: "always",
      requestID: props.request.id,
    })
  })
  const sync = useSync()
  const [store, setStore] = createStore({
    always: false,
  })

  const input = createMemo(() => {
    const tool = props.request.tool
    if (!tool) return {}
    const parts = sync.data.part[tool.messageID] ?? []
    for (const part of parts) {
      if (part.type === "tool" && part.callID === tool.callID && part.state.status !== "pending") {
        return part.state.input ?? {}
      }
    }
    return {}
  })

  const { theme } = useTheme()

  createEffect(() => {
    const now = Date.now()
    promptStartTimes[props.side] = now

    logToSide(props.side, `Permission Request: ${props.request.permission} (${props.request.id})`)

    const otherSide = props.side === "left" ? "right" : "left"
    const otherStart = promptStartTimes[otherSide]

    if (otherStart) {
      const diff = (now - otherStart) / 1000
      logToSide(props.side, `Other side (${otherSide}) displayed permission prompt ${diff.toFixed(2)}s earlier.`)
      logToSide(otherSide, `Other side (${props.side}) displayed permission prompt ${diff.toFixed(2)}s later.`)
    }
  })

  onCleanup(() => {
    delete promptStartTimes[props.side]
  })

  return (
    <Switch>
      <Match when={store.always}>
        <Prompt
          title="Always allow"
          body={
            <Switch>
              <Match when={props.request.always.length === 1 && props.request.always[0] === "*"}>
                <TextBody title={"This will allow " + props.request.permission + " until OpenCode is restarted."} />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.textMuted}>This will allow the following patterns until OpenCode is restarted</text>
                  <box>
                    <For each={props.request.always}>
                      {(pattern) => (
                        <text fg={theme.text}>
                          {"- "}
                          {pattern}
                        </text>
                      )}
                    </For>
                  </box>
                </box>
              </Match>
            </Switch>
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          active={props.active}
          onSelect={(option) => {
            logToSide(props.side, `User Response: ${option} (always flow)`)
            setStore("always", false)
            if (option === "cancel") return

            if (props.onPermissionHandled && props.request.tool) {
              props.onPermissionHandled({
                toolCallID: props.request.tool.callID,
                messageID: props.request.tool.messageID,
                startTime: Date.now()
              })
            }

            sdk.client.permission.reply({
              reply: "always",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
      <Match when={!store.always}>
        <Prompt
          title="Permission required"
          body={
            <Switch>
              <Match when={props.request.permission === "edit"}>
                <EditBody request={props.request} />
              </Match>
              <Match when={props.request.permission === "read"}>
                <TextBody icon="→" title={`Read ` + normalizePath(input().filePath as string)} />
              </Match>
              <Match when={props.request.permission === "glob"}>
                <TextBody icon="✱" title={`Glob "` + (input().pattern ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "grep"}>
                <TextBody icon="✱" title={`Grep "` + (input().pattern ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "list"}>
                <TextBody icon="→" title={`List ` + normalizePath(input().path as string)} />
              </Match>
              <Match when={props.request.permission === "bash"}>
                <TextBody
                  icon="#"
                  title={(input().description as string) ?? ""}
                  description={("$ " + input().command) as string}
                />
              </Match>
              <Match when={props.request.permission === "task"}>
                <TextBody
                  icon="#"
                  title={`${Locale.titlecase((input().subagent_type as string) ?? "Unknown")} Task`}
                  description={"◉ " + input().description}
                />
              </Match>
              <Match when={props.request.permission === "webfetch"}>
                <TextBody icon="%" title={`WebFetch ` + (input().url ?? "")} />
              </Match>
              <Match when={props.request.permission === "websearch"}>
                <TextBody icon="◈" title={`Exa Web Search "` + (input().query ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "codesearch"}>
                <TextBody icon="◇" title={`Exa Code Search "` + (input().query ?? "") + `"`} />
              </Match>
              <Match when={props.request.permission === "external_directory"}>
                <TextBody icon="⚠" title={`Access external directory ` + normalizePath(input().path as string)} />
              </Match>
              <Match when={props.request.permission === "doom_loop"}>
                <TextBody icon="⟳" title="Continue after repeated failures" />
              </Match>
              <Match when={true}>
                <TextBody icon="⚙" title={`Call tool ` + props.request.permission} />
              </Match>
            </Switch>
          }
          options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
          active={props.active}
          onSelect={(option) => {
            logToSide(props.side, `User Response: ${option}`)
            if (option === "always") {
              setStore("always", true)
              return
            }

            if (props.onPermissionHandled && props.request.tool && option === "once") {
              props.onPermissionHandled({
                toolCallID: props.request.tool.callID,
                messageID: props.request.tool.messageID,
                startTime: Date.now()
              })
            }

            sdk.client.permission.reply({
              reply: option as "once" | "reject",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
    </Switch>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  body: JSX.Element
  options: T
  onSelect: (option: keyof T) => void
  active: boolean
}) {
  const { theme } = useTheme()
  const keys = Object.keys(props.options) as (keyof T)[]

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.warning}>{"△"}</text>
          <text fg={theme.text}>{props.title}</text>
        </box>
        {props.body}
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
      >
        <box flexDirection="row" gap={1}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundMenu}
                onMouseUp={() => {
                  duelLog.info(`Permission button clicked`, { option: String(option), active: props.active })
                  props.onSelect(option)
                }}
              >
                <text fg={theme.textMuted}>
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </box>
  )
}
