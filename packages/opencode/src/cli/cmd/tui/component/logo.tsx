import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
const LOGO = `
▗▖  ▗▖▗▄▄▄▖▗▄▄▖ ▗▄▄▄▖▗▄▄▄ ▗▖ ▗▖▗▄▄▄▖▗▖
▐▌  ▐▌  █  ▐▌ ▐▌▐▌   ▐▌  █▐▌ ▐▌▐▌   ▐▌
▐▌  ▐▌  █  ▐▛▀▚▖▐▛▀▀▘▐▌  █▐▌ ▐▌▐▛▀▀▘▐▌
 ▝▚▞▘ ▗▄█▄▖▐▙▄▞▘▐▙▄▄▖▐▙▄▄▀▝▚▄▞▘▐▙▄▄▖▐▙▄▄▖
`.trimEnd()

const LOGO_LINES = LOGO.split("\n")

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO_LINES}>
        {(line) => (
          <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
