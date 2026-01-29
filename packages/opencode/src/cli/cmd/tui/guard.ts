import { UI } from "@/cli/ui"
import { Auth } from "@/auth"

const OPENINFERENCE_KEY_URL = "https://YOUR_ZUPLO_KEYGEN_URL_HERE"

export async function requireOpenInferenceKey() {
  // Check environment for the API key (Bun.env can differ from process.env)
  const bunEnv =
    typeof Bun !== "undefined"
      ? (Bun as { env: Record<string, string | undefined> }).env
      : undefined
  const key = process.env.OPENINFERENCE_API_KEY ?? bunEnv?.OPENINFERENCE_API_KEY ?? ""
  if (key.trim()) {
    return
  }

  // Fall back to persisted credentials
  const stored = await Auth.get("openinference")
  if (stored?.type === "api" && stored.key.trim()) {
    process.env.OPENINFERENCE_API_KEY = stored.key.trim()
    return
  }

  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "OpenInference API Key Required" + UI.Style.TEXT_NORMAL)
  UI.println(UI.Style.TEXT_DIM + `Create a key at: ${OPENINFERENCE_KEY_URL}` + UI.Style.TEXT_NORMAL)
  UI.empty()

  const input = await UI.input("Enter your OPENINFERENCE_API_KEY: ")
  if (!input.trim()) {
    UI.error("API key is required to continue")
    process.exit(1)
  }

  // Set the API key in process.env for this session
  process.env.OPENINFERENCE_API_KEY = input.trim()
  await Auth.set("openinference", { type: "api", key: input.trim() })
}
