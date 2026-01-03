# Split System Architecture

A bidirectional split-pane TUI implementation that enforces explicit side selection and strict history synchronization. This is effectively chatbot arena, except for coding. Exact same idea, but for coding.

## 1. Interaction Model
The prompt box is where the user types their prompt. The prompt box of the right pane is visible and enabled. All user prompts are submitted to this prompt box. When the user enters a prompt, it is submitted to both panes. The Left prompt box is hidden to simplify the UI while maintaining logical session separation. 

- **Side Selection (Mutually Exclusive)**:
  - `Ctrl+K`: Activates **LEFT** (Green).
  - `Ctrl+L`: Activates **RIGHT** (Green).
  - Selection is strictly mutually exclusive; activating one side deactivates the other.
- **Idle Gate**: Activation toggles are **disabled** unless *both* sessions are in an `idle` state (not generating).
- **Mandatory Selection**: Prompt submission is **blocked** if no side is selected, prompting the user to choose a target.

## 2. Bidirectional "Brutal" Sync
Synchronization occurs on every message submission, enforcing a "single source of truth" based on the selected side.

- **Left -> Right (Ctrl+K Active)**:
  1.  **Fork** the Left session.
  2.  **Overwrite** the Right pane with this new fork.
  3.  **Result**: Right pane effectively mirrors the Left pane's state.

- **Right -> Left (Ctrl+L Active)**:
  1.  **Fork** the Right session.
  2.  **Overwrite** the Left pane with this new fork.
  3.  **Result**: Left pane effectively mirrors the Right pane's state.

## 3. Implementation Details
- **Location**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (UI/Logic) and `.../component/prompt/index.tsx` (Sync/Broadcast).
- **State**:
  - `leftColor` / `rightColor`: Tracks visual selection state.
  - `syncMode`: Derived from color state (`'left-to-right'` or `'right-to-left'`).
- **Mechanism**:
  - `onMessageSubmitted` callback resets selection state to idle (undefined) after send.
  - `sdk.client.session.fork` and `route.navigate` are used to perform the "brutal" overwrite of the target session.



Work Notes:
Since PermissionPrompt uses a global keyboard listener (useKeyboard) and does not check which pane is "active" or "focused":

Ghost Inputs: Both prompts will listen to your arrow keys and "Enter" presses simultaneously.
Synced Actions: If you press "Right" → "Enter", you will likely select the "Reject" (or next) option on BOTH panes instantly.
