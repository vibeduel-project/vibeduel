import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { Keybind } from "@/util/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import "opentui-spinner/solid"

export function DialogSessionList() {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const kv = useKV()

  const [toDelete, setToDelete] = createSignal<string>()

  const deleteKeybind = "ctrl+d"

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const isDuelSession = (session: { title: string }) => session.title.startsWith("Duel: ")

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const sessions = sync.data.session as Array<{
      id: string
      title: string
      time: { created: number; updated: number }
      parentID?: string
    }>

    const groupKeyMap = new Map<string, string>()

    const sortedByCreation = sessions.slice().sort((a, b) => a.time.created - b.time.created)

    for (const session of sortedByCreation) {
      if (isDuelSession(session)) {
        if (session.parentID) {
          const parentGroup = groupKeyMap.get(session.parentID)
          if (parentGroup) {
            groupKeyMap.set(session.id, parentGroup)
          } else {
            const parent = sessions.find((s) => s.id === session.parentID)
            if (parent && isDuelSession(parent)) {
              groupKeyMap.set(session.id, session.id)
              groupKeyMap.set(session.parentID, session.id)
            } else {
              groupKeyMap.set(session.id, session.id)
            }
          }
        } else {
          groupKeyMap.set(session.id, session.id)
        }
      }
    }

    const titleToEarliestRoot = new Map<string, string>()
    for (const session of sessions) {
      if (isDuelSession(session)) {
        const groupKey = groupKeyMap.get(session.id)
        if (groupKey) {
          const existing = titleToEarliestRoot.get(session.title)
          if (!existing || existing.localeCompare(groupKey) > 0) {
            titleToEarliestRoot.set(session.title, groupKey)
          }
        }
      }
    }

    for (const session of sessions) {
      if (isDuelSession(session)) {
        const earliestRoot = titleToEarliestRoot.get(session.title)
        if (earliestRoot) {
          groupKeyMap.set(session.id, earliestRoot)
        }
      }
    }

    const groupLatestMap = new Map<string, string>()
    const groupToSessions = new Map<string, typeof sessions>()
    for (const session of sessions) {
      const groupKey = groupKeyMap.get(session.id)
      if (groupKey) {
        const group = groupToSessions.get(groupKey) ?? []
        group.push(session)
        groupToSessions.set(groupKey, group)
      }
    }

    for (const [groupKey, groupSessions] of groupToSessions) {
      const sorted = groupSessions.sort((a, b) => b.time.updated - a.time.updated)
      groupLatestMap.set(groupKey, sorted[0]?.id)
    }

    const result = sessions
      .map((session) => {
        const groupKey = groupKeyMap.get(session.id)
        const latestId = groupKey ? groupLatestMap.get(groupKey) : undefined
        const isIndent = groupKey && latestId !== session.id
        const date = new Date(session.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        return {
          id: session.id,
          title: session.title,
          time: session.time.updated,
          category,
          isDeleting: toDelete() === session.id,
          isWorking: sync.data.session_status?.[session.id]?.type === "busy",
          indent: isIndent,
        }
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, 150)
      .map((x) => ({
        title: x.isDeleting ? `Press ${deleteKeybind} again to confirm` : (x.indent ? "  " : "") + x.title,
        bg: x.isDeleting ? theme.error : undefined,
        value: x.id,
        category: x.category,
        footer: Locale.time(x.time),
        gutter: x.isWorking ? (
          <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
            <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
          </Show>
        ) : undefined,
      }))

    return result
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      current={currentSessionID()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse(deleteKeybind)[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              sdk.client.session.delete({
                sessionID: option.value,
              })
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
