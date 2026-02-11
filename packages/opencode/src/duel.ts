// Duel state - maps opencode session IDs to backend duel session IDs
// Set during prompt(), read during fetch in provider.ts

import { Log } from "@/util/log"
import { $ } from "bun"

const log = Log.create({ service: "duel" })

// Maps opencode sessionID -> backend duel session ID
const activeDuels = new Map<string, string>()

// Maps opencode sessionID -> git worktree path for that side
const duelWorktrees = new Map<string, string>()

// Tracks which duel IDs have had their worktrees created
const createdWorktrees = new Set<string>()

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

export function setDuelWorktree(sessionID: string, worktreePath: string): void {
  log.info("setDuelWorktree", { sessionID, worktreePath })
  duelWorktrees.set(sessionID, worktreePath)
}

export function getDuelWorktree(sessionID: string): string | undefined {
  return duelWorktrees.get(sessionID)
}

export function clearDuelWorktree(sessionID: string): void {
  log.info("clearDuelWorktree", { sessionID })
  duelWorktrees.delete(sessionID)
}

export async function createDuelWorktrees(duelId: string, repoPath: string): Promise<{ left: string; right: string }> {
  const left = `/tmp/opencode-duel-${duelId}/left`
  const right = `/tmp/opencode-duel-${duelId}/right`

  if (createdWorktrees.has(duelId)) {
    log.info("createDuelWorktrees: already exist, reusing", { duelId, left, right })
    return { left, right }
  }

  log.info("createDuelWorktrees: creating new worktrees", { duelId, repoPath, left, right })

  await $`git worktree add ${left} HEAD --detach`.cwd(repoPath).quiet()
  log.info("createDuelWorktrees: left worktree created", { duelId, left })

  await $`git worktree add ${right} HEAD --detach`.cwd(repoPath).quiet()
  log.info("createDuelWorktrees: right worktree created", { duelId, right })

  createdWorktrees.add(duelId)
  return { left, right }
}

// Generate a duel session ID (called from TUI side)
export function generateDuelId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}
