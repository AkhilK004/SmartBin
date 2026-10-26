import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../store";
import { KIND_LABEL, fmt, zoneName } from "../format";
import { truckColor } from "../truckColors";
import { Empty, PageTitle, Pill, SectionTitle } from "../ui";
import type { PlanRoute } from "../types";

export default function PlanPanel() {
  const plan = useStore((s) => s.plan);
  const zones = useStore((s) => s.zones);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const selectRoute = useStore((s) => s.selectRoute);
  const focusOn = useStore((s) => s.focusOn);
  const selectBin = useStore((s) => s.selectBin);

  if (!plan) {
    return (
      <div>
        <PageTitle title="Daily plan" finding="No plan yet." />
        <Empty>Use "Run daily plan" at the top of the map. The plan lists which bins are collected, skipped or deferred, and why.</Empty>
      </div>
    );
  }

  const binStops = plan.routes.reduce((n, r) => n + r.stops.filter((s) => s.type === "bin").length, 0);
  const km = plan.routes.reduce((n, r) => n + r.distance_m, 0);
  const finding = plan.error
    ? "The optimizer failed, so no routes were built."
    : `${fmt.day(plan.date)} · ${plan.due_zones.length} zone(s) due · ${binStops} stops · ${fmt.km(km)} on ${plan.routes.length} trucks`;

  return (
    <div>
      <PageTitle title="Daily plan" finding={finding} />

      {plan.error && (
        <div role="alert" className="mb-4 flex gap-2 rounded-card border border-[var(--pill-negative-bg)] bg-[var(--pill-negative-bg)] px-3 py-2 text-body text-[var(--pill-negative-ink)]">
          <AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden />
          <span>{plan.error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {plan.distance_source === "haversine_fallback" ? (
          <Pill tone="warning">Straight-line fallback distances, not road distances</Pill>
        ) : plan.distance_source === "osrm" ? (
          <Pill tone="positive">Real road distances (OSRM)</Pill>
        ) : (
          <Pill>No route computed</Pill>
        )}
        <span className="text-small text-muted">Generated {fmt.dateTime(plan.generated_at)}</span>
      </div>

      <SectionTitle>Routes</SectionTitle>
      {plan.routes.length === 0 ? (
        <Empty>No truck is dispatched today.</Empty>
      ) : (
        <ul className="space-y-1">
          {plan.routes.map((r) => (
            <RouteRow
              key={r.route_id}
              route={r}
              selected={selectedRouteId === r.route_id}
              onSelect={() => {
                const next = selectedRouteId === r.route_id ? null : r.route_id;
                selectRoute(next);
                if (next) focusOn("route", next);
              }}
            />
          ))}
        </ul>
      )}

      <SectionTitle>Zones</SectionTitle>
      <ul className="space-y-1 text-body">
        {plan.due_zones.length === 0 && <Empty>No zone is due today.</Empty>}
        {plan.due_zones.map((id) => {
          const deferred = plan.deferred_zones.find((d) => d.zone_id === id);
          const override = plan.urgent_override_zones.includes(id);
          return (
            <li key={id} className="flex items-center justify-between gap-3 py-1">
              <span className="font-medium">{zoneName(zones, id)}</span>
              {deferred ? (
                <span className="text-right text-small text-muted">
                  <Pill tone="warning">Deferred</Pill> {fmt.int(deferred.expected_load_kg)} of {fmt.int(deferred.min_load_kg)} kg minimum · next{" "}
                  {fmt.day(deferred.next_collection_date)}
                </span>
              ) : override ? (
                <Pill tone="warning">Urgent override</Pill>
              ) : (
                <Pill tone="positive">Collecting</Pill>
              )}
            </li>
          );
        })}
      </ul>

      <SectionTitle right={`${plan.decisions.length} entries`}>Why these decisions</SectionTitle>
      {plan.decisions.length === 0 ? (
        <Empty>No decisions were logged.</Empty>
      ) : (
        <ol className="space-y-1.5">
          {plan.decisions.map((d, i) => (
            <li key={i} className="border-l border-control pl-3 text-body text-ink">
              {d}
            </li>
          ))}
        </ol>
      )}

      <Fold title="Waiting for their zone day" count={plan.waiting.length}>
        <ul className="space-y-1">
          {plan.waiting.map((w) => (
            <li key={w.bin_id} className="text-body">
              <button className="font-medium hover:underline" onClick={() => { selectBin(w.bin_id); focusOn("bin", w.bin_id); }}>
                {w.bin_id}
              </button>{" "}
              <span className="text-muted">
                {zoneName(zones, w.zone_id)} · {fmt.pct(w.fill_pct)} · {w.reason}
              </span>
            </li>
          ))}
        </ul>
      </Fold>

      <Fold title="Dropped optional stops" count={plan.dropped_optional.length}>
        <ul className="space-y-1">
          {plan.dropped_optional.map((d) => (
            <li key={d.bin_id} className="text-body">
              <button className="font-medium hover:underline" onClick={() => { selectBin(d.bin_id); focusOn("bin", d.bin_id); }}>
                {d.bin_id}
              </button>{" "}
              <span className="text-muted">{d.reason}</span>
            </li>
          ))}
        </ul>
      </Fold>

      <SkipList />

      {plan.baseline && (
        <p className="mt-6 text-small text-muted">
          Fixed-route baseline for the same zones: {plan.baseline.stops} stops, {fmt.km(plan.baseline.distance_m)}, every bin visited with no skipping.
        </p>
      )}
    </div>
  );
}

function RouteRow({ route, selected, onSelect }: { route: PlanRoute; selected: boolean; onSelect(): void }) {
  const stops = route.stops.filter((s) => s.type === "bin").length;
  const dumps = route.stops.filter((s) => s.type === "dump_yard").length;
  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-card border px-3 py-2 text-left transition-colors ${
          selected ? "border-accent bg-ground" : "border-transparent hover:bg-ground"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-4 flex-none rounded" style={{ background: truckColor(route.truck_id, route.truck_kind) }} />
          <span className="text-body font-medium">{route.truck_id}</span>
          <span className="truncate text-small text-muted">{KIND_LABEL[route.truck_kind]}</span>
        </div>
        <dl className="mt-1 grid grid-cols-4 gap-2 text-small">
          {[
            ["Stops", String(stops)],
            ["Distance", fmt.km(route.distance_m)],
            ["Duration", fmt.duration(route.duration_s)],
            ["Dump visits", String(dumps)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="text-body font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </button>
    </li>
  );
}

function Fold({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 border-t border-rule pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[16px] font-semibold"
      >
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        {title}
        <span className="text-body font-normal text-muted">{count}</span>
      </button>
      {open && <div className="mt-2">{count === 0 ? <p className="text-body text-muted">None.</p> : children}</div>}
    </div>
  );
}

function SkipList() {
  const plan = useStore((s) => s.plan);
  const zones = useStore((s) => s.zones);
  const selectBin = useStore((s) => s.selectBin);
  const focusOn = useStore((s) => s.focusOn);
  if (!plan) return null;
  const byZone = new Map<string, typeof plan.skip_list>();
  for (const s of plan.skip_list) byZone.set(s.zone_id, [...(byZone.get(s.zone_id) ?? []), s]);
  return (
    <Fold title="Driver skip list" count={plan.skip_list.length}>
      <p className="mb-2 text-small text-muted">Bins under the skip threshold. No truck visits them today.</p>
      <div className="space-y-3">
        {[...byZone.entries()].map(([zone, list]) => (
          <div key={zone}>
            <div className="text-body font-medium">
              {zoneName(zones, zone as never)} <span className="text-small font-normal text-muted">{list.length}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {list.map((s) => (
                <button
                  key={s.bin_id}
                  onClick={() => {
                    selectBin(s.bin_id);
                    focusOn("bin", s.bin_id);
                  }}
                  className="rounded-card bg-raised px-1.5 py-0.5 text-small hover:bg-control"
                  title={`${fmt.pct(s.fill_pct)} full`}
                >
                  {s.bin_id} <span className="text-muted">{fmt.pct(s.fill_pct)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Fold>
  );
}
