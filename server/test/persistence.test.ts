import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlHistory, MemoryStore, loadSnapshot, saveSnapshot } from "../src/adapters/local.js";
import { makeWorld, reading, tick } from "./helpers.js";

describe("persistence", () => {
  it("snapshot then restart restores state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smartbin-"));
    const path = join(dir, "snapshot.json");
    const world = makeWorld();
    await world.bus.publish(reading("B-003", { fill_pct: 77 }));
    await tick();
    await saveSnapshot(path, world.store.snapshot());

    const restored = new MemoryStore((await loadSnapshot(path))!);
    expect(restored.getBin("B-003")!.fill_pct).toBe(77);
    expect(restored.getBins()).toHaveLength(60);
    expect(await loadSnapshot(join(dir, "missing.json"))).toBeNull();
    await world.socket.close();
    await rm(dir, { recursive: true });
  });

  it("history survives reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smartbin-"));
    const path = join(dir, "h.jsonl");
    const h = await JsonlHistory.open(path);
    await h.appendReading(reading("B-001", { fill_pct: 40 }));
    await h.appendEmptying({ bin_id: "B-001", at: "2026-10-26T06:00:00Z" });
    const again = await JsonlHistory.open(path);
    expect(again.readings("B-001")).toHaveLength(1);
    expect(again.emptyings("B-001")).toHaveLength(1);
    await rm(dir, { recursive: true });
  });

  it("a torn line in the history file is skipped, not fatal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smartbin-"));
    const path = join(dir, "h.jsonl");
    const h = await JsonlHistory.open(path);
    await h.appendReading(reading("B-001", { fill_pct: 40 }));
    await appendFile(path, '{"kind":"reading","bin_id":"B-002","fill_pct":5\n');
    await h.appendReading(reading("B-003", { fill_pct: 60 }));
    const again = await JsonlHistory.open(path);
    expect(again.skippedLines).toBe(1);
    expect(again.readings("B-001")).toHaveLength(1);
    expect(again.readings("B-003")).toHaveLength(1);
    await rm(dir, { recursive: true });
  });
});

describe("history appends", () => {
  it("many overlapping appends all land as whole lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smartbin-"));
    const path = join(dir, "h.jsonl");
    const h = await JsonlHistory.open(path);
    await Promise.all(Array.from({ length: 300 }, (_, i) => h.appendReading(reading(`B-${String(i % 30).padStart(3, "0")}`, { fill_pct: i % 100 }))));
    const again = await JsonlHistory.open(path);
    expect(again.skippedLines).toBe(0);
    expect(again.readings("B-000")).toHaveLength(10);
    await rm(dir, { recursive: true });
  });
});
