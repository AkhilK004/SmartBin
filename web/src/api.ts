import { io, type Socket } from "socket.io-client";
import { useStore } from "./store";
import type { Alert, Bin, InitState, Plan, Savings, Settings, SimClockState, Truck } from "./types";

/** HTTP goes through the dev/preview proxy at /api (see vite.config.ts). */
export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: unknown }).error;
    if (typeof e === "string") return e;
    return JSON.stringify(e);
  }
  return fallback;
}

export const runDailyPlan = () => api<Plan>("/jobs/daily", { method: "POST" });
export const runFrequencyJob = () => api<unknown>("/jobs/frequency", { method: "POST" });
export const putSettings = (patch: unknown) =>
  api<Settings>("/settings", { method: "PUT", body: JSON.stringify(patch) });
export const setSimSpeed = (speed: number) =>
  api<unknown>("/sim/speed", { method: "POST", body: JSON.stringify({ speed }) });
export const setSimBin = (body: Record<string, unknown>) =>
  api<Bin>("/sim/bin", { method: "POST", body: JSON.stringify(body) });

let socket: Socket | null = null;

/** Opens the Socket.io connection once and feeds the store from the events in shared/schemas.md. */
export function connectSocket(): () => void {
  if (socket) return () => undefined;
  const s = io({ transports: ["websocket", "polling"] });
  socket = s;
  const st = () => useStore.getState();
  s.on("connect", () => st().setConnected(true));
  s.on("disconnect", () => st().setConnected(false));
  s.on("state:init", (p: InitState) => st().init(p));
  s.on("bins:update", (b: Bin[]) => st().applyBins(b));
  s.on("trucks:update", (t: Truck[]) => st().setTrucks(t));
  s.on("sim:update", (v: SimClockState) => st().setSim(v));
  s.on("routes:update", (r: Plan["routes"]) => st().setRoutes(r));
  s.on("plan:update", (p: Plan) => st().setPlan(p));
  s.on("alerts:new", (a: Alert) => st().addAlert(a));
  s.on("savings:update", (v: Savings) => st().setSavings(v));
  return () => {
    s.close();
    socket = null;
  };
}
