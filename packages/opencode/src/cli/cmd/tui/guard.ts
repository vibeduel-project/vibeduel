import { UI } from "@/cli/ui"

const OPENINFERENCE_KEY_URL = "https://YOUR_ZUPLO_KEYGEN_URL_HERE"

export function requireOpenInferenceKey() {
  const key = process.env.OPENINFERENCE_API_KEY ?? ""
  if (key.trim()) return
  UI.error(`Missing OPENINFERENCE_API_KEY. Create a key at: ${OPENINFERENCE_KEY_URL}`)
  process.exit(1)
}
