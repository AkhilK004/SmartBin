import { z } from "zod";
import { config } from "../config.js";
import type { SensorReading } from "../types.js";

export const readingSchema = z.object({
  bin_id: z.string().min(1),
  fill_pct: z.number().min(0).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  battery: z.number().min(0).max(100),
  temp_c: z.number(),
  gas_ppm: z.number().min(0),
  timestamp: z.string().datetime(),
});

const payloadSchema = z.union([
  readingSchema.transform((r) => [r]),
  z.array(readingSchema).min(1).max(config.ingestMaxBatch),
]);

/** SNS accepts HTTPS endpoints only from its own hosts for subscription confirmation. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export type IngestResult =
  | { kind: "readings"; readings: SensorReading[] }
  | { kind: "confirmed" }
  | { kind: "ignored" }
  | { kind: "error"; status: number; error: unknown };

export async function parseIngest(
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestResult> {
  const type = (body as { Type?: unknown } | null)?.Type;
  if (typeof type === "string") return parseSns(body as Record<string, unknown>, type, fetchImpl);

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return { kind: "error", status: 400, error: parsed.error.flatten() };
  return { kind: "readings", readings: parsed.data };
}

async function parseSns(
  env: Record<string, unknown>,
  type: string,
  fetchImpl: typeof fetch,
): Promise<IngestResult> {
  if (type === "SubscriptionConfirmation") {
    let url: URL;
    try {
      url = new URL(String(env.SubscribeURL));
    } catch {
      return { kind: "error", status: 400, error: "invalid SubscribeURL" };
    }
    if (url.protocol !== "https:" || !SNS_HOST.test(url.hostname)) {
      return { kind: "error", status: 400, error: "SubscribeURL host is not an SNS endpoint" };
    }
    const res = await fetchImpl(url);
    if (!res.ok) return { kind: "error", status: 502, error: `SNS confirm failed (${res.status})` };
    return { kind: "confirmed" };
  }
  if (type === "Notification") {
    let inner: unknown;
    try {
      inner = JSON.parse(String(env.Message));
    } catch {
      return { kind: "error", status: 400, error: "SNS Message is not valid JSON" };
    }
    const parsed = payloadSchema.safeParse(inner);
    if (!parsed.success) return { kind: "error", status: 400, error: parsed.error.flatten() };
    return { kind: "readings", readings: parsed.data };
  }
  return { kind: "ignored" };
}
