import { Prompt, type PromptRef, getDuelCount } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { DidYouKnow, randomizeTip } from "../component/did-you-know"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData, useRoute } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "../context/local"
import { Identifier } from "@/id/id"
import { generateDuelRoundId, logRoundStart } from "@/duel"
import { getSessionTrackingNumber } from "@/session-tracking"
import { Log } from "@/util/log"

const duelLog = Log.create({ service: "duel" })

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const routeData = useRouteData("home")
  const { navigate } = useRoute()
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const sdk = useSDK()
  const local = useLocal()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    return false
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  // Leaderboard stats
  const [leaderboard, setLeaderboard] = createSignal<any[] | null>(null)
  const [stats, setStats] = createSignal<any | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [newDuelsDelta, setNewDuelsDelta] = createSignal<number>(0)

  const CACHE_KEY = "duel_stats_cache"
  const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

  async function fetchDuelStats() {
    const bunEnv = typeof Bun !== "undefined" ? (Bun as { env: Record<string, string | undefined> }).env : undefined
    const apiKey = process.env["VIBEDUEL_API_KEY"] ?? bunEnv?.VIBEDUEL_API_KEY

    if (!apiKey) {
      setError("No API key available")
      return
    }

    const cached = kv.get(CACHE_KEY) as
      | { leaderboard: any[]; stats: any; timestamp: number; prevTotalVotes?: number }
      | undefined
    let prevTotalVotes = cached?.prevTotalVotes
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setLeaderboard(cached.leaderboard)
      setStats(cached.stats)
      const currentTotal = cached.stats?.total_votes || 0
      if (prevTotalVotes !== undefined && prevTotalVotes < currentTotal) {
        setNewDuelsDelta(currentTotal - prevTotalVotes)
      }
      return
    }

    try {
      setLoading(true)
      setError(null)

      const baseURL = process.env["VIBEDUEL_BASE_URL"] ?? bunEnv?.VIBEDUEL_BASE_URL ?? "https://api.vibeduel.ai/v1"

      // Fetch both endpoints in parallel
      const [leaderboardRes, statsRes] = await Promise.all([
        fetch(`${baseURL}/duel/leaderboard`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        fetch(`${baseURL}/duel/stats`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      ])

      if (!leaderboardRes.ok) {
        setError(`Failed to load leaderboard: ${leaderboardRes.status}`)
        return
      }
      const leaderboardData = await leaderboardRes.json()
      setLeaderboard(leaderboardData.leaderboard || [])

      if (!statsRes.ok) {
        setError(`Failed to load stats: ${statsRes.status}`)
        return
      }
      const statsData = await statsRes.json()
      setStats(statsData)

      // Cache the results
      const currentTotal = statsData.total_votes || 0
      if (prevTotalVotes !== undefined && prevTotalVotes < currentTotal) {
        setNewDuelsDelta(currentTotal - prevTotalVotes)
      } else {
        setNewDuelsDelta(0)
      }
      kv.set(CACHE_KEY, {
        leaderboard: leaderboardData.leaderboard || [],
        stats: statsData,
        timestamp: Date.now(),
        prevTotalVotes: prevTotalVotes ?? currentTotal,
      })
    } catch (err) {
      console.error("Failed to fetch duel stats:", err)
      setError("Failed to load leaderboard data")
    } finally {
      setLoading(false)
    }
  }

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    randomizeTip()
    fetchDuelStats()
    if (once) return
    if (routeData.initialPrompt) {
      prompt.set(routeData.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })
  const directory = useDirectory()

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        {/* Side by side layout: Logo on left, Leaderboard on right */}
        <box flexDirection="row" gap={2} paddingRight={2} alignItems="center" width="100%" maxWidth={90}>
          {/* Logo - takes about 40% of width */}
          <box flexGrow={1} flexBasis={50} alignItems="center" justifyContent="center">
            <Logo />
          </box>

          {/* Leaderboard Section - takes about 60% of width */}
          <Show when={!isFirstTimeUser()}>
            <box
              flexGrow={1}
              flexBasis={50}
              paddingTop={1}
              paddingBottom={0}
              paddingRight={1}
              width={40}
              justifyContent="center"
            >
              <Show when={error()}>
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={theme.error}>{error()}</text>
                </box>
              </Show>

              <box
                backgroundColor={theme.textMuted}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <text fg={theme.background}>
                  <strong>Leaderboard</strong>
                </text>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.backgroundElement}>
                    {loading() ? "loading..." : `from ${stats()?.total_votes || 0} duels`}
                  </text>
                  <Show when={newDuelsDelta() > 0}>
                    <text fg={theme.background}>(+{newDuelsDelta()} new)</text>
                  </Show>
                </box>
              </box>
              <box
                backgroundColor={theme.backgroundPanel}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
              >
                {/* Leaderboard rows - show top 5 */}
                <box gap={0}>
                  {leaderboard()
                    ?.slice(0, 5)
                    .map((item, index) => (
                      <box flexDirection="row" justifyContent="space-between" alignItems="center">
                        <box flexDirection="row" gap={2} alignItems="center" width={25}>
                          {/* Conditional coloring based on rank */}
                          <text
                            fg={
                              index === 0
                                ? theme.primary
                                : index === 1
                                  ? theme.secondary
                                  : index === 2
                                    ? theme.accent
                                    : theme.text
                            }
                          >
                            {item.rank}.
                          </text>
                          <text
                            fg={
                              index === 0
                                ? theme.primary
                                : index === 1
                                  ? theme.secondary
                                  : index === 2
                                    ? theme.accent
                                    : theme.text
                            }
                          >
                            {item.model === null || item.model === undefined
                              ? "Tied"
                              : (() => {
                                  const name = item.model.includes("/")
                                    ? (() => {
                                        const parts = item.model.split("/")[1]
                                        // Strip trailing part like -A35B from Qwen3-Coder-480B-A35B
                                        return parts.includes("-") &&
                                          /\d+B$/.test(parts.split("-").slice(0, -1).join("-"))
                                          ? parts.split("-").slice(0, -1).join("-")
                                          : parts
                                      })()
                                    : item.model
                                  return index < 3 ? <strong>{name}</strong> : name
                                })()}
                          </text>
                        </box>
                        <box flexDirection="row" gap={2} alignItems="center">
                          <text fg={theme.textMuted}>
                            {item.win_rate === null || item.win_rate === undefined
                              ? "Tied"
                              : `${item.win_rate.toFixed(1)}%`}{" "}
                            ({item.rating ?? 0})
                          </text>
                        </box>
                      </box>
                    ))}
                </box>
              </box>
            </box>
          </Show>
        </box>

        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            compareMode={local.model.current()?.modelID === "duel"}
            onSubmit={async (sessionID, promptInfo, duelRoundId) => {
              duelLog.info("home onSubmit", { sessionID, duelRoundId, isDuel: !!duelRoundId })
              if (duelRoundId) {
                try {
                  // Create N-1 opponent sessions
                  const duelCount = getDuelCount()
                  const opponentIDs: string[] = []
                  for (let i = 0; i < duelCount - 1; i++) {
                    const opponentSession = await sdk.client.session.create({})
                    if (opponentSession.data?.id) opponentIDs.push(opponentSession.data.id)
                  }

                  if (opponentIDs.length > 0) {
                    logRoundStart({
                      sessionTrackingNumber: getSessionTrackingNumber(),
                      duelRoundId,
                      slots: [sessionID, ...opponentIDs],
                    })
                    const selectedModel = local.model.current()
                    const nonTextParts = promptInfo.parts.filter((part) => part.type !== "text")

                    for (let i = 0; i < opponentIDs.length; i++) {
                      sdk.client.session.prompt({
                        sessionID: opponentIDs[i],
                        messageID: Identifier.ascending("message"),
                        agent: local.agent.current().name,
                        model: selectedModel!,
                        variant: local.model.variant.current(),
                        sessionTrackingNumber: getSessionTrackingNumber(),
                        parts: [
                          {
                            id: Identifier.ascending("part"),
                            type: "text" as const,
                            text: promptInfo.input,
                          },
                          ...nonTextParts.map((x) => ({
                            id: Identifier.ascending("part"),
                            ...x,
                          })),
                        ],
                        duelRoundId,
                        duelSlot: i + 1,
                        duelSlotCount: duelCount,
                      })
                    }

                    navigate({
                      type: "session",
                      sessionID,
                      opponentSessionIDs: opponentIDs,
                      duelRoundId,
                    })
                    return
                  }
                } catch {
                  // fall back to single-session view
                }
              }
              duelLog.info("home navigating single-pane", { sessionID })
              navigate({
                type: "session",
                sessionID,
              })
            }}
          />
        </box>
        <Toast />
      </box>
      <Show when={!isFirstTimeUser()}>
        <Show when={showTips()}>
          <DidYouKnow />
        </Show>
      </Show>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
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
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
