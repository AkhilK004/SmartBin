import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { COLOR_HEX, COLOR_LABEL } from "../format";
import { SECONDARY_COLOR, truckColor } from "../truckColors";
import { Dot } from "../ui";
import type { BinColor } from "../types";

const COLORS: BinColor[] = ["green", "amber", "red", "purple", "grey"];

export default function Legend() {
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 860));
  return (
    <section
      aria-label="Map legend"
      className="absolute bottom-8 left-3 z-10 w-[208px] rounded-card border border-line bg-surface px-3 py-2 max-[860px]:bottom-2"
    >
      <button
        className="flex w-full items-center justify-between text-body font-semibold"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Legend
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-small">
          <ul className="space-y-1">
            {COLORS.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <Dot color={COLOR_HEX[c]} size={9} />
                <span className="text-ink">{c === "grey" ? "Offline" : c === "purple" ? "Hazard" : COLOR_LABEL[c]}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-muted">
              <span className="inline-block h-[9px] w-[9px] rounded-full border border-white/60" />
              In a route today
            </li>
          </ul>
          <ul className="space-y-1 border-t border-rule pt-2">
            <li className="flex items-center gap-2">
              <span className="h-[3px] w-4 rounded" style={{ background: truckColor("T-P1", "primary_compactor") }} />
              Primary compactor route
            </li>
            <li className="flex items-center gap-2">
              <span
                className="h-[3px] w-4"
                style={{ background: `repeating-linear-gradient(90deg, ${SECONDARY_COLOR} 0 5px, transparent 5px 8px)` }}
              />
              Secondary auto-tipper route
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-[9px] w-[9px] rounded-full border-2 border-accent bg-surface" /> Depot
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-[9px] w-[9px] rounded-full border-2 bg-surface" style={{ borderColor: COLOR_HEX.amber }} />
              Dump yard
            </li>
          </ul>
          <p className="border-t border-rule pt-2 text-muted">
            Bin, zone, depot and dump-yard locations are approximate. Verify on the map.
          </p>
        </div>
      )}
    </section>
  );
}
