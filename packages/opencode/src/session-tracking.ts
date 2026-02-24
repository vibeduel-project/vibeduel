// Session tracking number - a fresh UUID generated once per chat session.
// Sent as a top-level param on every LLM request. Completely independent of all other IDs.

import { Log } from "@/util/log"

const log = Log.create({ service: "session-tracking" })

let current: string | undefined

export function setSessionTrackingNumber(value: string): void {
  log.info("setSessionTrackingNumber", { session_tracking_number: value })
  current = value
}

export function getSessionTrackingNumber(): string {
  if (!current) {
    current = crypto.randomUUID()
    log.info("getSessionTrackingNumber auto-generated", { session_tracking_number: current })
  }
  return current
}
