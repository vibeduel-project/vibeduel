# Claude Notes

## Worktree preview: dev server requires hard reload when switching slots

**Problem:** When switching between slot previews (e.g. clicking Slot 0 then Slot 1), the dev website (Vite) doesn't reflect the new slot's changes until a hard reload.

**Why:** `revertToOriginal` deletes/restores files, then `previewWorktree` copies the new slot's files via `cp`. That delete-then-recreate cycle on the same file paths can fall outside Vite's HMR capability — HMR handles in-place edits well, but file deletion + recreation often requires a full reload.
