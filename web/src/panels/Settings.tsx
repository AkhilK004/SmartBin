import { useEffect, useState } from "react";
import { useStore } from "../store";
import { errorText, putSettings, runDailyPlan } from "../api";
import { Button, ErrorLine, PageTitle, SectionTitle, useAction } from "../ui";
import { fmt } from "../format";
import type { Settings } from "../types";

type Draft = {
  fill: number;
  overflow_risk: number;
  location: number;
  penalty_scale: number;
  skip_below_pct: number;
  must_visit_above_pct: number;
  urgent_at_pct: number;
  gas_ppm_hazard: number;
  temp_c_hazard: number;
};

const toDraft = (s: Settings): Draft => ({
  fill: s.priority_weights.fill,
  overflow_risk: s.priority_weights.overflow_risk,
  location: s.priority_weights.location,
  penalty_scale: s.penalty_scale,
  ...s.thresholds,
});

export default function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setTab = useStore((s) => s.setTab);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !draft) setDraft(toDraft(settings));
  }, [settings, draft]);

  const save = useAction(async (replan: boolean) => {
    if (!draft) return;
    if (!(draft.skip_below_pct <= draft.must_visit_above_pct && draft.must_visit_above_pct <= draft.urgent_at_pct)) {
      return "Thresholds must satisfy skip below ≤ must visit above ≤ urgent at.";
    }
    if (draft.fill + draft.overflow_risk + draft.location <= 0) return "At least one priority weight must be above zero.";
    const r = await putSettings({
      priority_weights: { fill: draft.fill, overflow_risk: draft.overflow_risk, location: draft.location },
      penalty_scale: draft.penalty_scale,
      thresholds: {
        skip_below_pct: draft.skip_below_pct,
        must_visit_above_pct: draft.must_visit_above_pct,
        urgent_at_pct: draft.urgent_at_pct,
        gas_ppm_hazard: draft.gas_ppm_hazard,
        temp_c_hazard: draft.temp_c_hazard,
      },
    });
    if (!r.ok) return errorText(r.data, "Settings were rejected");
    setSettings(r.data);
    setDraft(toDraft(r.data));
    setSaved(true);
    if (replan) {
      const p = await runDailyPlan();
      if (!p.ok) return errorText(p.data, `Re-plan failed (${p.status})`);
      setTab("plan");
    }
  });

  if (!settings || !draft) {
    return (
      <div>
        <PageTitle title="Settings" finding="Waiting for the server." />
      </div>
    );
  }

  const set = (k: keyof Draft, v: number) => {
    setSaved(false);
    setDraft({ ...draft, [k]: Number.isFinite(v) ? v : 0 });
  };
  const sum = draft.fill + draft.overflow_risk + draft.location;
  const share = (v: number) => (sum > 0 ? (v / sum) * 100 : 0);

  return (
    <div>
      <PageTitle title="Settings" finding="Changes apply to the next plan. Weights are normalised to sum to 100%." />

      <SectionTitle>Priority weights</SectionTitle>
      <p className="mb-3 text-small text-muted">Priority = fill × weight + overflow risk × weight + location × weight. It ranks the optional stops.</p>
      {(
        [
          ["fill", "Fill level"],
          ["overflow_risk", "Overflow risk"],
          ["location", "Location type"],
        ] as const
      ).map(([k, label]) => (
        <div key={k} className="mb-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor={`w-${k}`} className="text-body font-medium">
              {label}
            </label>
            <span className="text-body">{fmt.int(share(draft[k]))}%</span>
          </div>
          <input
            id={`w-${k}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(draft[k] * 100)}
            onChange={(e) => set(k, Number(e.target.value) / 100)}
            className="mt-1 w-full accent-[var(--accent)]"
          />
        </div>
      ))}

      <SectionTitle>Optimizer</SectionTitle>
      <Field id="penalty" label="Penalty scale" hint="Higher keeps more optional bins. At 60, a priority-70 bin is worth about 4.2 km of detour." value={draft.penalty_scale} min={1} step={1} onChange={(v) => set("penalty_scale", v)} />

      <SectionTitle>Fill thresholds</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Field id="skip" label="Skip below" suffix="%" value={draft.skip_below_pct} min={0} max={100} onChange={(v) => set("skip_below_pct", v)} />
        <Field id="must" label="Must visit above" suffix="%" value={draft.must_visit_above_pct} min={0} max={100} onChange={(v) => set("must_visit_above_pct", v)} />
        <Field id="urgent" label="Urgent at" suffix="%" value={draft.urgent_at_pct} min={0} max={100} onChange={(v) => set("urgent_at_pct", v)} />
      </div>

      <SectionTitle>Hazard</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field id="gas" label="Gas above" suffix="ppm" value={draft.gas_ppm_hazard} min={0} onChange={(v) => set("gas_ppm_hazard", v)} />
        <Field id="temp" label="Temperature above" suffix="°C" value={draft.temp_c_hazard} onChange={(v) => set("temp_c_hazard", v)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={save.busy} onClick={() => save.run(true)}>
          Save and re-plan
        </Button>
        <Button busy={save.busy} onClick={() => save.run(false)}>
          Save only
        </Button>
        <Button onClick={() => { setDraft(toDraft(settings)); setSaved(false); }}>Reset</Button>
      </div>
      {saved && !save.error && <p className="mt-2 text-small text-positive">Saved.</p>}
      <ErrorLine>{save.error}</ErrorLine>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange(v: number): void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-small text-muted">
        {label}
      </label>
      <div className="flex h-[34px] items-center rounded-card border border-control bg-ground px-2 focus-within:border-accent">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className="w-full bg-transparent text-body text-ink outline-none"
        />
        {suffix && <span className="text-small text-muted">{suffix}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
