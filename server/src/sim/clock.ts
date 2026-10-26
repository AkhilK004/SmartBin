/** Simulated wall clock. Only the engine advances it; everything time-dependent reads `now()`. */
export class SimClock {
  private ms: number;

  constructor(start: Date = new Date()) {
    this.ms = start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}
