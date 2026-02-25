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
  log.info("wt_latency: before stale cleanup check", { ts: Date.now(), duelId })
  if (await $`test -d ${baseDir}`.quiet().nothrow().then(r => r.exitCode === 0)) {
    log.info("createDuelWorktrees: cleaning up stale worktrees", { duelId, baseDir })
    await $`git worktree remove ${left} --force`.cwd(repoPath).quiet().nothrow()
    await $`git worktree remove ${right} --force`.cwd(repoPath).quiet().nothrow()
    await $`rm -rf ${baseDir}`.quiet().nothrow()
    await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  }
  log.info("wt_latency: after stale cleanup", { ts: Date.now(), duelId })

  // Log source directory contents before cloning
  // Commented out: adds ~80-100ms latency per dump
  // log.info("wt_latency: before source dump", { ts: Date.now(), duelId })
  // const sourceDump = await $`find ${repoPath} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.cwd(repoPath).quiet().text()
  // log.info("wt_latency: after source dump", { ts: Date.now(), duelId })
  // log.info("createDuelWorktrees: source directory contents", { duelId, repoPath, dump: sourceDump.trim() })

  // Create worktrees from HEAD, then overlay only uncommitted/modified files
  // so worktrees match what's on disk without copying the entire directory
  log.info("wt_latency: before git worktree add both", { ts: Date.now(), duelId })
  await Promise.all([
    $`git worktree add ${left} HEAD --detach`.cwd(repoPath).quiet(),
    $`git worktree add ${right} HEAD --detach`.cwd(repoPath).quiet(),
  ])
  log.info("wt_latency: after git worktree add both", { ts: Date.now(), duelId })

  // Get list of files that differ from HEAD (modified, untracked, deleted)
  log.info("wt_latency: before git diff", { ts: Date.now(), duelId })
  const modifiedRaw = await $`git diff --name-only HEAD`.cwd(repoPath).quiet().text()
  const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(repoPath).quiet().text()
  log.info("wt_latency: after git diff", { ts: Date.now(), duelId })
  const dirtyFiles = [...new Set([
    ...modifiedRaw.trim().split("\n"),
    ...untrackedRaw.trim().split("\n"),
  ])].filter(f => f.length > 0)

  log.info("createDuelWorktrees: overlaying dirty files", { duelId, count: dirtyFiles.length, files: dirtyFiles })

  log.info("wt_latency: before file overlay loop", { ts: Date.now(), duelId })
  for (const file of dirtyFiles) {
    const srcPath = `${repoPath}/${file}`
    const srcExists = await Bun.file(srcPath).exists()
    if (srcExists) {
      // Copy modified/untracked file to both worktrees
      await $`mkdir -p ${left}/${file.substring(0, file.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`mkdir -p ${right}/${file.substring(0, file.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`cp ${srcPath} ${left}/${file}`.quiet()
      await $`cp ${srcPath} ${right}/${file}`.quiet()
    } else {
      // File was deleted in working dir — remove from worktrees too
      await $`rm -f ${left}/${file}`.quiet().nothrow()
      await $`rm -f ${right}/${file}`.quiet().nothrow()
    }
  }
  log.info("wt_latency: after file overlay loop", { ts: Date.now(), duelId })

  // Commented out: adds ~20-200ms latency per dump depending on repo size
  // log.info("wt_latency: before left dump", { ts: Date.now(), duelId })
  // const leftDump = await $`find ${left} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
  // log.info("wt_latency: after left dump", { ts: Date.now(), duelId })
  // log.info("createDuelWorktrees: left worktree created", { duelId, left, dirtyCount: dirtyFiles.length, dump: leftDump.trim() })

  // log.info("wt_latency: before right dump", { ts: Date.now(), duelId })
  // const rightDump = await $`find ${right} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
  // log.info("wt_latency: after right dump", { ts: Date.now(), duelId })
  // log.info("createDuelWorktrees: right worktree created", { duelId, right, dirtyCount: dirtyFiles.length, dump: rightDump.trim() })

  createdWorktrees.add(duelId)
  return { left, right }
}

export async function applyWinnerWorktree(duelId: string, winningSide: "left" | "right", repoPath: string): Promise<void> {
  const worktree = `/tmp/opencode-duel-${duelId}/${winningSide}`
  log.info("applyWinnerWorktree: copying winner changes back", { duelId, winningSide, worktree, repoPath })

  // Only copy files that the model actually changed (diff against HEAD),
  // NOT the entire worktree (which contains the full monorepo)
  const modifiedRaw = await $`git diff --name-only HEAD`.cwd(worktree).quiet().text()
  const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(worktree).quiet().text()
  const changedFiles = [...new Set([
    ...modifiedRaw.trim().split("\n"),
    ...untrackedRaw.trim().split("\n"),
  ])].filter(f => f.length > 0)

  log.info("applyWinnerWorktree: changed files", { duelId, winningSide, count: changedFiles.length, files: changedFiles })

  for (const file of changedFiles) {
    const srcPath = `${worktree}/${file}`
    const dstPath = `${repoPath}/${file}`
    const srcExists = await Bun.file(srcPath).exists()
    if (srcExists) {
      await $`mkdir -p ${dstPath.substring(0, dstPath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`cp ${srcPath} ${dstPath}`.quiet()
      log.info("applyWinnerWorktree: copied file", { duelId, file })
    } else {
      await $`rm -f ${dstPath}`.quiet().nothrow()
      log.info("applyWinnerWorktree: removed file", { duelId, file })
    }
  }

  log.info("applyWinnerWorktree: done", { duelId, winningSide, filesCopied: changedFiles.length })
}

// Generate a duel session ID (called from TUI side)
export function generateDuelId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}
