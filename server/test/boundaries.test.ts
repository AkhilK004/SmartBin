import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

describe("CLAUDE.md §3.11", () => {
  it("domain/ imports no cloud SDK", () => {
    const sdk = /from\s+["'](@aws-sdk|aws-sdk|@google-cloud|firebase)/;
    for (const f of walk("src/domain")) expect(readFileSync(f, "utf8"), f).not.toMatch(sdk);
  });
});
