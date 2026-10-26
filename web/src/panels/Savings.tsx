import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { fmt, reduction } from "../format";
import CountUp from "../components/reactbits/CountUp/CountUp";
import { Choice, Dash, Empty, PageTitle } from "../ui";
import type { Metric } from "../types";

type Scope = "today" | "total";

interface Row {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  note?: string;
  m: Metric;
}

export default function SavingsPanel() {
  const savings = useStore((s) => s.savings);
  const [scope, setScope] = useState<Scope>("today");

  if (!savings) {
    return (
      <div>
        <PageTitle title="Savings" finding="No comparable plan yet." />
        <Empty>
          Run the daily plan on a day when a zone is due. Savings compare the optimized routes with the fixed route that visits every bin of the due zones.
        </Empty>
      </div>
    );
  }

  const src = scope === "today" ? savings : savings.cumulative;
  const rows: Row[] = [
    { key: "stops", label: "Stops", unit: "", decimals: 0, m: src.stops },
    { key: "km", label: "Distance", unit: " km", decimals: 1, m: src.km },
    { key: "fuel", label: "Fuel", unit: " L", decimals: 1, note: "estimate", m: src.fuel_l },
    { key: "overflow", label: "Overflows missed", unit: "", decimals: 0, m: src.overflows_missed },
  ];

  const chart = rows
    .filter((r) => r.m.baseline > 0)
    .map((r) => ({ name: r.label, pct: Math.round((r.m.optimized / r.m.baseline) * 100) }));

  const stopsCut = reduction(src.stops.baseline, src.stops.optimized);
  const kmCut = reduction(src.km.baseline, src.km.optimized);
  const finding =
    stopsCut !== null && kmCut !== null
      ? `${scope === "today" ? fmt.day(savings.date) : "Since the first plan"}: ${fmt.int(Math.abs(stopsCut))}% ${stopsCut >= 0 ? "fewer" : "more"} stops and ${fmt.int(Math.abs(kmCut))}% ${kmCut >= 0 ? "less" : "more"} distance than the fixed route.`
      : "The fixed route has no stops to compare with.";

  return (
    <div>
      <PageTitle title="Savings" finding={finding} action={<Choice<Scope> label="Period" value={scope} onChange={setScope} items={[{ id: "today", label: "Latest day" }, { id: "total", label: "Total" }]} />} />

      <table className="w-full text-body">
        <thead>
          <tr className="text-small text-muted">
            <th className="pb-1 text-left font-normal"> </th>
            <th className="pb-1 text-right font-normal">Fixed route</th>
            <th className="pb-1 text-right font-normal">Optimized</th>
            <th className="pb-1 text-right font-normal">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cut = reduction(r.m.baseline, r.m.optimized);
            return (
              <tr key={r.key} className="border-t border-rule">
                <th scope="row" className="h-[48px] text-left font-medium">
                  {r.label}
                  {r.note && <span className="ml-1.5 text-small font-normal text-muted">{r.note}</span>}
                </th>
                <td className="text-right text-muted">
                  {fmt.dec(r.m.baseline, r.decimals)}
                  {r.unit}
                </td>
                <td className="text-right text-kpi font-semibold">
                  <CountUp to={r.m.optimized} decimals={r.decimals} duration={0.8} separator="," trigger="load" />
                  <span className="text-body font-normal text-muted">{r.unit}</span>
                </td>
                <td className="text-right">
                  {cut === null ? (
                    <Dash />
                  ) : (
                    <span className={cut > 0 ? "text-positive" : cut < 0 ? "text-negative" : "text-muted"}>
                      {cut > 0 ? "−" : cut < 0 ? "+" : ""}
                      {fmt.int(Math.abs(cut))}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-small text-muted">
        Change is against the fixed route. A dash means the fixed route has none of that measure, so there is nothing to compare with.
      </p>

      {chart.length > 0 && (
        <section aria-label="Optimized as a share of the fixed route" className="mt-6">
          <h2 className="mb-2 text-[16px] font-semibold">Optimized as a share of the fixed route</h2>
          <div className="h-[170px]" role="img" aria-label={chart.map((c) => `${c.name} ${c.pct} percent of the fixed route`).join(", ")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 12 }} barSize={12}>
                <CartesianGrid horizontal={false} stroke="#222224" />
                <XAxis type="number" domain={[0, 120]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#8a8c92", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={104} tick={{ fill: "#ffffff", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ReferenceLine x={100} stroke="#8a8c92" strokeDasharray="3 3" />
                <Bar dataKey="pct" isAnimationActive={false}>
                  {chart.map((c) => (
                    <Cell key={c.name} fill="#4a8ad6" />
                  ))}
                  <LabelList dataKey="pct" position="right" formatter={(v: unknown) => `${v}%`} fill="#ffffff" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-small text-muted">The dashed line is the fixed route (100%). Shorter is better.</p>
        </section>
      )}

      <p className="mt-6 border-t border-rule pt-3 text-small text-muted">
        Computed from simulated data, not measured. Fuel is an estimate: distance times an assumed litres per km for each truck kind. Stops count bins only, not dump-yard visits.
      </p>
    </div>
  );
}
