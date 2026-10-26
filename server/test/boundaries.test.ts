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

  it("§3.10: domain/ and the simulators hold no section 4 or 10 number as a literal", () => {
    // The numbers CLAUDE.md fixes: fill thresholds, hazard limits, fuel factors, truck sizes, speed, service time.
    const fixed = /(?<![\w.])(85|95|40|55|400|0\.35|0\.12|6000|800|22)(?![\w.])/;
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const f of [...walk("src/domain"), ...walk("src/sim")]) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(fixed);
  });
});
