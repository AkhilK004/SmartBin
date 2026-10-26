import { useMemo } from "react";
import { Play } from "lucide-react";
import { useStore } from "../store";
import { COLOR_HEX, COLOR_LABEL, fmt } from "../format";
import type { BinColor } from "../types";
import { runDailyPlan, setSimSpeed, errorText } from "../api";
import { Button, Choice, Dot, useAction } from "../ui";

const ORDER: BinColor[] = ["red", "amber", "green", "purple", "grey"];

/** Floating strip over the map: scope, bin counts by state, simulated clock, the plan button. */
export default function TopBar() {
  const bins = useStore((s) => s.bins);
  const trucks = useStore((s) => s.trucks);
  const connected = useStore((s) => s.connected);
  const sim = useStore((s) => s.sim);

  const counts = useMemo(() => {
    const c: Record<BinColor, number> = { red: 0, amber: 0, green: 0, purple: 0, grey: 0 };
    for (const b of Object.values(bins)) c[b.color] += 1;
    return c;
  }, [bins]);
  const total = Object.keys(bins).length;
  const active = trucks.filter((t) => t.status !== "idle").length;

  const plan = useAction(async () => {
    const r = await runDailyPlan();
    if (!r.ok) return errorText(r.data, `Plan failed (${r.status})`);
    useStore.getState().setTab("plan");
  });
  const speed = useAction(async (v: number) => {
    const r = await setSimSpeed(v);
    if (!r.ok) return errorText(r.data, "Could not change speed");
  });

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-5 gap-y-1 rounded-card border border-line bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-positive" : "bg-negative"}`}
            title={connected ? "Connected to the server" : "Disconnected, retrying"}
          />
          <span className="text-body font-semibold">SmartBin Gwalior</span>
          <span className="text-small text-muted">{connected ? "Live" : "Reconnecting"}</span>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-0.5" aria-label="Bins by state">
          {ORDER.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-body" title={`${COLOR_LABEL[c]}`}>
              <Dot color={COLOR_HEX[c]} />
              <span className="font-medium">{fmt.int(counts[c])}</span>
              <span className="hidden text-muted min-[1180px]:inline">{COLOR_LABEL[c]}</span>
            </li>
          ))}
          <li className="text-small text-muted max-[860px]:hidden">of {fmt.int(total)} bins</li>
        </ul>
        <span className="text-body max-[860px]:hidden">
          <span className="font-medium">{active}</span>
          <span className="text-muted"> of {trucks.length} trucks out</span>
        </span>
      </div>

      <div className="pointer-events-auto flex items-center gap-4 rounded-card border border-line bg-surface px-3 py-1.5">
        <div className="leading-4">
          <div className="text-small text-muted max-[860px]:hidden">Simulated time, IST</div>
          <div className="text-body font-medium">{sim ? fmt.dateTime(sim.now) : "—"}</div>
        </div>
        <div className="max-[860px]:hidden">
        <Choice
          label="Time speed"
          value={sim?.speed ?? 1}
          onChange={(v) => speed.run(v)}
          items={[
            { id: 1, label: "1×" },
            { id: 60, label: "60×" },
            { id: 600, label: "600×" },
          ]}
        />
        </div>
        <Button variant="primary" onClick={() => plan.run()} busy={plan.busy} title={plan.error ?? "Build today's plan now"}>
          <Play size={13} aria-hidden /> Run daily plan
        </Button>
      </div>
      {(plan.error || speed.error) && (
        <p role="alert" className="pointer-events-auto w-full rounded-card border border-line bg-surface px-3 py-1.5 text-small text-negative">
          {plan.error ?? speed.error}
        </p>
      )}
    </div>
  );
}
