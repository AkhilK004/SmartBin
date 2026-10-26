import type { EventEmitter } from "node:events";
import type { StateStore } from "./adapters/types.js";
import { buildSavings, daySavings, type OverflowCounts } from "./domain/savings.js";
import type { Plan, Savings } from "./types.js";

const NO_OVERFLOWS: OverflowCounts = { by_date: {}, total: { baseline: 0, optimized: 0 } };

/**
 * Keeps the per-date ledger and publishes `savings:new` when the figures change:
 * after each plan, and whenever the simulator's overflow counts move (so the figures
 * are final at the end of the day).
 */
export class SavingsService {
  private last: string;

  constructor(
    private store: StateStore,
    private events: EventEmitter,
    private overflows: () => OverflowCounts = () => NO_OVERFLOWS,
  ) {
    events.on("plan:new", (plan: Plan) => this.recordPlan(plan));
    events.on("sim:tick", () => this.publishIfChanged());
    this.last = JSON.stringify(this.current());
  }

  /** Re-running a day's plan replaces that day's entry. */
  recordPlan(plan: Plan): void {
    const day = daySavings(plan);
    if (day) this.store.setLedgerDay(plan.date, day);
    this.publishIfChanged();
  }

  current(): Savings | null {
    return buildSavings(this.store.getLedger(), this.overflows());
  }

  private publishIfChanged(): void {
    const s = this.current();
    const json = JSON.stringify(s);
    if (json === this.last) return;
    this.last = json;
    if (s) this.events.emit("savings:new", s);
  }
}
