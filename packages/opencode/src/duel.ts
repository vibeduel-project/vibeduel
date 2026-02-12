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

// In-flight creation promises to prevent race conditions
const inflightCreations = new Map<string, Promise<{ left: string; right: string }>>()

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

  // If another call is already creating these worktrees, wait for it
  const inflight = inflightCreations.get(duelId)
  if (inflight) {
    log.info("createDuelWorktrees: waiting on in-flight creation", { duelId })
    return inflight
  }

  const promise = doCreateWorktrees(duelId, repoPath, left, right)
  inflightCreations.set(duelId, promise)
  try {
    return await promise
  } finally {
    inflightCreations.delete(duelId)
  }
}

async function doCreateWorktrees(duelId: string, repoPath: string, left: string, right: string): Promise<{ left: string; right: string }> {
  log.info("createDuelWorktrees: creating new worktrees", { duelId, repoPath, left, right })

  // Clean up stale worktrees from previous app runs
  const baseDir = `/tmp/opencode-duel-${duelId}`
  if (await $`test -d ${baseDir}`.quiet().nothrow().then(r => r.exitCode === 0)) {
    log.info("createDuelWorktrees: cleaning up stale worktrees", { duelId, baseDir })
    await $`git worktree remove ${left} --force`.cwd(repoPath).quiet().nothrow()
    await $`git worktree remove ${right} --force`.cwd(repoPath).quiet().nothrow()
    await $`rm -rf ${baseDir}`.quiet().nothrow()
    await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  }

  // Log source directory contents before cloning
  const sourceDump = await $`find ${repoPath} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.cwd(repoPath).quiet().text()
  log.info("createDuelWorktrees: source directory contents", { duelId, repoPath, dump: sourceDump.trim() })

  // Create worktrees from HEAD, then overlay working directory contents
  // so worktrees match what's on disk, not just what's committed
  await $`git worktree add ${left} HEAD --detach`.cwd(repoPath).quiet()
  await $`rsync -a --exclude=.git ${repoPath}/ ${left}/`.quiet()
  const leftDump = await $`find ${left} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
  log.info("createDuelWorktrees: left worktree created (with working dir overlay)", { duelId, left, dump: leftDump.trim() })

  await $`git worktree add ${right} HEAD --detach`.cwd(repoPath).quiet()
  await $`rsync -a --exclude=.git ${repoPath}/ ${right}/`.quiet()
  const rightDump = await $`find ${right} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
  log.info("createDuelWorktrees: right worktree created (with working dir overlay)", { duelId, right, dump: rightDump.trim() })

  createdWorktrees.add(duelId)
  return { left, right }
}

export async function applyWinnerWorktree(duelId: string, winningSide: "left" | "right", repoPath: string): Promise<void> {
  const worktree = `/tmp/opencode-duel-${duelId}/${winningSide}`
  log.info("applyWinnerWorktree: copying winner changes back", { duelId, winningSide, worktree, repoPath })

  const winnerDump = await $`find ${worktree} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
  log.info("applyWinnerWorktree: winner worktree contents", { duelId, winningSide, dump: winnerDump.trim() })

  await $`rsync -a --exclude=.git ${worktree}/ ${repoPath}/`.quiet()

  const resultDump = await $`find ${repoPath} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.cwd(repoPath).quiet().text()
  log.info("applyWinnerWorktree: original directory after copy-back", { duelId, repoPath, dump: resultDump.trim() })
}

// Generate a duel session ID (called from TUI side)
export function generateDuelId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}
