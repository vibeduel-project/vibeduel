import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  setDuel,
  getDuel,
  clearDuel,
  setDuelWorktree,
  getDuelWorktree,
  clearDuelWorktree,
  getDuelSlot,
  generateDuelRoundId,
  DUEL_WORKTREE_BASE,
} from "../../src/duel"

describe("duel state management", () => {
  const testSessionID = "session_test123"
  const testDuelRoundId = "duel_abc123def456"
  const testWorktreePath = `${DUEL_WORKTREE_BASE}/test_duel/0`

  afterEach(() => {
    clearDuel(testSessionID)
    clearDuelWorktree(testSessionID)
  })

  describe("setDuel and getDuel", () => {
    test("should set and get duel round ID for a session", () => {
      setDuel(testSessionID, testDuelRoundId)
      expect(getDuel(testSessionID)).toBe(testDuelRoundId)
    })

    test("should return undefined for session without duel", () => {
      expect(getDuel(testSessionID)).toBeUndefined()
    })

    test("should overwrite existing duel round ID", () => {
      const newDuelRoundId = "duel_newid123"
      setDuel(testSessionID, testDuelRoundId)
      setDuel(testSessionID, newDuelRoundId)
      expect(getDuel(testSessionID)).toBe(newDuelRoundId)
    })
  })

  describe("clearDuel", () => {
    test("should clear duel round ID for a session", () => {
      setDuel(testSessionID, testDuelRoundId)
      clearDuel(testSessionID)
      expect(getDuel(testSessionID)).toBeUndefined()
    })

    test("should handle clearing non-existent session", () => {
      expect(() => clearDuel("nonexistent")).not.toThrow()
    })
  })

  describe("duel worktree management", () => {
    test("should set and get duel worktree path", () => {
      setDuelWorktree(testSessionID, testWorktreePath)
      expect(getDuelWorktree(testSessionID)).toBe(testWorktreePath)
    })

    test("should return undefined for session without worktree", () => {
      expect(getDuelWorktree(testSessionID)).toBeUndefined()
    })

    test("should extract slot number from worktree path", () => {
      setDuelWorktree(testSessionID, testWorktreePath)
      expect(getDuelSlot(testSessionID)).toBe(0)
    })

    test("should extract slot number 1 from worktree path", () => {
      setDuelWorktree(testSessionID, `${DUEL_WORKTREE_BASE}/test_duel/1`)
      expect(getDuelSlot(testSessionID)).toBe(1)
    })

    test("should return undefined for session without worktree slot", () => {
      expect(getDuelSlot(testSessionID)).toBeUndefined()
    })

    test("should clear duel worktree", () => {
      setDuelWorktree(testSessionID, testWorktreePath)
      clearDuelWorktree(testSessionID)
      expect(getDuelWorktree(testSessionID)).toBeUndefined()
    })
  })

  describe("generateDuelRoundId", () => {
    test("should generate duel round ID with correct prefix", () => {
      const id = generateDuelRoundId()
      expect(id).toStartWith("duel_")
    })

    test("should generate unique IDs", () => {
      const id1 = generateDuelRoundId()
      const id2 = generateDuelRoundId()
      expect(id1).not.toBe(id2)
    })

    test("should generate ID with sufficient length", () => {
      const id = generateDuelRoundId()
      expect(id.length).toBeGreaterThan(10)
    })

    test("should not contain hyphens", () => {
      const id = generateDuelRoundId()
      expect(id).not.toContain("-")
    })
  })
})

describe("duel mode initialization flow", () => {
  const session1 = "session_init1"
  const session2 = "session_init2"

  afterEach(() => {
    clearDuel(session1)
    clearDuel(session2)
    clearDuelWorktree(session1)
    clearDuelWorktree(session2)
  })

  test("duelRoundId should be set before prompts are sent (simulation)", () => {
    const duelRoundId = generateDuelRoundId()

    setDuel(session1, duelRoundId)
    setDuelWorktree(session1, `${DUEL_WORKTREE_BASE}/${duelRoundId}/0`)

    setDuel(session2, duelRoundId)
    setDuelWorktree(session2, `${DUEL_WORKTREE_BASE}/${duelRoundId}/1`)

    const storedDuelId = getDuel(session1)
    expect(storedDuelId).toBe(duelRoundId)

    const worktree = getDuelWorktree(session1)
    expect(worktree).toBeDefined()
    expect(worktree).toContain(duelRoundId)
  })

  test("multiple sessions can share the same duelRoundId", () => {
    const duelRoundId = generateDuelRoundId()

    setDuel(session1, duelRoundId)
    setDuel(session2, duelRoundId)

    expect(getDuel(session1)).toBe(getDuel(session2))
    expect(getDuel(session1)).toBe(duelRoundId)
  })

  test("clearing duel should prevent credit check bypass", () => {
    const duelRoundId = generateDuelRoundId()

    setDuel(session1, duelRoundId)
    clearDuel(session1)

    expect(getDuel(session1)).toBeUndefined()
  })

  test("BUG REPRO: prompt sent before duelRoundId set should not have duel context", () => {
    const sessionID = "session_bug_repro"

    const isDuelMode = () => getDuel(sessionID) !== undefined

    expect(isDuelMode()).toBe(false)

    setDuel(sessionID, generateDuelRoundId())
    expect(isDuelMode()).toBe(true)

    clearDuel(sessionID)
    expect(isDuelMode()).toBe(false)
  })

  test("BUG REPRO: first prompt in duel mode should have duelRoundId set", () => {
    const sessionID = "session_first_prompt"
    const duelRoundId = generateDuelRoundId()

    setDuel(sessionID, duelRoundId)
    setDuelWorktree(sessionID, `${DUEL_WORKTREE_BASE}/${duelRoundId}/0`)

    const duelContext = {
      duelRoundId: getDuel(sessionID),
      worktree: getDuelWorktree(sessionID),
      slot: getDuelSlot(sessionID),
    }

    expect(duelContext.duelRoundId).toBeDefined()
    expect(duelContext.worktree).toBeDefined()
    expect(duelContext.slot).toBe(0)
  })
})
