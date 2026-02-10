// Duel state - maps opencode session IDs to backend duel session IDs
// Set during prompt(), read during fetch in provider.ts

import { Log } from "@/util/log"

const log = Log.create({ service: "duel" })

// Maps opencode sessionID -> backend duel session ID
const activeDuels = new Map<string, string>()

export function setDuel(sessionID: string, duelSessionId: string): void {
  log.info("setDuel", { sessionID, duelSessionId })
  activeDuels.set(sessionID, duelSessionId)
}

export function getDuel(sessionID: string): string | undefined {
  return activeDuels.get(sessionID)
}

export function clearDuel(sessionID: string): void {
  log.info("clearDuel", { sessionID })
  activeDuels.delete(sessionID)
}

// Generate a duel session ID (called from TUI side)
export function generateDuelId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}
