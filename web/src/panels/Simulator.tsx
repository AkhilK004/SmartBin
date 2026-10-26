import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { CLASS_LABEL, COLOR_HEX, LOCATION_LABEL, fmt, zoneName } from "../format";
import { errorText, runDailyPlan, runFrequencyJob, setSimBin, setSimSpeed } from "../api";
import { Button, Choice, Dot, ErrorLine, PageTitle, Pill, SectionTitle, useAction } from "../ui";
import type { Bin } from "../types";

/** Manual sensor simulator. Overrides go through POST /sim/bin, like a device reading would. */
export default function SimulatorPanel() {
  const sim = useStore((s) => s.sim);
  const bins = useStore((s) => s.bins);
  const selectedBinId = useStore((s) => s.selectedBinId);
  const selectBin = useStore((s) => s.selectBin);
  const focusOn = useStore((s) => s.focusOn);
  const setTab = useStore((s) => s.setTab);
  const [query, setQuery] = useState("");

  const speed = useAction(async (v: number) => {
    const r = await setSimSpeed(v);
    if (!r.ok) return errorText(r.data, "Could not change speed");
  });
  const plan = useAction(async () => {
    const r = await runDailyPlan();
    if (!r.ok) return errorText(r.data, `Plan failed (${r.status})`);
    setTab("plan");
  });
  const freq = useAction(async () => {
    const r = await runFrequencyJob();
    if (!r.ok) return errorText(r.data, `Frequency job failed (${r.status})`);
  });

  const ids = useMemo(() => Object.keys(bins).sort(), [bins]);
  const bin = selectedBinId ? bins[selectedBinId] : undefined;

  return (
    <div>
      <PageTitle title="Simulator" finding="Change a bin by hand and watch the map, the classes and the plan react. Data is simulated." />

      <SectionTitle>Time</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-small text-muted">Simulated time, IST</div>
          <div className="text-kpi font-medium">{sim ? fmt.dateTime(sim.now) : "—"}</div>
        </div>
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
      <ErrorLine>{speed.error}</ErrorLine>

      <SectionTitle>Jobs</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={plan.busy} onClick={() => plan.run()}>
          Run daily plan now
        </Button>
        <Button busy={freq.busy} onClick={() => freq.run()}>
          Recompute zone frequency
        </Button>
      </div>
      <ErrorLine>{plan.error ?? freq.error}</ErrorLine>

      <SectionTitle>Bin</SectionTitle>
      <label htmlFor="bin-search" className="mb-1 block text-small text-muted">
        Pick a bin by id, or click one on the map
      </label>
      <div className="flex gap-2">
        <input
          id="bin-search"
          list="bin-ids"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            const hit = ids.find((i) => i.toLowerCase() === e.target.value.trim().toLowerCase());
            if (hit) {
              selectBin(hit);
              focusOn("bin", hit);
            }
          }}
          placeholder="B-001"
          className="h-[34px] w-full rounded-card border border-control bg-ground px-2 text-body outline-none focus:border-accent"
        />
        <datalist id="bin-ids">
          {ids.map((i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
      </div>

      {bin ? <BinEditor key={bin.bin_id} bin={bin} /> : <p className="mt-3 text-body text-muted">No bin selected.</p>}
    </div>
  );
}

function BinEditor({ bin }: { bin: Bin }) {
  const zones = useStore((s) => s.zones);
  const settings = useStore((s) => s.settings);
  const [fill, setFill] = useState(Math.round(bin.fill_pct));
  const [gas, setGas] = useState(Math.round(bin.gas_ppm));
  const [temp, setTemp] = useState(Math.round(bin.temp_c));
  const [complaint, setComplaint] = useState(bin.complaint);
  const [offline, setOffline] = useState(bin.status === "offline");

  // Follow the live bin when a reading arrives and the editor has not been changed from it.
  useEffect(() => {
    setFill(Math.round(bin.fill_pct));
  }, [bin.fill_pct]);

  const apply = useAction(async (patch?: Record<string, unknown>) => {
    const body = patch ?? { fill_pct: fill, gas_ppm: gas, temp_c: temp, complaint, offline };
    const r = await setSimBin({ bin_id: bin.bin_id, ...body });
    if (!r.ok) return errorText(r.data, "The simulator rejected the change");
  });

  const t = settings?.thresholds;
  const flags = [bin.urgent && "Urgent", bin.hazard && "Hazard", bin.predicted_overflow && "Overflow predicted", bin.complaint && "Complaint"].filter(Boolean) as string[];

  return (
    <div className="mt-3 rounded-card border border-line bg-ground p-3">
      <div className="flex items-center gap-2">
        <Dot color={COLOR_HEX[bin.color]} size={10} />
        <span className="text-[16px] font-semibold">{bin.bin_id}</span>
        <span className="text-small text-muted">
          {LOCATION_LABEL[bin.location_type]} · {zoneName(zones, bin.zone_id)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill>{CLASS_LABEL[bin.bin_class]}</Pill>
        {flags.map((f) => (
          <Pill key={f} tone={f === "Hazard" || f === "Urgent" ? "negative" : "warning"}>
            {f}
          </Pill>
        ))}
        <span className="text-small text-muted">Priority {fmt.dec(bin.priority, 0)}</span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="sim-fill" className="text-body font-medium">
            Fill level
          </label>
          <span className="text-kpi font-medium">{fill}%</span>
        </div>
        <input
          id="sim-fill"
          type="range"
          min={0}
          max={100}
          value={fill}
          onChange={(e) => setFill(Number(e.target.value))}
          className="mt-1 w-full accent-[var(--accent)]"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {[
          { label: "Empty", fill: 0 },
          { label: "Skip: 30%", fill: 30 },
          { label: "Standard: 88%", fill: 88 },
          { label: "Urgent: 96%", fill: 96 },
        ].map((q) => (
          <button
            key={q.label}
            onClick={() => {
              setFill(q.fill);
              apply.run({ fill_pct: q.fill });
            }}
            className="rounded-card border border-control px-2 py-1 text-small hover:bg-raised"
          >
            {q.label}
          </button>
        ))}
        <button
          onClick={() => {
            const ppm = Math.round((t?.gas_ppm_hazard ?? 400) + 60);
            setGas(ppm);
            apply.run({ gas_ppm: ppm });
          }}
          className="rounded-card border border-control px-2 py-1 text-small hover:bg-raised"
        >
          Gas spike
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField id="sim-gas" label="Gas" suffix="ppm" value={gas} onChange={setGas} min={0} />
        <NumberField id="sim-temp" label="Temperature" suffix="°C" value={temp} onChange={setTemp} />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <Check id="sim-complaint" checked={complaint} onChange={setComplaint} label="Citizen complaint (counts as hazard)" />
        <Check id="sim-offline" checked={offline} onChange={setOffline} label="Sensor offline" />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" busy={apply.busy} onClick={() => apply.run()}>
          Apply to bin
        </Button>
        <span className="text-small text-muted">Last seen {fmt.time(bin.last_seen)}</span>
      </div>
      <ErrorLine>{apply.error}</ErrorLine>
    </div>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  onChange,
  min,
}: {
  id: string;
  label: string;
  suffix: string;
  value: number;
  onChange(v: number): void;
  min?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-small text-muted">
        {label}
      </label>
      <div className="flex h-[34px] items-center rounded-card border border-control bg-surface px-2 focus-within:border-accent">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
          className="w-full bg-transparent text-body outline-none"
        />
        <span className="text-small text-muted">{suffix}</span>
      </div>
    </div>
  );
}

function Check({ id, checked, onChange, label }: { id: string; checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-body">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}
