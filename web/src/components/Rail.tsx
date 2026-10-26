import {
  Bell,
  CalendarDays,
  FlaskConical,
  LayoutDashboard,
  Route,
  SlidersHorizontal,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { useStore, type TabId } from "../store";

export const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "plan", label: "Daily plan", icon: Route },
  { id: "calendar", label: "Collection calendar", icon: CalendarDays },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "savings", label: "Savings", icon: TrendingDown },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "simulator", label: "Simulator", icon: FlaskConical },
];

/** The product mark: a bin drawn in the accent hue. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="SmartBin Gwalior">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path
        d="M9 11h14l-1.2 12.5a1.5 1.5 0 0 1-1.5 1.3h-8.6a1.5 1.5 0 0 1-1.5-1.3L9 11zm2-3h10v1.8H11V8z"
        fill="var(--surface)"
      />
      <rect x="14.6" y="14" width="2.8" height="7.5" rx="1.2" fill="var(--accent)" />
    </svg>
  );
}

export default function Rail() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const alertCount = useStore((s) => s.alerts.length);

  return (
    <nav
      aria-label="Sections"
      className="z-10 flex items-center bg-surface max-[860px]:order-3 max-[860px]:h-14 max-[860px]:justify-around max-[860px]:border-t max-[860px]:border-line min-[861px]:flex-col min-[861px]:gap-1 min-[861px]:border-r min-[861px]:border-line min-[861px]:py-3"
    >
      <div className="hidden pb-3 min-[861px]:block">
        <BrandMark />
      </div>
      {TABS.map(({ id, label, icon: Icon }, i) => {
        const active = tab === id;
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-label={label}
            aria-current={active ? "true" : undefined}
            title={label}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-card transition-colors max-[860px]:h-12 max-[860px]:w-12 ${
              active ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink"
            } ${id === "settings" ? "min-[861px]:mt-auto" : ""} ${i === 4 ? "" : ""}`}
          >
            <Icon size={18} strokeWidth={1.6} aria-hidden />
            {id === "alerts" && alertCount > 0 && (
              <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-negative px-1 text-center text-[10px] font-semibold leading-4 text-surface">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
            <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-card border border-control bg-surface px-2 py-1 text-small text-ink opacity-0 transition-opacity group-hover:opacity-100 min-[861px]:block">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
