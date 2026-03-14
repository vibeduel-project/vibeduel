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

export function setDuel(sessionID: string, duelRoundId: string): void {
  log.info("setDuel", { sessionID, duelRoundId })
  activeDuels.set(sessionID, duelRoundId)
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
// Path format: {DUEL_WORKTREE_BASE}/{duelRoundId}/{slot}/...
export function getDuelSlot(sessionID: string): number | undefined {
  const wt = duelWorktrees.get(sessionID)
  if (!wt) return undefined
  const afterBase = wt.slice(DUEL_WORKTREE_BASE.length + 1) // "{duelRoundId}/{slot}/..."
  const slot = afterBase.split("/")[1]
  return slot !== undefined ? parseInt(slot, 10) : undefined
}

export async function createDuelWorktrees(duelRoundId: string, repoPath: string, slotCount: number = 2): Promise<string[]> {
  const paths = Array.from({ length: slotCount }, (_, i) => `${DUEL_WORKTREE_BASE}/${duelRoundId}/${i}`)

  if (createdWorktrees.has(duelRoundId)) {
    log.info("createDuelWorktrees: already exist, reusing", { duelRoundId, slotCount, paths })
    return paths
  }

  // If another call is already creating these worktrees, wait for it
  const inflight = inflightCreations.get(duelRoundId)
  if (inflight) {
    log.info("createDuelWorktrees: waiting on in-flight creation", { duelRoundId })
    return inflight
  }

  const promise = doCreateWorktrees(duelRoundId, repoPath, paths)
  inflightCreations.set(duelRoundId, promise)
  try {
    return await promise
  } finally {
    inflightCreations.delete(duelRoundId)
  }
}

async function doCreateWorktrees(duelRoundId: string, repoPath: string, paths: string[]): Promise<string[]> {
  log.info("createDuelWorktrees: creating new worktrees", { duelRoundId, repoPath, slotCount: paths.length, paths })

  // Clean up stale worktrees from previous app runs
  const baseDir = `${DUEL_WORKTREE_BASE}/${duelRoundId}`
  log.info("wt_latency: before stale cleanup check", { ts: Date.now(), duelRoundId })
  if (await $`test -d ${baseDir}`.quiet().nothrow().then(r => r.exitCode === 0)) {
    log.info("createDuelWorktrees: cleaning up stale worktrees", { duelRoundId, baseDir })
    for (const p of paths) {
      log.info("worktree removed (stale)", { duelRoundId, path: p })
      await $`git worktree remove ${p} --force`.cwd(repoPath).quiet().nothrow()
    }
    await $`rm -rf ${baseDir}`.quiet().nothrow()
    await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  }
  log.info("wt_latency: after stale cleanup", { ts: Date.now(), duelRoundId })

  // Log source directory contents before cloning
  if (LOG_WORKTREE_DUMPS) {
    log.info("wt_latency: before source dump", { ts: Date.now(), duelRoundId })
    const sourceDump = await $`find ${repoPath} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.cwd(repoPath).quiet().text()
    log.info("wt_latency: after source dump", { ts: Date.now(), duelRoundId })
    log.info("createDuelWorktrees: source directory contents", { duelRoundId, repoPath, dump: sourceDump.trim() })
  }

  // Create all worktrees from HEAD in parallel
  log.info("wt_latency: before git worktree add all", { ts: Date.now(), duelRoundId })
  await Promise.all(
    paths.map(async p => {
      await $`git worktree add ${p} HEAD --detach`.cwd(repoPath).quiet()
      log.info("worktree created", { duelRoundId, path: p })
    })
  )
  log.info("wt_latency: after git worktree add all", { ts: Date.now(), duelRoundId })

  // Get list of files that differ from HEAD (modified, untracked, deleted)
  log.info("wt_latency: before git diff", { ts: Date.now(), duelRoundId })
  const modifiedRaw = await $`git diff --name-only HEAD`.cwd(repoPath).quiet().text()
  const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(repoPath).quiet().text()
  log.info("wt_latency: after git diff", { ts: Date.now(), duelRoundId })
  const dirtyFiles = [...new Set([
    ...modifiedRaw.trim().split("\n"),
    ...untrackedRaw.trim().split("\n"),
  ])].filter(f => f.length > 0)

  log.info("createDuelWorktrees: overlaying dirty files", { duelRoundId, count: dirtyFiles.length, files: dirtyFiles })

  log.info("wt_latency: before file overlay loop", { ts: Date.now(), duelRoundId })
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
  log.info("wt_latency: after file overlay loop", { ts: Date.now(), duelRoundId })

  if (LOG_WORKTREE_DUMPS) {
    for (let i = 0; i < paths.length; i++) {
      const dump = await $`find ${paths[i]} -maxdepth 2 -type f -not -path '*/\.git/*' -exec sh -c 'echo "=== {} ===" && cat "{}"' \;`.quiet().text()
      log.info(`createDuelWorktrees: slot ${i} worktree created`, { duelRoundId, slot: i, path: paths[i], dirtyCount: dirtyFiles.length, dump: dump.trim() })
    }
  }

  createdWorktrees.add(duelRoundId)
  return paths
}

// Returns the list of files changed in a worktree relative to HEAD
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  log.info("getChangedFiles: running git diff", { worktreePath })
  const modifiedRaw = await $`git diff --name-only HEAD`.cwd(worktreePath).quiet().text()
  log.info("getChangedFiles: git diff result", { worktreePath, raw: modifiedRaw.trim(), files: modifiedRaw.trim().split("\n").filter(f => f.length > 0) })

  log.info("getChangedFiles: running git ls-files --others", { worktreePath })
  const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(worktreePath).quiet().text()
  log.info("getChangedFiles: git ls-files result", { worktreePath, raw: untrackedRaw.trim(), files: untrackedRaw.trim().split("\n").filter(f => f.length > 0) })

  const result = [...new Set([
    ...modifiedRaw.trim().split("\n"),
    ...untrackedRaw.trim().split("\n"),
  ])].filter(f => f.length > 0)
  log.info("getChangedFiles: final result", { worktreePath, count: result.length, files: result })
  return result
}

export async function applyWinnerWorktree(duelRoundId: string, winnerSlot: number, repoPath: string): Promise<void> {
  const worktree = `${DUEL_WORKTREE_BASE}/${duelRoundId}/${winnerSlot}`
  log.info("applyWinnerWorktree: copying winner changes back", { duelRoundId, winnerSlot, worktree, repoPath })

  const changedFiles = await getChangedFiles(worktree)
  log.info("applyWinnerWorktree: changed files", { duelRoundId, winnerSlot, count: changedFiles.length, files: changedFiles })

  for (const file of changedFiles) {
    const srcPath = `${worktree}/${file}`
    const dstPath = `${repoPath}/${file}`
    const srcExists = await Bun.file(srcPath).exists()
    log.info("applyWinnerWorktree: processing file", { duelRoundId, file, srcPath, dstPath, srcExists })
    if (srcExists) {
      await $`mkdir -p ${dstPath.substring(0, dstPath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`cp ${srcPath} ${dstPath}`.quiet()
      log.info("applyWinnerWorktree: copied file", { duelRoundId, file })
    } else {
      await $`rm -f ${dstPath}`.quiet().nothrow()
      log.info("applyWinnerWorktree: removed file (src missing)", { duelRoundId, file })
    }
  }

  log.info("applyWinnerWorktree: done", { duelRoundId, winnerSlot, filesCopied: changedFiles.length })

  await cleanupRoundWorktrees(duelRoundId, repoPath)
}

export async function cleanupRoundWorktrees(duelRoundId: string, repoPath: string): Promise<void> {
  const baseDir = `${DUEL_WORKTREE_BASE}/${duelRoundId}`
  log.info("cleanupRoundWorktrees: removing worktrees", { duelRoundId, baseDir })
  const entries = await $`ls ${baseDir}`.quiet().nothrow().text()
  for (const slot of entries.trim().split("\n").filter(s => s.length > 0)) {
    const wtPath = `${baseDir}/${slot}`
    log.info("worktree removed (vote cleanup)", { duelRoundId, path: wtPath })
    await $`git worktree remove ${wtPath} --force`.cwd(repoPath).quiet().nothrow()
  }
  await $`rm -rf ${baseDir}`.quiet().nothrow()
  await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  createdWorktrees.delete(duelRoundId)
  log.info("cleanupRoundWorktrees: done", { duelRoundId })
}

// In-memory snapshots of original file contents before any preview is applied
// Maps duelRoundId -> (relative file path -> original content or null if file didn't exist)
const originalSnapshots = new Map<string, Map<string, Buffer | null>>()

// Snapshot the original state of all files that any slot changed
export async function snapshotOriginalFiles(duelRoundId: string, repoPath: string, slotCount: number = 2): Promise<void> {
  const existing = originalSnapshots.get(duelRoundId)

  const slotPaths = Array.from({ length: slotCount }, (_, i) => `${DUEL_WORKTREE_BASE}/${duelRoundId}/${i}`)
  log.info("snapshotOriginalFiles: gathering changed files from slots", { duelRoundId, slotCount, slotPaths, hasExisting: !!existing })
  const fileArrays = await Promise.all(slotPaths.map(p => getChangedFiles(p)))
  log.info("snapshotOriginalFiles: per-slot changed files", { duelRoundId, fileArrays: fileArrays.map((files, i) => ({ slot: i, files })) })
  const allFiles = [...new Set(fileArrays.flat())]

  // Filter to only new files not already in the snapshot
  const newFiles = existing ? allFiles.filter(f => !existing.has(f)) : allFiles
  log.info("snapshotOriginalFiles: snapshotting", { duelRoundId, slotCount, totalCount: allFiles.length, newCount: newFiles.length, newFiles })

  if (newFiles.length === 0 && existing) {
    log.info("snapshotOriginalFiles: no new files to snapshot", { duelRoundId })
    return
  }

  const snapshot = existing ?? new Map<string, Buffer | null>()
  for (const file of newFiles) {
    const filePath = `${repoPath}/${file}`
    const exists = await Bun.file(filePath).exists()
    log.info("snapshotOriginalFiles: file state", { duelRoundId, file, filePath, existsInRepo: exists, willBeNull: !exists })
    if (exists) {
      const content = Buffer.from(await Bun.file(filePath).arrayBuffer())
      snapshot.set(file, content)
    } else {
      snapshot.set(file, null)
    }
  }

  originalSnapshots.set(duelRoundId, snapshot)
  log.info("snapshotOriginalFiles: done", { duelRoundId, fileCount: snapshot.size })
}

// Preview a slot's worktree by copying its changes into the repo (reversible via revertToOriginal)
export async function previewWorktree(duelRoundId: string, slot: number, repoPath: string): Promise<void> {
  const worktree = `${DUEL_WORKTREE_BASE}/${duelRoundId}/${slot}`
  log.info("previewWorktree: applying preview", { duelRoundId, slot, worktree, repoPath })

  const changedFiles = await getChangedFiles(worktree)
  log.info("previewWorktree: changed files", { duelRoundId, slot, count: changedFiles.length, files: changedFiles })

  for (const file of changedFiles) {
    const srcPath = `${worktree}/${file}`
    const dstPath = `${repoPath}/${file}`
    const srcExists = await Bun.file(srcPath).exists()
    log.info("previewWorktree: processing file", { duelRoundId, slot, file, srcPath, dstPath, srcExists })
    if (srcExists) {
      await $`mkdir -p ${dstPath.substring(0, dstPath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await $`cp ${srcPath} ${dstPath}`.quiet()
      log.info("previewWorktree: copied file", { duelRoundId, slot, file })
    } else {
      await $`rm -f ${dstPath}`.quiet().nothrow()
      log.info("previewWorktree: removed file (src missing)", { duelRoundId, slot, file })
    }
  }

  log.info("previewWorktree: done", { duelRoundId, slot, fileCount: changedFiles.length })

  // Delayed diff: 5s after preview, compare user's repo to the worktree
  setTimeout(async () => {
    try {
      const result = await $`diff -r ${repoPath} ${worktree}`.quiet().nothrow().text()
      log.info("previewWorktree: delayed diff (5s)", { duelRoundId, slot, repoPath, worktree, diff: result.trim() })
    } catch (e) {
      log.warn("previewWorktree: delayed diff failed", { duelRoundId, slot, error: String(e) })
    }
  }, 5000)
}

// Revert the repo to the original state from the snapshot
export async function revertToOriginal(duelRoundId: string, repoPath: string): Promise<void> {
  const snapshot = originalSnapshots.get(duelRoundId)
  if (!snapshot) {
    log.warn("revertToOriginal: no snapshot found", { duelRoundId })
    return
  }

  const snapshotFiles = [...snapshot.entries()].map(([f, c]) => ({ file: f, isNull: c === null }))
  log.info("revertToOriginal: reverting", { duelRoundId, fileCount: snapshot.size, snapshotFiles })

  const dirsToClean = new Set<string>()

  for (const [file, content] of snapshot) {
    const filePath = `${repoPath}/${file}`
    if (content === null) {
      // File didn't exist before — delete it
      await $`rm -f ${filePath}`.quiet().nothrow()
      log.info("revertToOriginal: removed file", { duelRoundId, file })
      // Track parent dir for cleanup
      const dir = filePath.substring(0, filePath.lastIndexOf("/"))
      if (dir && dir !== repoPath) dirsToClean.add(dir)
    } else {
      // Restore original content
      await $`mkdir -p ${filePath.substring(0, filePath.lastIndexOf("/") + 1)}`.quiet().nothrow()
      await Bun.write(filePath, content)
      log.info("revertToOriginal: restored file", { duelRoundId, file })
    }
  }

  // Remove empty parent directories bottom-up (rmdir only removes empty dirs)
  const sortedDirs = [...dirsToClean].sort((a, b) => b.length - a.length)
  for (const dir of sortedDirs) {
    let current = dir
    while (current.length > repoPath.length) {
      const result = await $`rmdir ${current}`.quiet().nothrow()
      log.info("revertToOriginal: rmdir attempt", { duelRoundId, dir: current, exitCode: result.exitCode, stderr: result.stderr.toString().trim() })
      if (result.exitCode !== 0) break // not empty, stop walking up
      current = current.substring(0, current.lastIndexOf("/"))
    }
  }

  log.info("revertToOriginal: done", { duelRoundId })
}

// Clean up the snapshot for a completed duel
export function clearSnapshot(duelRoundId: string): void {
  log.info("clearSnapshot", { duelRoundId })
  originalSnapshots.delete(duelRoundId)
}

// Remove all worktree directories on shutdown (cleans up orphans from any prior run)
export async function cleanupAllWorktrees(repoPath: string): Promise<void> {
  const baseExists = await $`test -d ${DUEL_WORKTREE_BASE}`.quiet().nothrow().then(r => r.exitCode === 0)
  if (!baseExists) {
    log.info("cleanupAllWorktrees: no worktree base dir, nothing to do")
    return
  }

  const entries = await $`ls ${DUEL_WORKTREE_BASE}`.quiet().nothrow().text()
  const dirs = entries.trim().split("\n").filter(s => s.length > 0)
  log.info("cleanupAllWorktrees: cleaning up", { count: dirs.length, dirs })

  for (const dir of dirs) {
    const roundDir = `${DUEL_WORKTREE_BASE}/${dir}`
    const slots = await $`ls ${roundDir}`.quiet().nothrow().text()
    for (const slot of slots.trim().split("\n").filter(s => s.length > 0)) {
      const wtPath = `${roundDir}/${slot}`
      log.info("worktree removed (shutdown)", { path: wtPath })
      await $`git worktree remove ${wtPath} --force`.cwd(repoPath).quiet().nothrow()
    }
    await $`rm -rf ${roundDir}`.quiet().nothrow()
  }

  await $`git worktree prune`.cwd(repoPath).quiet().nothrow()
  createdWorktrees.clear()
  log.info("cleanupAllWorktrees: done")
}

// Generate a duel session ID (called from TUI side)
export function generateDuelRoundId(): string {
  return `duel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}

// Round counter for logging
let currentTrackingNumber: string | undefined
let roundNumber = 0

export function logRoundStart(opts: {
  sessionTrackingNumber: string
  duelRoundId: string
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
    duel_round_id: opts.duelRoundId,
    slots: slotDetails,
  })
}
