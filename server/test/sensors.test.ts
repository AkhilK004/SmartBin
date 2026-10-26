import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { SensorSim } from "../src/sim/sensors.js";
import { seedBins } from "../src/seed.js";
import { NOW } from "./helpers.js";

const bins = () => seedBins(60, NOW);
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);

function run(sim: SensorSim, seconds: number, step = 30) {
  const events = [];
  for (let t = step; t <= seconds; t += step) events.push(...sim.step(step, at(t)));
  return events;
}

describe("sensor simulator", () => {
  it("fill grows at about the bin's rate", () => {
    const b = { ...bins()[0]!, fill_pct: 10, fill_rate_pct_per_hour: 2 };
    const sim = new SensorSim([b], NOW);
    run(sim, 5 * 3600);
    // 5 h x 2 %/h = 10, with +/-20% noise per step that averages out
    expect(sim.fillOf(b.bin_id)!).toBeGreaterThan(10 + 8);
    expect(sim.fillOf(b.bin_id)!).toBeLessThan(10 + 12);
  });

  it("is deterministic for a given seed", () => {
    const a = new SensorSim(bins(), NOW);
    const b = new SensorSim(bins(), NOW);
    run(a, 3600);
    run(b, 3600);
    expect(a.drain()).toEqual(b.drain());
  });

  it("reports each bin about once per reading interval", () => {
    const sim = new SensorSim(bins(), NOW);
    let total = 0;
    for (let t = 30; t <= 1800; t += 30) {
      sim.step(30, at(t));
      total += sim.drain().length;
    }
    // 60 bins x 30 min / 60 s = 1800 readings (+/- the jitter at the start)
    expect(total).toBeGreaterThan(1700);
    expect(total).toBeLessThanOrEqual(1860);
  });

  it("readings have the device contract fields and valid ranges", () => {
    const sim = new SensorSim(bins(), NOW);
    run(sim, 120);
    const r = sim.drain()[0]!;
    expect(Object.keys(r).sort()).toEqual(["battery", "bin_id", "fill_pct", "gas_ppm", "lat", "lng", "temp_c", "timestamp"]);
    expect(r.fill_pct).toBeGreaterThanOrEqual(0);
    expect(r.fill_pct).toBeLessThanOrEqual(100);
    expect(r.gas_ppm).toBeGreaterThanOrEqual(0);
  });

  it("fill never exceeds 100 and an overflow is reported once", () => {
    const b = { ...bins()[0]!, fill_pct: 95, fill_rate_pct_per_hour: 5 };
    const sim = new SensorSim([b], NOW);
    const events = run(sim, 4 * 3600);
    expect(sim.fillOf(b.bin_id)).toBe(100);
    expect(events.filter((e) => !e.baseline)).toHaveLength(1);
    expect(events.filter((e) => e.baseline)).toHaveLength(1);
  });

  it("battery drains", () => {
    const b = { ...bins()[0]!, battery: 80 };
    const sim = new SensorSim([b], NOW);
    run(sim, 86400, 300);
    sim.step(30, at(86430));
    const r = sim.drain().at(-1);
    expect(r!.battery).toBeLessThan(80);
    expect(r!.battery).toBeGreaterThan(75);
  });

  it("random gas and temperature spikes and outages happen over time", () => {
    const sim = new SensorSim(bins(), NOW);
    let hazard = 0;
    for (let t = 300; t <= 120 * 3600; t += 300) {
      sim.step(300, at(t));
      for (const r of sim.drain()) {
        if (r.gas_ppm > config.thresholds.gasPpmHazard || r.temp_c > config.thresholds.tempCHazard) hazard += 1;
      }
    }
    // with ~54 expected gas spikes lasting hours, plenty of hazardous readings appear
    expect(hazard).toBeGreaterThan(0);
    // outages: some bin goes silent for at least an hour (outages last 1-3 h)
    const sim2 = new SensorSim(bins(), NOW);
    const last = new Map<string, number>();
    let longestGapS = 0;
    for (let t = 300; t <= 120 * 3600; t += 300) {
      sim2.step(300, at(t));
      for (const r of sim2.drain()) {
        const prev = last.get(r.bin_id);
        if (prev !== undefined) longestGapS = Math.max(longestGapS, t - prev);
        last.set(r.bin_id, t);
      }
    }
    expect(longestGapS).toBeGreaterThanOrEqual(3600);
    expect(longestGapS).toBeLessThanOrEqual(3 * 3600 + 600);
  });

  it("an offline sensor sends nothing until it is brought back", () => {
    const b = bins()[0]!;
    const sim = new SensorSim([b], NOW);
    sim.override(b.bin_id, { offline: true }, NOW);
    sim.drain();
    run(sim, 600);
    expect(sim.drain()).toHaveLength(0);
    sim.override(b.bin_id, { offline: false }, at(600));
    expect(sim.drain()).toHaveLength(1);
  });

  it("override sets fill, gas and temperature and reports at once", () => {
    const b = bins()[0]!;
    const sim = new SensorSim([b], NOW);
    sim.drain();
    sim.override(b.bin_id, { fill_pct: 97, gas_ppm: 480, temp_c: 60 }, NOW);
    const r = sim.drain()[0]!;
    expect(r.fill_pct).toBe(97);
    expect(r.temp_c).toBeGreaterThan(55);
    expect(r.gas_ppm).toBeGreaterThan(400);
  });

  it("empty() resets the bin and reports 0", () => {
    const b = { ...bins()[0]!, fill_pct: 100 };
    const sim = new SensorSim([b], NOW);
    sim.drain();
    sim.empty(b.bin_id, NOW);
    expect(sim.fillOf(b.bin_id)).toBe(0);
    expect(sim.drain()[0]!.fill_pct).toBe(0);
  });

  it("the baseline shadow overflows when the real bin was emptied in time", () => {
    const b = { ...bins()[0]!, fill_pct: 90, fill_rate_pct_per_hour: 5 };
    const sim = new SensorSim([b], NOW);
    sim.empty(b.bin_id, NOW); // real schedule collects it at once
    const events = run(sim, 4 * 3600);
    expect(events.filter((e) => e.baseline)).toHaveLength(1);
    expect(events.filter((e) => !e.baseline)).toHaveLength(0);
  });
});
