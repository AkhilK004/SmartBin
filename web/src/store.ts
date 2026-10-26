import { create } from "zustand";
import type {
  Alert,
  Bin,
  InitState,
  Plan,
  Savings,
  Settings,
  SimClockState,
  Site,
  Truck,
  Zone,
  ZoneId,
} from "./types";

export type TabId = "overview" | "plan" | "calendar" | "alerts" | "savings" | "settings" | "simulator";

/** A one-shot request for the map to move the camera. `nonce` makes repeats of the same target fire. */
export interface MapFocus {
  kind: "zone" | "truck" | "bin" | "route";
  id: string;
  nonce: number;
}

const MAX_ALERTS = 200;

const TAB_IDS: TabId[] = ["overview", "plan", "calendar", "alerts", "savings", "settings", "simulator"];

/** `?tab=plan` opens that panel, so a screen can be linked to or captured directly. */
function initialTab(): TabId {
  if (typeof window === "undefined") return "overview";
  const t = new URLSearchParams(window.location.search).get("tab") as TabId | null;
  return t && TAB_IDS.includes(t) ? t : "overview";
}

interface Store {
  connected: boolean;
  loaded: boolean;
  bins: Record<string, Bin>;
  zones: Zone[];
  trucks: Truck[];
  sites: Site[];
  plan: Plan | null;
  savings: Savings | null;
  alerts: Alert[];
  settings: Settings | null;
  sim: SimClockState | null;

  tab: TabId;
  selectedBinId: string | null;
  selectedRouteId: string | null;
  hiddenZones: Set<ZoneId>;
  focus: MapFocus | null;

  setConnected(v: boolean): void;
  init(s: InitState): void;
  applyBins(bins: Bin[]): void;
  setTrucks(t: Truck[]): void;
  setRoutes(routes: Plan["routes"]): void;
  setPlan(p: Plan): void;
  addAlert(a: Alert): void;
  setSavings(s: Savings): void;
  setSim(s: SimClockState): void;
  setSettings(s: Settings): void;

  setTab(t: TabId): void;
  selectBin(id: string | null): void;
  selectRoute(id: string | null): void;
  toggleZone(id: ZoneId): void;
  focusOn(kind: MapFocus["kind"], id: string): void;
}

export const useStore = create<Store>((set) => ({
  connected: false,
  loaded: false,
  bins: {},
  zones: [],
  trucks: [],
  sites: [],
  plan: null,
  savings: null,
  alerts: [],
  settings: null,
  sim: null,

  tab: initialTab(),
  selectedBinId: null,
  selectedRouteId: null,
  hiddenZones: new Set(),
  focus: null,

  setConnected: (connected) => set({ connected }),
  init: (s) =>
    set({
      loaded: true,
      bins: Object.fromEntries(s.bins.map((b) => [b.bin_id, b])),
      zones: s.zones,
      trucks: s.trucks,
      sites: s.sites,
      plan: s.plan,
      savings: s.savings,
      // newest first
      alerts: [...s.alerts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_ALERTS),
      settings: s.settings,
      sim: s.sim,
    }),
  applyBins: (bins) =>
    set((st) => {
      const next = { ...st.bins };
      for (const b of bins) next[b.bin_id] = b;
      return { bins: next };
    }),
  setTrucks: (trucks) => set({ trucks }),
  setRoutes: (routes) => set((st) => (st.plan ? { plan: { ...st.plan, routes } } : {})),
  setPlan: (plan) => set({ plan }),
  addAlert: (a) =>
    set((st) => ({ alerts: [a, ...st.alerts.filter((x) => x.alert_id !== a.alert_id)].slice(0, MAX_ALERTS) })),
  setSavings: (savings) => set({ savings }),
  setSim: (sim) => set({ sim }),
  setSettings: (settings) => set({ settings }),

  setTab: (tab) => set({ tab }),
  selectBin: (selectedBinId) => set({ selectedBinId }),
  selectRoute: (selectedRouteId) => set({ selectedRouteId }),
  toggleZone: (id) =>
    set((st) => {
      const next = new Set(st.hiddenZones);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenZones: next };
    }),
  focusOn: (kind, id) => set({ focus: { kind, id, nonce: Date.now() } }),
}));
