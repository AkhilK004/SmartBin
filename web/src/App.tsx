import { useEffect } from "react";
import { connectSocket } from "./api";
import { useStore } from "./store";
import MapView from "./MapView";
import Rail from "./components/Rail";
import TopBar from "./components/TopBar";
import Legend from "./components/Legend";
import Overview from "./panels/Overview";
import PlanPanel from "./panels/Plan";
import CalendarPanel from "./panels/Calendar";
import AlertsPanel from "./panels/Alerts";
import SavingsPanel from "./panels/Savings";
import SettingsPanel from "./panels/Settings";
import SimulatorPanel from "./panels/Simulator";

const PANELS = {
  overview: Overview,
  plan: PlanPanel,
  calendar: CalendarPanel,
  alerts: AlertsPanel,
  savings: SavingsPanel,
  settings: SettingsPanel,
  simulator: SimulatorPanel,
} as const;

export default function App() {
  const tab = useStore((s) => s.tab);
  const loaded = useStore((s) => s.loaded);
  const connected = useStore((s) => s.connected);

  useEffect(() => connectSocket(), []);

  const Panel = PANELS[tab];

  return (
    <div className="shell">
      <Rail />
      <main className="relative min-h-0 min-w-0 max-[860px]:order-1">
        <MapView />
        <TopBar />
        <Legend />
        {!loaded && (
          <div role="status" className="absolute inset-x-0 top-24 z-20 mx-auto w-fit max-w-[90%] rounded-card border border-line bg-surface px-4 py-3 text-body">
            {connected ? "Loading state from the server…" : "Waiting for the server at /api. Start it with npm run dev in server/."}
          </div>
        )}
      </main>
      <aside
        aria-label="Details"
        className="scroll-y min-h-0 border-l border-line bg-surface px-5 pb-10 pt-5 max-[860px]:order-2 max-[860px]:border-l-0 max-[860px]:border-t"
      >
        <Panel />
      </aside>
    </div>
  );
}
