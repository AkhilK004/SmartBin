import { useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useStore } from "../store";
import { COLOR_HEX, INTERVAL_LABEL, KIND_LABEL, STATUS_LABEL, fmt, zoneName } from "../format";
import { truckColor } from "../truckColors";
import { Dash, Empty, PageTitle, Pill, SectionTitle } from "../ui";
import type { BinColor, Truck, Zone } from "../types";

const STACK: BinColor[] = ["red", "purple", "amber", "green", "grey"];

export default function Overview() {
  const bins = useStore((s) => s.bins);
  const zones = useStore((s) => s.zones);
  const trucks = useStore((s) => s.trucks);
  const plan = useStore((s) => s.plan);
  const sim = useStore((s) => s.sim);
  const hidden = useStore((s) => s.hiddenZones);
  const toggleZone = useStore((s) => s.toggleZone);
  const focusOn = useStore((s) => s.focusOn);
  const setTab = useStore((s) => s.setTab);

  const today = sim ? fmt.localDate(sim.now) : "";
  const all = useMemo(() => Object.values(bins), [bins]);
  const must = all.filter((b) => b.bin_class === "must_visit").length;
  const urgent = all.filter((b) => b.urgent).length;
  const hazard = all.filter((b) => b.hazard).length;
  const offline = all.filter((b) => b.status === "offline").length;

  const perZone = useMemo(() => {
    const m = new Map<string, { counts: Record<BinColor, number>; must: number; total: number }>();
    for (const z of zones) m.set(z.zone_id, { counts: { red: 0, purple: 0, amber: 0, green: 0, grey: 0 }, must: 0, total: 0 });
    for (const b of all) {
      const e = m.get(b.zone_id);
      if (!e) continue;
      e.counts[b.color] += 1;
      e.total += 1;
      if (b.bin_class === "must_visit") e.must += 1;
    }
    return m;
  }, [all, zones]);

  let finding: string;
  if (!plan) finding = "No plan has been built yet. Run the daily plan to dispatch trucks.";
  else if (plan.error) finding = `The last plan failed: ${plan.error}`;
  else {
    const stops = plan.routes.reduce((n, r) => n + r.stops.filter((s) => s.type === "bin").length, 0);
    const km = plan.routes.reduce((n, r) => n + r.distance_m, 0);
    finding =
      plan.routes.length === 0
        ? `Plan for ${fmt.day(plan.date)}: no truck dispatched. ${plan.deferred_zones.length} zone(s) deferred.`
        : `Plan for ${fmt.day(plan.date)}: ${stops} stops on ${plan.routes.length} trucks, ${fmt.km(km)}.`;
  }

  return (
    <div>
      <PageTitle title="Overview" finding={finding} />

      <section aria-label="Bins that need a truck" className="rounded-card border border-line bg-ground px-4 py-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-body text-muted">Must-visit bins</div>
            <div className="text-[34px] font-semibold leading-10">{fmt.int(must)}</div>
          </div>
          <div className="pb-1 text-right text-body text-muted">of {fmt.int(all.length)} bins</div>
        </div>
        <dl className="mt-3 grid grid-cols-3 divide-x divide-rule border-t border-rule pt-3">
          {[
            ["Urgent", urgent],
            ["Hazard", hazard],
            ["Offline", offline],
          ].map(([k, v], i) => (
            <div key={k as string} className={i === 0 ? "pr-3" : "px-3"}>
              <dt className="text-small text-muted">{k}</dt>
              <dd className="text-kpi font-medium">{fmt.int(v as number)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SectionTitle right="Click a zone to frame it on the map">Zones</SectionTitle>
      {zones.length === 0 ? (
        <Empty>No zones yet. Waiting for the server.</Empty>
      ) : (
        <ul className="space-y-1">
          {zones.map((z) => (
            <ZoneRow
              key={z.zone_id}
              zone={z}
              today={today}
              data={perZone.get(z.zone_id)}
              due={plan?.due_zones.includes(z.zone_id) ?? false}
              deferred={plan?.deferred_zones.some((d) => d.zone_id === z.zone_id) ?? false}
              hidden={hidden.has(z.zone_id)}
              onToggle={() => toggleZone(z.zone_id)}
              onFocus={() => focusOn("zone", z.zone_id)}
            />
          ))}
        </ul>
      )}

      <SectionTitle
        right={
          <button className="text-ink underline-offset-2 hover:underline" onClick={() => setTab("plan")}>
            Open plan
          </button>
        }
      >
        Trucks
      </SectionTitle>
      {trucks.length === 0 ? (
        <Empty>No trucks reported yet.</Empty>
      ) : (
        <ul className="space-y-1">
          {trucks.map((t) => (
            <TruckRow key={t.truck_id} truck={t} onFocus={() => focusOn("truck", t.truck_id)} />
          ))}
        </ul>
      )}
      <p className="mt-6 text-small text-muted">
        Every figure on this screen is computed from simulated sensor data. Bin and zone positions are approximate.
      </p>
      {plan && zones.length > 0 && plan.waiting.length > 0 && (
        <p className="mt-2 text-small text-muted">
          {plan.waiting.length} standard bin(s) wait for their zone day:{" "}
          {Array.from(new Set(plan.waiting.map((w) => zoneName(zones, w.zone_id)))).join(", ")}.
        </p>
      )}
    </div>
  );
}

function ZoneRow({
  zone,
  today,
  data,
  due,
  deferred,
  hidden,
  onToggle,
  onFocus,
}: {
  zone: Zone;
  today: string;
  data?: { counts: Record<BinColor, number>; must: number; total: number };
  due: boolean;
  deferred: boolean;
  hidden: boolean;
  onToggle(): void;
  onFocus(): void;
}) {
  const total = data?.total ?? 0;
  const isToday = zone.next_collection_date === today;
  return (
    <li className={`rounded-card border border-transparent px-1 py-2 hover:bg-ground ${hidden ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onFocus} className="min-w-0 flex-1 text-left" aria-label={`Frame ${zone.name} on the map`}>
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium">{zone.name}</span>
            {due && !deferred && <Pill tone="positive">Collecting today</Pill>}
            {deferred && <Pill tone="warning">Deferred</Pill>}
            {!due && isToday && <Pill>Due today</Pill>}
          </div>
          <div className="text-small text-muted">
            {INTERVAL_LABEL[zone.interval_label]} · next {isToday ? "today" : fmt.day(zone.next_collection_date)} ·{" "}
            {fmt.dec(zone.fill_rate_pct_per_day, 1)}% fill a day
          </div>
        </button>
        <div className="text-right leading-4">
          <div className="text-body font-medium">{data ? fmt.int(data.must) : <Dash />}</div>
          <div className="text-small text-muted">must visit</div>
        </div>
        <button
          onClick={onToggle}
          aria-label={hidden ? `Show ${zone.name} on the map` : `Hide ${zone.name} from the map`}
          className="flex h-7 w-7 items-center justify-center rounded-card text-muted hover:bg-raised hover:text-ink"
        >
          {hidden ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </div>
      {/* The zone's bins by state, as one bar: the share of each colour is its share of the zone's bins. */}
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-sm bg-raised"
        role="img"
        aria-label={data ? STACK.map((c) => `${data.counts[c]} ${c}`).join(", ") : "No bins"}
      >
        {data &&
          total > 0 &&
          STACK.map((c) =>
            data.counts[c] > 0 ? (
              <span
                key={c}
                style={{ width: `${(data.counts[c] / total) * 100}%`, background: COLOR_HEX[c] }}
                className="border-r-2 border-ground last:border-r-0"
                title={`${data.counts[c]} ${c}`}
              />
            ) : null,
          )}
      </div>
    </li>
  );
}

function TruckRow({ truck, onFocus }: { truck: Truck; onFocus(): void }) {
  const fill = truck.capacity_kg > 0 ? Math.min(100, (truck.load_kg / truck.capacity_kg) * 100) : 0;
  const busy = truck.status !== "idle";
  return (
    <li>
      <button onClick={onFocus} className="w-full rounded-card px-1 py-2 text-left hover:bg-ground">
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-4 flex-none rounded" style={{ background: truckColor(truck.truck_id, truck.kind) }} />
          <span className="text-body font-medium">{truck.truck_id}</span>
          <span className="truncate text-small text-muted">{KIND_LABEL[truck.kind]}</span>
          <span className={`ml-auto text-small ${busy ? "text-ink" : "text-muted"}`}>{STATUS_LABEL[truck.status]}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised" role="img" aria-label={`Load ${Math.round(fill)}% of capacity`}>
            <div className="h-full rounded-full bg-ink" style={{ width: `${fill}%` }} />
          </div>
          <span className="w-[116px] text-right text-small text-muted">
            {fmt.int(truck.load_kg)} / {fmt.int(truck.capacity_kg)} kg
          </span>
        </div>
        {truck.next_stop_bin_id && <div className="mt-1 text-small text-muted">Next stop {truck.next_stop_bin_id}</div>}
      </button>
    </li>
  );
}

