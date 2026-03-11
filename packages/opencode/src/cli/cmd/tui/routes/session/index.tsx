import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  TextAttributes,
  type RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef, autoDuelPreviousModel, clearAutoDuelPreviousModel, getDuelCount } from "@tui/component/prompt"
import { Spinner } from "../../component/spinner"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { Log } from "@/util/log"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { PatchTool } from "@/tool/patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { Identifier } from "@/id/id"

function logToSlot(slot: number, text: string) {
  duelLog.info(text, { slot })
}
import { applyWinnerWorktree, snapshotOriginalFiles, previewWorktree, revertToOriginal, clearSnapshot, logRoundStart } from "@/duel"
import { setSessionTrackingNumber, getSessionTrackingNumber } from "@/session-tracking"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { iife } from "@/util/iife"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { pipe, sumBy } from "remeda"
import { usePromptRef } from "../../context/prompt"
import { Filesystem } from "@/util/filesystem"
import { PermissionPrompt } from "./permission"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"

addDefaultParsers(parsers.parsers)

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  usernameVisible: () => boolean
  showDetails: () => boolean
  diffWrapMode: () => "word" | "none"
  showAssistantMetadata: () => boolean
  showScrollbar: () => boolean
  sync: ReturnType<typeof useSync>
  setConceal: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowThinking: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowTimestamps: (v: boolean | ((prev: boolean) => boolean)) => void
  setUsernameVisible: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowDetails: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowAssistantMetadata: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowScrollbar: (v: boolean | ((prev: boolean) => boolean)) => void
  sidebar: () => "show" | "hide" | "auto"
  setSidebar: (v: "show" | "hide" | "auto" | ((prev: "show" | "hide" | "auto") => "show" | "hide" | "auto")) => void
  sidebarVisible: () => boolean
  setDiffWrapMode: (v: "word" | "none" | ((prev: "word" | "none") => "word" | "none")) => void
  animationsEnabled: () => boolean
  setAnimationsEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  activeSessionID: () => string
  setActiveSessionID: (id: string) => void
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

const duelLog = Log.create({ service: "duel" })

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const toast = useToast()
  const sdk = useSDK()
  const local = useLocal()

  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "hide"))
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = createSignal(kv.get("thinking_visibility", true))
  const [showTimestamps, setShowTimestamps] = createSignal(kv.get("timestamps", "hide") === "show")
  const [usernameVisible, setUsernameVisible] = createSignal(kv.get("username_visible", true))
  const [showDetails, setShowDetails] = createSignal(kv.get("tool_details_visibility", true))
  const [showAssistantMetadata, setShowAssistantMetadata] = createSignal(kv.get("assistant_metadata_visibility", true))
  const [showScrollbar, setShowScrollbar] = createSignal(kv.get("scrollbar_visible", false))
  const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
  const [animationsEnabled, setAnimationsEnabled] = createSignal(kv.get("animations_enabled", true))
  const dimensions = useTerminalDimensions()

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (sidebar() === "show") return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })

  const isSplit = createMemo(() => !!(route.opponentSessionIDs?.length))

  // All session IDs in slot order: [primary, opponent0, opponent1, ...]
  const allSessionIDs = createMemo(() => {
    const ids = [route.sessionID]
    if (route.opponentSessionIDs) ids.push(...route.opponentSessionIDs)
    return ids
  })

  // Track which session pane is currently active (has focus)
  const [activeSessionID, setActiveSessionID] = createSignal(route.sessionID)

  // Ensure active session is valid (defaults to route.sessionID if invalid)
  createEffect(() => {
    if (!allSessionIDs().includes(activeSessionID())) {
      setActiveSessionID(route.sessionID)
    }
  })

  // Button colors for each slot
  const [slotColors, setSlotColors] = createSignal<(string | RGBA | undefined)[]>([])
  // When navigating from home.tsx, the prompt was already submitted before this component mounts,
  // so onSubmit (which sets awaitingVote=true) never fires. Initialize to isSplit() to cover that case.
  const initialAwaitingVote = isSplit()
  duelLog.info("session mount", {
    isSplit: initialAwaitingVote,
    awaitingVoteInitial: initialAwaitingVote,
    duelSessionId: route.duelSessionId,
    sessionIDs: allSessionIDs(),
  })
  const [awaitingVote, setAwaitingVote] = createSignal(initialAwaitingVote)
  // Track the duel session ID for voting. On mount (first round from home), read from route.
  // On subsequent rounds, captured from Prompt's onSubmit callback.
  const [currentDuelId, setCurrentDuelId] = createSignal<string | undefined>(route.duelSessionId)
  const [lastChosenSessionID, setLastChosenSessionID] = createSignal<string | undefined>(undefined)
  // Deferred fork: store which slot won so the fork happens on next message submit, not immediately on vote
  const [pendingForkWinner, setPendingForkWinner] = createSignal<number | undefined>(undefined)
  // Model reveal after voting: maps sessionID → model name (as returned by backend)
  const [modelReveal, setModelReveal] = createSignal<Record<string, string> | undefined>(undefined)
  const [lastToggleAt, setLastToggleAt] = createSignal(0)
  const [autoDuelDone, setAutoDuelDone] = createSignal(false)

  // Preview state: tracks which slot is currently previewed in the user's repo
  const [previewedSlot, setPreviewedSlot] = createSignal<number | null>(null)
  const [previewInFlight, setPreviewInFlight] = createSignal(false)

  // Which slot the user is currently viewing in duel mode (-1 = "All" split view)
  const [viewingSlot, setViewingSlot] = createSignal(0)
  const isAllView = createMemo(() => viewingSlot() === -1)
  const showAllTab = createMemo(() => isSplit() && (allSessionIDs().length === 2 || allSessionIDs().length === 4))
  // Mouse hover tracking for All view debug logging
  const [mousePos, setMousePos] = createSignal<{ x: number; y: number }>({ x: -1, y: -1 })
  const hoverPollTimer = setInterval(() => {
    if (!isAllView()) {
      duelLog.info("hover poll", { result: "not in all view" })
      return
    }
    const { x, y } = mousePos()
    if (x < 0 || y < 0) {
      duelLog.info("hover poll", { result: "no mouse position", x, y })
      return
    }
    const tabBarHeight = 6
    const halfW = Math.floor(dimensions().width / 2)
    const halfH = Math.floor((dimensions().height - tabBarHeight) / 2)
    const col = x < halfW ? 0 : 1
    const row = y < tabBarHeight + halfH ? 0 : 1
    const slotCount = allSessionIDs().length
    let slot: number
    if (slotCount === 2) {
      slot = col
    } else {
      slot = row * 2 + col
    }
    duelLog.info("hover poll", { slot, x, y, col, row, halfW, halfH, tabBarHeight, slotCount })
  }, 1000)
  onCleanup(() => clearInterval(hoverPollTimer))

  // Animated ellipsis for "Running" status
  const [dotCount, setDotCount] = createSignal(1)
  const dotTimer = setInterval(() => setDotCount((c) => (c % 3) + 1), 500)
  onCleanup(() => clearInterval(dotTimer))
  const runningText = () => ("Running" + ".".repeat(dotCount())).padEnd(10)

  const [controlSlot, setControlSlot] = createSignal(1)
  const [scrollToBottomFns, setScrollToBottomFns] = createSignal<((() => void) | undefined)[]>([])

  // Shared scrollbox refs for All view scroll routing
  const allViewScrollRefs: (ScrollBoxRenderable | undefined)[] = []
  const [selectedSlots, setSelectedSlots] = createSignal<Set<number>>(new Set())

  // All view prompt: primary = first selected slot, broadcast = rest
  const allViewPrimarySessionID = createMemo(() => {
    const sorted = [...selectedSlots()].sort()
    if (sorted.length === 0) return undefined
    return allSessionIDs()[sorted[0]]
  })
  const allViewBroadcastSessionIDs = createMemo(() => {
    const sorted = [...selectedSlots()].sort()
    if (sorted.length <= 1) return undefined
    return sorted.slice(1).map(s => allSessionIDs()[s])
  })

  function getSlotAtMouse(x: number, y: number): number | null {
    const tabBarH = 6
    const halfW = Math.floor(dimensions().width / 2)
    const slotCount = allSessionIDs().length
    const col = x < halfW ? 0 : 1
    if (slotCount === 2) return col
    const halfH = Math.floor((dimensions().height - tabBarH) / 2)
    const row = y < tabBarH + halfH ? 0 : 1
    return row * 2 + col
  }

  function routeScrollToCorrectSlot(sourceSlot: number, event: any) {
    const targetSlot = getSlotAtMouse(event.x, event.y)
    if (targetSlot === null || targetSlot === sourceSlot) return false
    const targetScroll = allViewScrollRefs[targetSlot]
    if (!targetScroll) return false
    const dir = event.scroll?.direction
    const delta = event.scroll?.delta ?? 0
    if (dir === "up") targetScroll.scrollBy(-delta)
    else if (dir === "down") targetScroll.scrollBy(delta)
    return true
  }

  const promptSessionID = createMemo(() => route.sessionID)
  // In follow-up mode, route prompt to the viewed slot's session
  const activePromptSessionID = createMemo(() => {
    if (awaitingVote() && isSplit() && viewingSlot() > 0 && route.opponentSessionIDs) {
      return route.opponentSessionIDs[viewingSlot() - 1]
    }
    return route.sessionID
  })
  const messages = createMemo(() => sync.data.message[promptSessionID()] ?? [])
  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })
  const promptSession = createMemo(() => sync.session.get(promptSessionID()))

  // Children sessions for subagent navigation
  const children = createMemo(() => {
    const s = promptSession()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })

  const promptPermissions = createMemo(() => {
    const s = promptSession()
    if (!s) return []
    if (s.parentID) return sync.data.permission[promptSessionID()] ?? []
    const parentID = s.parentID ?? s.id
    const opponentIDs = new Set(route.opponentSessionIDs ?? [])
    const children = sync.data.session
      .filter((x) => (x.parentID === parentID || x.id === parentID) && !opponentIDs.has(x.id))
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return children.flatMap((x) => sync.data.permission[x.id] ?? [])
  })

  const showPrompt = createMemo(() => {
    return promptPermissions().length === 0
  })
  // Check if the last assistant message in each slot's session is done
  const slotMessages = createMemo(() =>
    allSessionIDs().map(id => sync.data.message[id] ?? [])
  )
  const slotDone = createMemo(() =>
    slotMessages().map(msgs => {
      const last = msgs.findLast((x) => x.role === "assistant")
      return !!last?.time.completed
    })
  )
  const allDone = createMemo(() => slotDone().every(d => d))

  createEffect(() => {
    if (!isSplit()) return
    const slots = slotMessages()
    const ids = allSessionIDs()
    const summary = ids.map((id, i) => {
      const msgs = slots[i]
      const details = msgs.map((msg) => {
        const parts = sync.data.part[msg.id] ?? []
        const text = parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("")
        const content = text.length > 0
          ? text.length <= 100
            ? text
            : `hash:${Array.from(new Uint8Array(new TextEncoder().encode(text).buffer.slice(0, 32))).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16)}`
          : "(no text)"
        return { role: msg.role, content }
      })
      return { slot: i, sessionID: id, count: msgs.length, messages: details }
    })
    duelLog.info("slotMessages state", { slots: summary })
  })

  // Show vote controls when all models are done and awaiting vote
  const showVoteControls = createMemo(() => isSplit() && awaitingVote() && allDone())
  // Disable prompt only while models are actively generating in duel mode
  const promptDisabled = createMemo(() => isSplit() && awaitingVote() && !allDone())

  // Tab bar height: paddingTop(1) + borderTop(1) + 2 text lines + borderBottom(1) + paddingBottom(1) = 6
  // Vote bar height: paddingTop(1) + button row(3) + hint text(1) = 5
  // Prompt bar height: paddingBottom(1) + border(2) + input(1) = 4
  // Wrapper border: top(1) + bottom(1) = 2
  const allViewPaneHeight = createMemo(() => {
    const tabBarHeight = 6
    const voteBarHeight = showVoteControls() ? 5 : 0
    const promptBarHeight = selectedSlots().size > 0 ? 4 : 0
    const wrapperBorder = 2
    const rows = allSessionIDs().length === 4 ? 2 : 1
    return Math.floor((dimensions().height - tabBarHeight - voteBarHeight - promptBarHeight) / rows) - wrapperBorder
  })

  createEffect(() => {
    const split = isSplit()
    const awaiting = awaitingVote()
    const done = allDone()
    const prompt = showPrompt()
    const disabled = promptDisabled()
    const voteControls = showVoteControls()
    const visible = prompt && voteControls
    duelLog.info("vote-buttons visibility changed", {
      visible,
      showPrompt: prompt,
      promptDisabled: disabled,
      isSplit: split,
      awaitingVote: awaiting,
      allDone: done,
      slotDone: slotDone(),
      sessionIDs: allSessionIDs(),
    })
  })

  const promptMaxWidth = createMemo(() => Math.min(96, Math.max(0, dimensions().width - 4)))

  let prompt: PromptRef
  createEffect(() => {
    if (route.initialPrompt && prompt) {
      prompt.set(route.initialPrompt)
    }
  })

  createEffect(
    on(
      () => route.sessionID,
      () => {
        setAutoDuelDone(false)
      },
    ),
  )

  createEffect(() => {
    if (isSplit()) return
    duelLog.info("not split, clearing vote state")
    setAwaitingVote(false)
    setPreviewedSlot(null)
    setViewingSlot(0)
    setSlotColors([])
  })

  // Guard against double-fire: @opentui renderer dispatches mouseup twice when
  // capturedRenderable is set (falls through after handling captured element)
  const [voteInFlight, setVoteInFlight] = createSignal(false)

  // Preview a slot's changes in the user's repo (reversible)
  const handlePreview = async (slot: number) => {
    if (!route.opponentSessionIDs?.length) return
    if (previewInFlight()) return
    if (previewedSlot() === slot) return
    setPreviewInFlight(true)
    const duelId = currentDuelId()
    duelLog.info("handlePreview", { slot, duelId, previousPreview: previewedSlot() })

    if (duelId) {
      // Snapshot original files on first preview (lazy — worktrees are guaranteed to exist by now)
      await snapshotOriginalFiles(duelId, process.cwd(), allSessionIDs().length)
      // Revert any existing preview before applying the new one
      if (previewedSlot() !== null) {
        await revertToOriginal(duelId, process.cwd())
      }
      await previewWorktree(duelId, slot, process.cwd())
    }

    setPreviewedSlot(slot)
    setControlSlot(slot)
    // Highlight selected slot, clear others
    setSlotColors(allSessionIDs().map((_, i) => i === slot ? theme.success : undefined))
    setPreviewInFlight(false)
  }

  // Undo any preview, restoring the original code
  const handleUndo = async () => {
    if (previewInFlight()) return
    if (previewedSlot() === null) return
    setPreviewInFlight(true)
    const duelId = currentDuelId()
    duelLog.info("handleUndo", { duelId, previousPreview: previewedSlot() })

    if (duelId) {
      await revertToOriginal(duelId, process.cwd())
    }

    setPreviewedSlot(null)
    setSlotColors([])
    setPreviewInFlight(false)
  }

  // Submit the vote for the currently previewed slot
  const finalizeVote = async () => {
    const slot = previewedSlot()
    if (slot === null || !route.opponentSessionIDs?.length) return
    if (voteInFlight()) return
    setVoteInFlight(true)
    const winningID = allSessionIDs()[slot]
    const duelId = currentDuelId()
    duelLog.info("finalizeVote", {
      slot,
      duelSessionId: duelId,
      winningSessionID: winningID,
    })

    // Submit vote to backend
    if (duelId) {
      const baseURL = process.env["VIBEDUEL_BASE_URL"] ?? "https://api.vibeduel.ai/v1"
      const apiKey = process.env["VIBEDUEL_API_KEY"]
      const res = await fetch(`${baseURL.replace(/\/v1$/, "")}/v1/duel/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ duel_session_id: duelId, winner_opencode_session: winningID }),
      })
      const result = await res.json()
      duelLog.info("vote submitted", {
        duelSessionId: duelId,
        winnerModel: result.winner,
        models: result.models,
        modelKeys: result.models ? Object.keys(result.models) : [],
        allSessionIDs: allSessionIDs(),
        ratingUpdate: result.rating_update,
      })
      // Strip "openai/" prefix if present and store as sessionID → cleanName map
      const cleanName = (name: string) => name.replace(/^openai\//, "")
      const reveal: Record<string, string> = {}
      for (const [sid, model] of Object.entries(result.models ?? {})) {
        reveal[sid] = cleanName(model as string)
      }
      setModelReveal(reveal)
      // Clean up snapshot — the preview is now permanent
      clearSnapshot(duelId)
    } else {
      duelLog.warn("no duel session ID available, vote not submitted")
    }

    // No need to apply worktree — it's already previewed in place

    // Fork the winner into a fresh x-opencode-session so each round uses new IDs
    const fork = await sdk.client.session.fork({ sessionID: winningID })
    const freshID = fork.data!.id
    duelLog.info("finalizeVote: forked winner to fresh session", { winningID, freshID })

    setLastChosenSessionID(freshID)
    setViewingSlot(slot)
    setControlSlot(slot)
    // Store the winning slot so the fork-after-vote flow uses freshID on next prompt
    setPendingForkWinner(slot)
    setPreviewedSlot(null)
    setAwaitingVote(false)
    setVoteInFlight(false)

    if (autoDuelPreviousModel) {
      const model = autoDuelPreviousModel
      clearAutoDuelPreviousModel()
      duelLog.info("auto-duel: scheduling switch back to previous model", { model })
      setTimeout(() => {
        duelLog.info("auto-duel: switching back to previous model", { model })
        local.model.set(model)
      }, 2000)
    }
  }

  const enterDuel = async () => {
    if (isSplit()) {
      duelLog.info("enterDuel skipped, already split")
      return
    }
    duelLog.info("enterDuel starting", { sessionID: route.sessionID })
    try {
      const fork = await sdk.client.session.fork({ sessionID: route.sessionID })
      if (!fork.data) throw new Error("No session id returned")
      duelLog.info("enterDuel forked", { primarySessionID: route.sessionID, opponentSessionID: fork.data.id })
      navigate({
        type: "session",
        sessionID: route.sessionID,
        opponentSessionIDs: [fork.data.id],
      })
    } catch (e) {
      toast.show({
        message: "Failed to start duel mode",
        variant: "error",
      })
    }
  }

  createEffect(() => {
    if (autoDuelDone()) return
    if (isSplit()) return
    const model = local.model.current()
    if (!model || model.modelID !== "duel") {
      duelLog.info("auto-duel skipped", { modelID: model?.modelID ?? "none" })
      return
    }
    setAutoDuelDone(true)
    void enterDuel()
  })

  createEffect(() => {
    const model = local.model.current()
    if (!isSplit()) return
    if (model?.modelID === "duel") return
    duelLog.info("model switched away from duel, exiting split", { modelID: model?.modelID ?? "none" })
    setAutoDuelDone(false)
    exitDuel()
  })

  const exitDuel = async () => {
    if (!route.opponentSessionIDs?.length) return
    // Use last voted session, or default to slot 0 if no vote happened
    const selectedID = lastChosenSessionID() ?? route.sessionID
    duelLog.info("exitDuel", {
      selectedSessionID: selectedID,
      hadVote: !!lastChosenSessionID(),
      previewedSlot: previewedSlot(),
    })

    // Revert any active preview before exiting
    const duelId = currentDuelId()
    if (previewedSlot() !== null && duelId) {
      await revertToOriginal(duelId, process.cwd())
    }
    if (duelId) {
      clearSnapshot(duelId)
    }

    // Clear all duel state
    setAwaitingVote(false)
    setPendingForkWinner(undefined)
    setPreviewedSlot(null)
    setViewingSlot(0)
    setModelReveal(undefined)
    setSlotColors([])
    setLastChosenSessionID(undefined)

    navigate({
      type: "session",
      sessionID: selectedID,
      opponentSessionIDs: undefined,
    })
  }

  function VoteButtons() {
    return (
      <box flexDirection="row" justifyContent="center" gap={1}>
        <For each={allSessionIDs()}>
          {(_, index) => (
            <box
              border={["left", "right", "top", "bottom"]}
              borderColor={(slotColors()[index()] as string | undefined) ?? theme.border}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                duelLog.info("preview clicked", { slot: index(), timestamp: Date.now() })
                handlePreview(index())
              }}
            >
              <text fg={(slotColors()[index()] as string | undefined) ?? theme.text}>Slot {index()}</text>
            </box>
          )}
        </For>
        <box
          border={["left", "right", "top", "bottom"]}
          borderColor={previewedSlot() !== null ? theme.border : theme.textMuted}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => {
            duelLog.info("undo clicked", { timestamp: Date.now() })
            handleUndo()
          }}
        >
          <text fg={previewedSlot() !== null ? theme.text : theme.textMuted}>Undo</text>
        </box>
        <box
          border={["left", "right", "top", "bottom"]}
          borderColor={previewedSlot() !== null ? theme.success : theme.textMuted}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => {
            duelLog.info("submit clicked", { timestamp: Date.now(), previewedSlot: previewedSlot() })
            finalizeVote()
          }}
        >
          <text fg={previewedSlot() !== null ? theme.success : theme.textMuted}>Submit</text>
        </box>
      </box>
    )
  }

  function VoteHint() {
    return (
      <text fg={theme.textMuted}>
        {previewedSlot() !== null
          ? `previewing slot ${previewedSlot()} — click submit to vote`
          : "click a slot to preview, or type a follow-up"}
      </text>
    )
  }

  return (
    <context.Provider
      value={{
        get width() {
          return dimensions().width
        },
        sessionID: route.sessionID,
        conceal,
        setConceal,
        showThinking,
        setShowThinking,
        showTimestamps,
        setShowTimestamps,
        usernameVisible,
        setUsernameVisible,
        showDetails,
        setShowDetails,
        showAssistantMetadata,
        setShowAssistantMetadata,
        showScrollbar,
        setShowScrollbar,
        sidebar,
        setSidebar,
        sidebarVisible,
        diffWrapMode,
        setDiffWrapMode,
        animationsEnabled,
        setAnimationsEnabled,
        sync,
        activeSessionID,
        setActiveSessionID,
      }}
    >
      <box flexDirection="column">
        <box flexDirection="column" flexGrow={1}>
          <Show when={isSplit()}>
            <box flexDirection="row" justifyContent="center" paddingTop={1} paddingBottom={1} flexShrink={0} zIndex={100}>
              <box width={Math.min(78, (allSessionIDs().length + (showAllTab() ? 1 : 0)) * 20)} flexDirection="row" gap={1}>
                <Show when={pendingForkWinner() !== undefined && modelReveal()} fallback={
                  <>
                  <For each={allSessionIDs()}>
                    {(sessionID, index) => (
                      <box
                        flexGrow={1}
                        border={["left", "right", "top", "bottom"]}
                        borderColor={viewingSlot() === index() ? theme.success : theme.border}
                        paddingLeft={1}
                        paddingRight={1}
                        onMouseUp={() => {
                          duelLog.info("tab clicked", { slot: index(), timestamp: Date.now() })
                          setViewingSlot(index())
                          setControlSlot(index())
                        }}
                      >
                        <box flexDirection="column">
                          <text fg={viewingSlot() === index() ? theme.success : theme.text}>Slot {index()}</text>
                          <text fg={theme.textMuted}>{(slotDone()[index()] ? "Completed" : runningText()).padEnd(10)}</text>
                        </box>
                      </box>
                    )}
                  </For>
                  <Show when={showAllTab()}>
                    <box
                      flexGrow={1}
                      border={["left", "right", "top", "bottom"]}
                      borderColor={isAllView() ? theme.success : theme.border}
                      paddingLeft={1}
                      paddingRight={1}
                      onMouseUp={() => {
                        duelLog.info("tab clicked", { slot: "all", timestamp: Date.now() })
                        setViewingSlot(-1)
                      }}
                    >
                      <box flexDirection="column">
                        <text fg={isAllView() ? theme.success : theme.text}>All</text>
                        <text fg={theme.textMuted}>{(allDone() ? "Completed" : runningText()).padEnd(10)}</text>
                      </box>
                    </box>
                  </Show>
                  </>
                }>
                  <box
                    flexGrow={1}
                    border={["left", "right", "top", "bottom"]}
                    borderColor={theme.success}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <box flexDirection="column">
                      <text fg={theme.success}>{modelReveal()![allSessionIDs()[pendingForkWinner()!]]}</text>
                      <text fg={theme.textMuted}>Completed</text>
                    </box>
                  </box>
                </Show>
              </box>
            </box>
          </Show>
          <Show when={isAllView()} fallback={
            <box flexDirection="row" flexGrow={1}>
              <SessionPane
                sessionID={allSessionIDs()[viewingSlot()] ?? route.sessionID}
                width={dimensions().width}
                isSplit={isSplit()}
                slot={viewingSlot()}
                controlSlot={controlSlot()}
                opponentSessionIDs={route.opponentSessionIDs}
                onScrollToBottom={(fn) => {
                  setScrollToBottomFns(prev => {
                    const next = [...prev]
                    next[viewingSlot()] = fn
                    return next
                  })
                }}
              />
            </box>
          }>
            <box flexDirection="column" flexGrow={1} height="100%" onMouseMove={(e: any) => setMousePos({ x: e.x, y: e.y })}>
              <box flexDirection="row" flexGrow={1} height="50%">
                <box width="50%" height="100%" border={["left", "right", "top", "bottom"]} borderColor={selectedSlots().has(0) ? theme.success : theme.border} overflow="hidden">
                  <box position="absolute" top={0} right={0} zIndex={200}
                    paddingLeft={1} paddingRight={1}
                    backgroundColor={selectedSlots().has(0) ? theme.success : theme.backgroundElement}
                    onMouseUp={() => {
                      setSelectedSlots(prev => {
                        const next = new Set(prev)
                        if (next.has(0)) next.delete(0); else next.add(0)
                        duelLog.info("slot selector clicked", { slot: 0, selected: [...next], selectedSessionIDs: [...next].map(s => allSessionIDs()[s]) })
                        return next
                      })
                    }}
                  >
                    <text fg={selectedSlots().has(0) ? theme.background : theme.text}>{selectedSlots().has(0) ? "✓" : "○"}</text>
                  </box>
                  <SessionPane
                    sessionID={allSessionIDs()[0]}
                    width={Math.floor(dimensions().width / 2) - 2}
                    height={allViewPaneHeight()}
                    isSplit={isSplit()}
                    slot={0}
                    controlSlot={controlSlot()}
                    opponentSessionIDs={route.opponentSessionIDs}
                    onScrollRef={(r) => { allViewScrollRefs[0] = r }}
                    onScrollIntercept={routeScrollToCorrectSlot}
                  />
                </box>
                <box width="50%" height="100%" border={["left", "right", "top", "bottom"]} borderColor={selectedSlots().has(1) ? theme.success : theme.border} overflow="hidden">
                  <box position="absolute" top={0} right={0} zIndex={200}
                    paddingLeft={1} paddingRight={1}
                    backgroundColor={selectedSlots().has(1) ? theme.success : theme.backgroundElement}
                    onMouseUp={() => {
                      setSelectedSlots(prev => {
                        const next = new Set(prev)
                        if (next.has(1)) next.delete(1); else next.add(1)
                        duelLog.info("slot selector clicked", { slot: 1, selected: [...next], selectedSessionIDs: [...next].map(s => allSessionIDs()[s]) })
                        return next
                      })
                    }}
                  >
                    <text fg={selectedSlots().has(1) ? theme.background : theme.text}>{selectedSlots().has(1) ? "✓" : "○"}</text>
                  </box>
                  <SessionPane
                    sessionID={allSessionIDs()[1]}
                    width={Math.floor(dimensions().width / 2) - 2}
                    height={allViewPaneHeight()}
                    isSplit={isSplit()}
                    slot={1}
                    controlSlot={controlSlot()}
                    opponentSessionIDs={route.opponentSessionIDs}
                    onScrollRef={(r) => { allViewScrollRefs[1] = r }}
                    onScrollIntercept={routeScrollToCorrectSlot}
                  />
                </box>
              </box>
              <Show when={allSessionIDs().length === 4}>
                <box flexDirection="row" flexGrow={1} height="50%">
                  <box width="50%" height="100%" border={["left", "right", "top", "bottom"]} borderColor={theme.border} overflow="hidden">
                    <SessionPane
                      sessionID={allSessionIDs()[2]}
                      width={Math.floor(dimensions().width / 2) - 2}
                      height={allViewPaneHeight()}
                      isSplit={isSplit()}
                      slot={2}
                      controlSlot={controlSlot()}
                      opponentSessionIDs={route.opponentSessionIDs}
                      onScrollRef={(r) => { allViewScrollRefs[2] = r }}
                      onScrollIntercept={routeScrollToCorrectSlot}
                    />
                  </box>
                  <box width="50%" height="100%" border={["left", "right", "top", "bottom"]} borderColor={theme.border} overflow="hidden">
                    <SessionPane
                      sessionID={allSessionIDs()[3]}
                      width={Math.floor(dimensions().width / 2) - 2}
                      height={allViewPaneHeight()}
                      isSplit={isSplit()}
                      slot={3}
                      controlSlot={controlSlot()}
                      opponentSessionIDs={route.opponentSessionIDs}
                      onScrollRef={(r) => { allViewScrollRefs[3] = r }}
                      onScrollIntercept={routeScrollToCorrectSlot}
                    />
                  </box>
                </box>
              </Show>
              <Show when={showVoteControls()}>
                <box flexShrink={0} flexDirection="column" alignItems="center" paddingTop={1} gap={0}>
                  <VoteButtons />
                  <VoteHint />
                </box>
              </Show>
              <Show when={selectedSlots().size > 0}>
                <box flexShrink={0} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} paddingBottom={1}>
                  <box width="100%" maxWidth={promptMaxWidth()}>
                    <Prompt
                      visible={true}
                      compareMode={false}
                      awaitingVote={false}
                      disabled={false}
                      focused={isAllView()}
                      broadcastSessionIDs={allViewBroadcastSessionIDs()}
                      sessionID={allViewPrimarySessionID()!}
                      onSubmit={async () => {
                        duelLog.info("allView prompt submitted", { selectedSlots: [...selectedSlots()], primarySessionID: allViewPrimarySessionID(), broadcastSessionIDs: allViewBroadcastSessionIDs() })
                      }}
                    />
                  </box>
                </box>
              </Show>
            </box>
          </Show>
          <Show when={showPrompt() && !isAllView()}>
            <box
              flexShrink={0}
              justifyContent="center"
              alignItems="center"
              paddingLeft={2}
              paddingRight={2}
              paddingBottom={1}
            >
              <box width="100%" maxWidth={promptMaxWidth()}>
                <Show when={showVoteControls()}>
                  <box flexDirection="column" alignItems="center" paddingBottom={1} gap={0}>
                    <VoteButtons />
                    <VoteHint />
                  </box>
                </Show>
                <Show when={modelReveal() && !awaitingVote()}>
                  <box flexDirection="row" justifyContent="center" gap={1} paddingBottom={1}>
                    <For each={allSessionIDs()}>
                      {(sessionID, index) => (
                        <>
                          <Show when={index() > 0}><text fg={theme.textMuted}> | </text></Show>
                          <text fg={theme.textMuted}>Slot {index()}: </text>
                          <text fg={theme.text}>{modelReveal()![sessionID] ?? "unknown"}</text>
                        </>
                      )}
                    </For>
                  </box>
                </Show>
                <Prompt
                  visible={true}
                  broadcastSessionIDs={route.opponentSessionIDs?.length && !awaitingVote() ? route.opponentSessionIDs : undefined}
                  compareMode={local.model.current()?.modelID === "duel" && !awaitingVote()}
                  awaitingVote={awaitingVote()}
                  skipAutoSend={pendingForkWinner() !== undefined}
                  duelSessionId={awaitingVote() ? currentDuelId() : undefined}
                  disabled={promptDisabled()}
                  focused={!promptDisabled()}
                  ref={(r) => {
                    prompt = r
                    promptRef.set(r)
                  }}
                  onSubmit={async (_sessionID, _promptInfo, duelSessionId) => {
                    const winnerSlot = pendingForkWinner()
                    duelLog.info("onSubmit fired", {
                      duelSessionId,
                      pendingForkWinner: winnerSlot,
                      skipAutoSend: winnerSlot !== undefined,
                      sessionIDs: allSessionIDs(),
                    })

                    // When skipAutoSend is true (pending fork), we handle everything:
                    // 1. Fork the winner N-1 times
                    // 2. Send prompt to winner (slot 0) and each fork (slots 1..N-1)
                    // 3. Navigate with new opponent IDs
                    if (winnerSlot !== undefined && route.opponentSessionIDs?.length) {
                      // Use the freshly forked session from finalizeVote (stored in lastChosenSessionID)
                      const winningID = lastChosenSessionID() ?? allSessionIDs()[winnerSlot]
                      duelLog.info("forking winner on next message", { winnerSlot, winningSessionID: winningID })

                      const nonTextParts = _promptInfo.parts.filter((part) => part.type !== "text")
                      const parts = [
                        { id: Identifier.ascending("part"), type: "text" as const, text: _promptInfo.input },
                        ...nonTextParts.map((x) => ({ id: Identifier.ascending("part"), ...x })),
                      ]
                      const promptPayload = {
                        agent: local.agent.current().name,
                        model: local.model.current()!,
                        variant: local.model.variant.current(),
                        sessionTrackingNumber: getSessionTrackingNumber(),
                        parts,
                        duelSessionId,
                      }

                      // Fork winner N-1 times BEFORE sending any prompts
                      // (so forks copy pre-prompt history, avoiding duplicate user messages)
                      const forkDuelCount = getDuelCount()
                      const newOpponentIDs: string[] = []
                      for (let i = 0; i < forkDuelCount - 1; i++) {
                        const fork = await sdk.client.session.fork({ sessionID: winningID })
                        if (fork.data) {
                          newOpponentIDs.push(fork.data.id)
                        }
                      }

                      // Now send prompts to winner (slot 0) and all forks (slots 1..N-1)
                      duelLog.info("sending prompt to winner", { sessionID: winningID, duelSessionId, duelSlot: 0, duelSlotCount: forkDuelCount })
                      sdk.client.session.prompt({
                        sessionID: winningID,
                        messageID: Identifier.ascending("message"),
                        ...promptPayload,
                        duelSlot: 0,
                        duelSlotCount: forkDuelCount,
                      })
                      for (let i = 0; i < newOpponentIDs.length; i++) {
                        const forkedID = newOpponentIDs[i]
                        duelLog.info("sending prompt to fork", { sessionID: forkedID, duelSessionId, duelSlot: i + 1, duelSlotCount: forkDuelCount })
                        sdk.client.session.prompt({
                          sessionID: forkedID,
                          messageID: Identifier.ascending("message"),
                          ...promptPayload,
                          duelSlot: i + 1,
                          duelSlotCount: forkDuelCount,
                        })
                      }

                      logRoundStart({
                        sessionTrackingNumber: getSessionTrackingNumber(),
                        sessionId: duelSessionId!,
                        slots: [winningID, ...newOpponentIDs],
                      })

                      navigate({
                        type: "session",
                        sessionID: winningID,
                        opponentSessionIDs: newOpponentIDs,
                      })
                      setPendingForkWinner(undefined)
                    }

                    const scrollFn = scrollToBottomFns()[viewingSlot()]
                    scrollFn?.()
                    if (isSplit()) {
                      if (duelSessionId && duelSessionId !== currentDuelId()) {
                        // New duel round (initial or after vote) — reset all state
                        duelLog.info("prompt submitted in split mode, setting awaitingVote=true", { duelSessionId })
                        setCurrentDuelId(duelSessionId)
                        setModelReveal(undefined)
                        setSlotColors([])
                        setPreviewedSlot(null)
                        setViewingSlot(0)
                        setAwaitingVote(true)
                      } else {
                        // Follow-up message to one slot — keep vote state intact
                        duelLog.info("follow-up submitted to one slot", { sessionID: _sessionID, duelSessionId, viewingSlot: viewingSlot() })
                      }
                    }
                  }}
                  sessionID={activePromptSessionID()}
                />
              </box>
            </box>
          </Show>
        </box>
        <Toast />
      </box>
    </context.Provider>
  )
}

function SessionPane(props: {
  sessionID: string
  width: number
  height?: number
  isSplit: boolean
  slot: number
  controlSlot: number
  opponentSessionIDs?: string[]
  onScrollToBottom?: (fn: () => void) => void
  onScrollRef?: (scroll: ScrollBoxRenderable) => void
  onScrollIntercept?: (slot: number, event: any) => boolean
}) {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const route = useRouteData("session")
  const { navigate } = useRoute()

  duelLog.info("SessionPane mount", { slot: props.slot, sessionID: props.sessionID })

  createEffect(() => {
    duelLog.info("SessionPane dimensions", { slot: props.slot, width: props.width, height: props.height })
  })

  const session = createMemo(() => sync.session.get(props.sessionID))
  const parentCtx = use()
  // Create a merged context for this pane
  const ctx = {
    ...parentCtx,
    get sessionID() {
      return props.sessionID
    },
  }

  const {
    conceal,
    setConceal,
    showThinking,
    setShowThinking,
    showTimestamps,
    setShowTimestamps,
    usernameVisible,
    setUsernameVisible,
    showDetails,
    setShowDetails,
    showAssistantMetadata,
    setShowAssistantMetadata,
    showScrollbar,
    setShowScrollbar,
    sidebar,
    setSidebar,
    sidebarVisible,
    diffWrapMode,
    setDiffWrapMode,
    animationsEnabled,
    setAnimationsEnabled,
  } = ctx

  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const permissions = createMemo(() => {
    const s = session()
    if (!s) return []
    if (s.parentID) return sync.data.permission[props.sessionID] ?? []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => {
      if (x.role !== "assistant") return false
      if (x.time.completed) return false
      if (x.finish && !["tool-calls", "unknown"].includes(x.finish)) return false
      return true
    })?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  createEffect(() => {
    const msgs = messages()
    const last = lastAssistant()
    const p = pending()
    duelLog.info("pane state", {
      slot: props.slot,
      sessionID: props.sessionID,
      messageCount: msgs.length,
      lastAssistantID: last?.id,
      lastAssistantCompleted: !!last?.time.completed,
      pendingAssistantID: p,
    })
  })

  const dimensions = useTerminalDimensions()
  const wide = createMemo(() => dimensions().width > 120)

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  createEffect(async () => {
    await sync.session
      .sync(props.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        // Only navigate home if the main session is missing, but for now just log error for pane
        toast.show({
          message: `Session not found: ${props.sessionID}`,
          variant: "error",
        })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  const [lastLoggedID, setLastLoggedID] = createSignal<string | null>(null)
  createEffect(() => {
    const msg = lastAssistant()
    if (!msg || !msg.time.completed || msg.id === lastLoggedID()) return

    const parts = sync.data.part[msg.id] ?? []
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("")

    duelLog.info("assistant message completed", {
      slot: props.slot,
      sessionID: props.sessionID,
      messageID: msg.id,
      textLength: text.length,
    })
    setLastLoggedID(msg.id)
  })

  let scroll: ScrollBoxRenderable
  const keybind = useKeybind()

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  function moveChild(direction: number) {
    if (children().length === 1) return
    let next = children().findIndex((x) => x.id === session()?.id) + direction
    if (next >= children().length) next = 0
    if (next < 0) next = children().length - 1
    if (children()[next]) {
      navigate({
        type: "session",
        sessionID: children()[next].id,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    ...(sync.data.config.share !== "disabled"
      ? [
          {
            title: "Share session",
            value: "session.share",
            suggested: route.type === "session",
            keybind: "session_share" as const,
            disabled: !!session()?.share?.url,
            category: "Session",
            onSelect: async (dialog: any) => {
              await sdk.client.session
                .share({
                  sessionID: route.sessionID,
                })
                .then((res) =>
                  Clipboard.copy(res.data!.share!.url).catch(() =>
                    toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
                  ),
                )
                .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
                .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
              dialog.clear()
            },
          },
        ]
      : []),
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => promptRef.current?.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      disabled: !session()?.share?.url,
      category: "Session",
      onSelect: async (dialog) => {
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to unshare session", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        promptRef.current?.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      disabled: !session()?.revert?.messageID,
      category: "Session",
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          promptRef.current?.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setSidebar((prev) => {
          if (prev === "auto") return sidebarVisible() ? "hide" : "show"
          if (prev === "show") return "hide"
          return "show"
        })
        if (sidebar() === "show") kv.set("sidebar", "auto")
        if (sidebar() === "hide") kv.set("sidebar", "hide")
        dialog.clear()
      },
    },
    {
      title: usernameVisible() ? "Hide username" : "Show username",
      value: "session.username_visible.toggle",
      keybind: "username_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setUsernameVisible((prev) => {
          const next = !prev
          kv.set("username_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      onSelect: (dialog) => {
        setShowTimestamps((prev) => {
          const next = !prev
          kv.set("timestamps", next ? "show" : "hide")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      category: "Session",
      onSelect: (dialog) => {
        setShowThinking((prev) => {
          const next = !prev
          kv.set("thinking_visibility", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle diff wrapping",
      value: "session.toggle.diffwrap",
      category: "Session",
      onSelect: (dialog) => {
        setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog) => {
        const newValue = !showDetails()
        setShowDetails(newValue)
        kv.set("tool_details_visibility", newValue)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowScrollbar((prev) => {
          const next = !prev
          kv.set("scrollbar_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: animationsEnabled() ? "Disable animations" : "Enable animations",
      value: "session.toggle.animations",
      category: "Session",
      onSelect: (dialog) => {
        setAnimationsEnabled((prev) => {
          const next = !prev
          kv.set("animations_enabled", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      keybind: "session_copy",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
            },
          )
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          const sessionMessages = messages()

          if (!sessionData) return

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await Editor.open({ value: transcript, renderer })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await Bun.write(filepath, transcript)

            // Open with EDITOR if available
            const result = await Editor.open({ value: transcript, renderer })
            if (result !== undefined) {
              await Bun.write(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      enabled: !!session()?.parentID,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      enabled: !!session()?.parentID,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      enabled: !!session()?.parentID,
      onSelect: (dialog) => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      },
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch (error) {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  const [trackedActions, setTrackedActions] = createSignal<
    { toolCallID: string; messageID: string; startTime: number }[]
  >([])

  createEffect(() => {
    const actions = trackedActions()
    if (actions.length === 0) return

    actions.forEach((action) => {
      const parts = sync.data.part[action.messageID] || []
      const toolPart = parts.find((p) => p.type === "tool" && p.callID === action.toolCallID) as ToolPart | undefined
      if (!toolPart) return

      const status = toolPart.state.status
      if (status === "completed" || status === "error") {
        const duration = (Date.now() - action.startTime) / 1000
        logToSlot(props.slot, `Action ${status === "completed" ? "completed" : "failed"} in ${duration.toFixed(2)}s`)

        // Remove from tracking
        setTrackedActions((prev) => prev.filter((a) => a.toolCallID !== action.toolCallID))
      }
    })
  })

  return (
    <context.Provider value={ctx}>
      <box width={props.width} height={props.height} overflow="hidden" paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
        <Show when={session()}>
          <scrollbox
            ref={(r) => {
              scroll = r
              props.onScrollToBottom?.(toBottom)
              props.onScrollRef?.(r)
            }}
            onMouseScroll={function(this: any, e: any) {
              if (props.onScrollIntercept?.(props.slot, e)) {
                // The scrollbox's internal onMouseEvent fires after this listener,
                // so we can't prevent it. Save position now, restore after it fires.
                const saved = scroll.scrollTop
                queueMicrotask(() => { scroll.scrollTop = saved })
              }
            }}
            viewportOptions={{
              paddingRight: showScrollbar() ? 1 : 0,
            }}
            verticalScrollbarOptions={{
              paddingLeft: 1,
              visible: showScrollbar(),
              trackOptions: {
                backgroundColor: theme.backgroundElement,
                foregroundColor: theme.border,
              },
            }}
            stickyScroll={true}
            stickyStart="bottom"
            flexGrow={1}
            scrollAcceleration={scrollAcceleration()}
          >
            <For each={messages()}>
              {(message, index) => (
                <Switch>
                  <Match when={message.id === revert()?.messageID}>
                    {(function () {
                      const command = useCommandDialog()
                      const [hover, setHover] = createSignal(false)
                      const dialog = useDialog()

                      const handleUnrevert = async () => {
                        const confirmed = await DialogConfirm.show(
                          dialog,
                          "Confirm Redo",
                          "Are you sure you want to restore the reverted messages?",
                        )
                        if (confirmed) {
                          command.trigger("session.redo")
                        }
                      }

                      return (
                        <box
                          onMouseOver={() => setHover(true)}
                          onMouseOut={() => setHover(false)}
                          onMouseUp={handleUnrevert}
                          marginTop={1}
                          flexShrink={0}
                          border={["left"]}
                          customBorderChars={SplitBorder.customBorderChars}
                          borderColor={theme.backgroundPanel}
                        >
                          <box
                            paddingTop={1}
                            paddingBottom={1}
                            paddingLeft={2}
                            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                          >
                            <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                            <text fg={theme.textMuted}>
                              <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                              restore
                            </text>
                            <Show when={revert()!.diffFiles?.length}>
                              <box marginTop={1}>
                                <For each={revert()!.diffFiles}>
                                  {(file) => (
                                    <text fg={theme.text}>
                                      {file.filename}
                                      <Show when={file.additions > 0}>
                                        <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                      </Show>
                                      <Show when={file.deletions > 0}>
                                        <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                      </Show>
                                    </text>
                                  )}
                                </For>
                              </box>
                            </Show>
                          </box>
                        </box>
                      )
                    })()}
                  </Match>
                  <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                    <></>
                  </Match>
                  <Match when={message.role === "user"}>
                    <UserMessage
                      index={index()}
                      onMouseUp={() => {
                        if (renderer.getSelection()?.getSelectedText()) return
                        dialog.replace(() => (
                          <DialogMessage
                            messageID={message.id}
                            sessionID={props.sessionID}
                            setPrompt={(promptInfo) => promptRef.current?.set(promptInfo)}
                          />
                        ))
                      }}
                      message={message as UserMessage}
                      parts={sync.data.part[message.id] ?? []}
                      pending={pending()}
                    />
                  </Match>
                  <Match when={message.role === "assistant"}>
                    <AssistantMessage
                      last={lastAssistant()?.id === message.id}
                      message={message as AssistantMessage}
                      parts={sync.data.part[message.id] ?? []}
                    />
                  </Match>
                </Switch>
              )}
            </For>
          </scrollbox>
          <box flexShrink={0}>
            <Show when={permissions().length > 0}>
              <PermissionPrompt
                request={permissions()[0]}
                active={props.controlSlot === props.slot}
                slot={props.slot}
                opponentSessionIDs={props.opponentSessionIDs}
                onPermissionHandled={(action) => setTrackedActions((prev) => [...prev, action])}
              />
            </Show>
          </box>
        </Show>
      </box>
      <Show when={sidebarVisible()}>
        <Sidebar sessionID={props.sessionID} />
      </Show>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text fg={theme.text}>{text()?.text}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={1} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <text fg={theme.textMuted}>
              {ctx.usernameVisible() ? `${sync.data.config.username ?? "You "}` : "You "}
              <Show
                when={queued()}
                fallback={
                  <Show when={ctx.showTimestamps()}>
                    <span style={{ fg: theme.textMuted }}>
                      {ctx.usernameVisible() ? " · " : " "}
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </Show>
                }
              >
                <span> </span>
                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>
              </Show>
            </text>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const toast = useToast()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  createEffect(() => {
    if (props.message.error) {
      toast.show({
        message: "Model returned error — consider using a different model temporarily.",
        variant: "error",
        duration: 5000,
      })
    }
  })

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final()}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span style={{ fg: local.agent.color(props.message.agent) }}>▣ </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={syntax()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const sync = useSync()

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Switch>
      <Match when={props.part.tool === "bash"}>
        <Bash {...toolprops} />
      </Match>
      <Match when={props.part.tool === "glob"}>
        <Glob {...toolprops} />
      </Match>
      <Match when={props.part.tool === "read"}>
        <Read {...toolprops} />
      </Match>
      <Match when={props.part.tool === "grep"}>
        <Grep {...toolprops} />
      </Match>
      <Match when={props.part.tool === "list"}>
        <List {...toolprops} />
      </Match>
      <Match when={props.part.tool === "webfetch"}>
        <WebFetch {...toolprops} />
      </Match>
      <Match when={props.part.tool === "codesearch"}>
        <CodeSearch {...toolprops} />
      </Match>
      <Match when={props.part.tool === "websearch"}>
        <WebSearch {...toolprops} />
      </Match>
      <Match when={props.part.tool === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={props.part.tool === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={props.part.tool === "task"}>
        <Task {...toolprops} />
      </Match>
      <Match when={props.part.tool === "patch"}>
        <Patch {...toolprops} />
      </Match>
      <Match when={props.part.tool === "todowrite"}>
        <TodoWrite {...toolprops} />
      </Match>
      <Match when={true}>
        <GenericTool {...toolprops} />
      </Match>
    </Switch>
  )
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
}
function GenericTool(props: ToolProps<any>) {
  return (
    <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
      {props.tool} {input(props.input)}
    </InlineTool>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

function InlineTool(props: {
  icon: string
  complete: any
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()} children={props.children} />
        </Match>
        <Match when={true}>
          <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ bold: true }}>{props.icon}</span> {props.children}
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: { title: string; children: JSX.Element; onClick?: () => void }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <text paddingLeft={3} fg={theme.textMuted}>
        {props.title}
      </text>
      {props.children}
    </box>
  )
}

function Bash(props: ToolProps<typeof BashTool>) {
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const { theme } = useTheme()
  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool title={"# " + (props.input.description ?? "Shell")}>
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <text fg={theme.text}>{output()}</text>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    return props.metadata.diagnostics?.[filePath] ?? []
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + normalizePath(props.input.filePath!)}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Show when={diagnostics().length}>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
                </text>
              )}
            </For>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  return (
    <InlineTool icon="→" pending="Reading file..." complete={props.input.filePath} part={props.part}>
      Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
    </InlineTool>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
      WebFetch {(props.input as any).url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
      Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  onMount(() => {
    if (props.metadata.sessionId && !sync.data.message[props.metadata.sessionId]?.length)
      sync.session.sync(props.metadata.sessionId)
  })

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => (x.state as any).title))

  const isRunning = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    let content = [`Task ${props.input.description}`]

    if (isRunning() && tools().length > 0) {
      // content[0] += ` · ${tools().length} toolcalls`
      if (current()) content.push(`↳ ${Locale.titlecase(current()!.tool)} ${(current()!.state as any).title}`)
      else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    const arr = props.metadata.diagnostics?.[filePath] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath(props.input.filePath!)}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
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
          <Show when={diagnostics().length}>
            <box>
              <For each={diagnostics()}>
                {(diagnostic) => (
                  <text fg={theme.error}>
                    Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
                    {diagnostic.message}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Patch(props: ToolProps<typeof PatchTool>) {
  const { theme } = useTheme()
  return (
    <Switch>
      <Match when={props.output !== undefined}>
        <BlockTool title="# Patch">
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos">
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
