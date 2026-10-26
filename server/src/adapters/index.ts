import { config } from "../config.js";
import { JsonlHistory, LocalBus, MemoryStore } from "./local.js";
import type { HistoryStore, MessageBus, StateStore } from "./types.js";

/** Picks implementations by env (CLAUDE.md §6). AWS classes arrive in Phase 10. */
export async function createAdapters(): Promise<{ bus: MessageBus; store: StateStore; history: HistoryStore }> {
  for (const [name, value] of [
    ["BUS", config.bus],
    ["STORE", config.store],
    ["HISTORY", config.history],
  ] as const) {
    if (value !== "local") throw new Error(`${name}=${value} is not available yet (AWS adapters: Phase 10)`);
  }
  const history = await JsonlHistory.open(config.historyPath);
  if (history.skippedLines > 0) console.warn(`history: skipped ${history.skippedLines} unreadable line(s) in ${config.historyPath}`);
  return { bus: new LocalBus(), store: new MemoryStore(), history };
}
