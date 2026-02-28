import { UI } from "@/cli/ui"
import { Auth } from "@/auth"
import { execSync } from "child_process"
import * as prompts from "@clack/prompts"

const VIBEDUEL_KEY_URL = "https://vibeduel.ai/keys"

export async function requireVibeDuelKey() {
  // Ensure we're inside a git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" })
  } catch {
    UI.error("VibeDuel must be run inside a git repository.")
    process.exit(1)
  }
  // Check environment for the API key (Bun.env can differ from process.env)
  const bunEnv =
    typeof Bun !== "undefined"
      ? (Bun as { env: Record<string, string | undefined> }).env
      : undefined
  const key = process.env.VIBEDUEL_API_KEY ?? bunEnv?.VIBEDUEL_API_KEY ?? ""
  if (key.trim()) {
    return
  }

  // Fall back to persisted credentials
  const stored = await Auth.get("vibeduel")
  if (stored?.type === "api" && stored.key.trim()) {
    process.env.VIBEDUEL_API_KEY = stored.key.trim()
    return
  }

  prompts.intro(UI.Style.TEXT_INFO_BOLD + "VibeDuel API Key required!" + UI.Style.TEXT_NORMAL + " " + UI.Style.TEXT_DIM + `Create a key at: ${VIBEDUEL_KEY_URL}` + UI.Style.TEXT_NORMAL)

  const baseURL = process.env.VIBEDUEL_BASE_URL ?? "https://api.vibeduel.ai/v1"
  const validationURL = `${baseURL}/chat/completions`

  let validKey: string

  while (true) {
    const input = await prompts.password({
      message: "Enter your VIBEDUEL_API_KEY:",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(input)) throw new UI.CancelledError()
    if (!input.trim()) {
      prompts.log.error("API key is required to continue")
      continue
    }

    // Validate the API key with the server
    const spinner = prompts.spinner()
    spinner.start("Validating API key...")

    try {
      const response = await fetch(validationURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "test",
          messages: [],
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        spinner.stop("Invalid API key", 1)
        continue
      }

      spinner.stop("API key validated")
      validKey = input.trim()
      break
    } catch (error) {
      spinner.stop("Failed to validate API key", 1)
      const errorMsg = error instanceof Error ? error.message : "Unknown error"
      prompts.log.error(`Could not validate API key at ${validationURL}: ${errorMsg}`)
      prompts.log.error("Please check your network connection or VIBEDUEL_BASE_URL environment variable")
    }
  }

  // Set the API key in process.env for this session
  process.env.VIBEDUEL_API_KEY = validKey
  await Auth.set("vibeduel", { type: "api", key: validKey })
}
