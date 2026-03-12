// Duel state - maps opencode session IDs to backend duel session IDs
// Set during prompt(), read during fetch in provider.ts

import { Log } from "@/util/log"
import { $ } from "bun"
import os from "os"
import path from "path"

const log = Log.create({ service: "duel" })

const _env = typeof Bun !== "undefined" ? (Bun as { env: Record<string, string | undefined> }).env : process.env
const LOG_WORKTREE_DUMPS = _env["VIBEDUEL_LOG_WORKTREE_DUMPS"] === "1"
export const LOG_DUEL_TOOL_OPS = _env["VIBEDUEL_LOG_DUEL_TOOL_OPS"] === "1"

export const DUEL_WORKTREE_BASE = path.join(os.homedir(), ".local", "share", "vibeduel", "worktree")

// Maps opencode sessionID -> backend duel session ID
const activeDuels = new Map<string, string>()

// Maps opencode sessionID -> git worktree path for that side
const duelWorktrees = new Map<string, string>()

// Tracks which duel IDs have had their worktrees created
const createdWorktrees = new Set<string>()

// In-flight creation promises to prevent race conditions
const inflightCreations = new Map<string, Promise<string[]>>()

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

// Extract slot number from a session's worktree path
// Path format: {DUEL_WORKTREE_BASE}/{duelId}/{slot}/...
export function getDuelSlot(sessionID: string): number | undefined {
  const wt = duelWorktrees.get(sessionID)
  if (!wt) return undefined
  const afterBase = wt.slice(DUEL_WORKTREE_BASE.length + 1) // "{duelId}/{slot}/..."
  const slot = afterBase.split("/")[1]
  return slot !== undefined ? parseInt(slot, 10) : undefined
}

export async function createDuelWorktrees(duelId: string, repoPath: string, slotCount: number = 2): Promise<string[]> {
  const paths = Array.from({ length: slotCount }, (_, i) => `${DUEL_WORKTREE_BASE}/${duelId}/${i}`)

  if (createdWorktrees.has(duelId)) {
    log.info("createDuelWorktrees: already exist, reusing", { duelId, slotCount, paths })
    return paths
  }

  // If another call is already creating these worktrees, wait for it
  const inflight = inflightCreations.get(duelId)
  if (inflight) {
    log.info("createDuelWorktrees: waiting on in-flight creation", { duelId })
    return inflight
  }

  const promise = doCreateWorktrees(duelId, repoPath, paths)
  inflightCreations.set(duelId, promise)
  try {
    return await promise
  } finally {
    inflightCreations.delete(duelId)
  }
}

async function doCreateWorktrees(duelId: string, repoPath: string, paths: string[]): Promise<string[]> {
  log.info("createDuelWorktrees: creating new worktrees", { duelId, repoPath, slotCount: paths.length, paths })

  // Clean up stale worktrees from previous app runs
  const baseDir = `${DUEL_WORKTREE_BASE}/${duelId}`
  log.info("wt_latency: before stale cleanup check", { ts: Date.now(), duelId })
  if (await $`test -d ${baseDir}`.quiet().nothrow().then(r => r.exitCode === 0)) {
    log.info("createDuelWorktrees: cleaning up stale worktrees", { duelId, baseDir })
    for (const p of paths) {
      await $`git worktree remove ${p} --force`.cwd(repoPath).quiet().nothrow()
    }
    await $`rm -rf ${baseDir}`.quiet().nothrow()
    await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  }
  log.info("wt_latency: after stale cleanup", { ts: Date.now(), duelId })

  // Log source directory contents before cloning
  if (LOG_WORKTREE_DUMPS) {
    log.info("wt_latency: before source dump", { ts: Date.now(), duelId })
    const sourceDump = await $`find ${repoPath} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.cwd(repoPath).quiet().text()
    log.info("wt_latency: after source dump", { ts: Date.now(), duelId })
    log.info("createDuelWorktrees: source directory contents", { duelId, repoPath, dump: sourceDump.trim() })
  }

  // Create all worktrees from HEAD in parallel
  log.info("wt_latency: before git worktree add all", { ts: Date.now(), duelId })
  await Promise.all(
    paths.map(p => $`git worktree add ${p} HEAD --detach`.cwd(repoPath).quiet())
  )
  log.info("wt_latency: after git worktree add all", { ts: Date.now(), duelId })

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
      for (const p of paths) {
        await $`mkdir -p ${p}/${file.substring(0, file.lastIndexOf("/") + 1)}`.quiet().nothrow()
        await $`cp ${srcPath} ${p}/${file}`.quiet()
      }
    } else {
      for (const p of paths) {
        await $`rm -f ${p}/${file}`.quiet().nothrow()
      }
    }
  }
  log.info("wt_latency: after file overlay loop", { ts: Date.now(), duelId })

  if (LOG_WORKTREE_DUMPS) {
    for (let i = 0; i < paths.length; i++) {
      const dump = await $`find ${paths[i]} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
      log.info(`createDuelWorktrees: slot ${i} worktree created`, { duelId, slot: i, path: paths[i], dirtyCount: dirtyFiles.length, dump: dump.trim() })
    }
  }

  createdWorktrees.add(duelId)
  return paths
}

// Returns the list of files changed in a worktree relative to HEAD
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  const modifiedRaw = await $`git diff --name-only HEAD`.cwd(worktreePath).quiet().text()
  const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(worktreePath).quiet().text()
  return [...new Set([
    ...modifiedRaw.trim().split("\n"),
    ...untrackedRaw.trim().split("\n"),
  ])].filter(f => f.length > 0)
}

export async function applyWinnerWorktree(duelId: string, winnerSlot: number, repoPath: string): Promise<void> {
  const worktree = `${DUEL_WORKTREE_BASE}/${duelId}/${winnerSlot}`
  log.info("applyWinnerWorktree: copying winner changes back", { duelId, winnerSlot, worktree, repoPath })

  const changedFiles = await getChangedFiles(worktree)
  log.info("applyWinnerWorktree: changed files", { duelId, winnerSlot, count: changedFiles.length, files: changedFiles })

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

  log.info("applyWinnerWorktree: done", { duelId, winnerSlot, filesCopied: changedFiles.length })
}

// In-memory snapshots of original file contents before any preview is applied
// Maps duelId -> (relative file path -> original content or null if file didn't exist)
const originalSnapshots = new Map<string, Map<string, Buffer | null>>()

// Snapshot the original state of all files that any slot changed
export async function snapshotOriginalFiles(duelId: string, repoPath: string, slotCount: number = 2): Promise<void> {
  if (originalSnapshots.has(duelId)) {
    log.info("snapshotOriginalFiles: already snapshotted", { duelId })
    return
  }

  const slotPaths = Array.from({ length: slotCount }, (_, i) => `${DUEL_WORKTREE_BASE}/${duelId}/${i}`)
  const fileArrays = await Promise.all(slotPaths.map(p => getChangedFiles(p)))
  const allFiles = [...new Set(fileArrays.flat())]
  log.info("snapshotOriginalFiles: snapshotting", { duelId, slotCount, count: allFiles.length, files: allFiles })

  const snapshot = new Map<string, Buffer | null>()
  for (const file of allFiles) {
    const filePath = `${repoPath}/${file}`
    const exists = await Bun.file(filePath).exists()
    if (exists) {
      const content = Buffer.from(await Bun.file(filePath).arrayBuffer())
      snapshot.set(file, content)
    } else {
      snapshot.set(file, null)
    }
  }

  originalSnapshots.set(duelId, snapshot)
  log.info("snapshotOriginalFiles: done", { duelId, fileCount: snapshot.size })
}

// Preview a slot's worktree by copying its changes into the repo (reversible via revertToOriginal)
export async function previewWorktree(duelId: string, slot: number, repoPath: string): Promise<void> {
  const worktree = `${DUEL_WORKTREE_BASE}/${duelId}/${slot}`
  log.info("previewWorktree: applying preview", { duelId, slot, worktree, repoPath })

  const changedFiles = await getChangedFiles(worktree)
  log.info("previewWorktree: changed files", { duelId, slot, count: changedFiles.length, files: changedFiles })

  for (const file of changedFiles) {
    const srcPath = `${worktree}/${file}`
    const dstPath = `${repoPath}/${file}`
    const srcExists = await Bun.file(srcPath).exists()
    if (srcExists) {
      await $`mkdir -p ${dstPath.substring(0, dstPath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`cp ${srcPath} ${dstPath}`.quiet()
    } else {
      await $`rm -f ${dstPath}`.quiet().nothrow()
    }
  }

  log.info("previewWorktree: done", { duelId, slot, fileCount: changedFiles.length })
}

// Revert the repo to the original state from the snapshot
export async function revertToOriginal(duelId: string, repoPath: string): Promise<void> {
  const snapshot = originalSnapshots.get(duelId)
  if (!snapshot) {
    log.warn("revertToOriginal: no snapshot found", { duelId })
    return
  }

  log.info("revertToOriginal: reverting", { duelId, fileCount: snapshot.size })

  for (const [file, content] of snapshot) {
    const filePath = `${repoPath}/${file}`
    if (content === null) {
      // File didn't exist before — delete it
      await $`rm -f ${filePath}`.quiet().nothrow()
      log.info("revertToOriginal: removed file", { duelId, file })
    } else {
      // Restore original content
      await $`mkdir -p ${filePath.substring(0, filePath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await Bun.write(filePath, content)
      log.info("revertToOriginal: restored file", { duelId, file })
    }
  }

  log.info("revertToOriginal: done", { duelId })
}

// Clean up the snapshot for a completed duel
export function clearSnapshot(duelId: string): void {
  log.info("clearSnapshot", { duelId })
  originalSnapshots.delete(duelId)
}

// Generate a duel session ID (called from TUI side)
export function generateDuelId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}

// Round counter for logging
let currentTrackingNumber: string | undefined
let roundNumber = 0

export function logRoundStart(opts: {
  sessionTrackingNumber: string
  sessionId: string
  slots: string[]
}): void {
  if (opts.sessionTrackingNumber !== currentTrackingNumber) {
    currentTrackingNumber = opts.sessionTrackingNumber
    roundNumber = 1
  } else {
    roundNumber++
  }
  const slotDetails = opts.slots.map((xOpenCodeSession, i) => `slot${i}=${xOpenCodeSession}`).join(" ")
  log.info("round start", {
    round: roundNumber,
    slotCount: opts.slots.length,
    session_tracking_number: opts.sessionTrackingNumber,
    session_id: opts.sessionId,
    slots: slotDetails,
  })
}
