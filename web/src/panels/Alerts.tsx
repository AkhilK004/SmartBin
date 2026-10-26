import { useMemo, useState } from "react";
import { useStore } from "../store";
import { COLOR_HEX, fmt } from "../format";
import { Dot, Empty, PageTitle, Tabs } from "../ui";
import type { AlertType } from "../types";

type Filter = "all" | AlertType;

const LABEL: Record<AlertType, string> = {
  overflow: "Overflow",
  hazard: "Hazard",
  low_battery: "Low battery",
  offline: "Offline",
};
const DOT: Record<AlertType, string> = {
  overflow: COLOR_HEX.red,
  hazard: COLOR_HEX.purple,
  low_battery: COLOR_HEX.amber,
  offline: COLOR_HEX.grey,
};

export default function AlertsPanel() {
  const alerts = useStore((s) => s.alerts);
  const bins = useStore((s) => s.bins);
  const selectBin = useStore((s) => s.selectBin);
  const focusOn = useStore((s) => s.focusOn);
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: alerts.length, overflow: 0, hazard: 0, low_battery: 0, offline: 0 };
    for (const a of alerts) c[a.type] += 1;
    return c;
  }, [alerts]);
  const shown = filter === "all" ? alerts : alerts.filter((a) => a.type === filter);

  return (
    <div>
      <PageTitle
        title="Alerts"
        finding={
          alerts.length === 0
            ? "No alerts. Each one fires once when a bin changes state."
            : `${counts.overflow} overflow, ${counts.hazard} hazard, ${counts.low_battery} low battery, ${counts.offline} offline.`
        }
      />
      <Tabs<Filter>
        label="Alert type"
        value={filter}
        onChange={setFilter}
        items={[
          { id: "all", label: "All", count: counts.all },
          { id: "overflow", label: "Overflow", count: counts.overflow },
          { id: "hazard", label: "Hazard", count: counts.hazard },
          { id: "low_battery", label: "Battery", count: counts.low_battery },
          { id: "offline", label: "Offline", count: counts.offline },
        ]}
      />
      <div className="mt-3">
        {shown.length === 0 ? (
          <Empty>Nothing here.</Empty>
        ) : (
          <ul>
            {shown.map((a) => (
              <li key={a.alert_id} className="border-b border-rule last:border-0">
                <button
                  className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-ground"
                  onClick={() => {
                    if (bins[a.bin_id]) {
                      selectBin(a.bin_id);
                      focusOn("bin", a.bin_id);
                    }
                  }}
                >
                  <span className="mt-1.5">
                    <Dot color={DOT[a.type]} size={9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium">{LABEL[a.type]}</span>
                    <span className="block text-body text-muted">{a.message}</span>
                  </span>
                  <span className="flex-none pt-0.5 text-small text-muted">{fmt.dateTime(a.timestamp)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
