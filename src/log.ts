import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { ErrorEvent } from "./types"

export function writeLog(logPath: string, event: ErrorEvent): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, JSON.stringify(event) + "\n", "utf8")
  } catch {
    // Log writes must never throw — silent failure is correct here.
  }
}
