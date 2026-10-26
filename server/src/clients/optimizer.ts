import { config } from "../config.js";
import type { OptimizeRequest, OptimizeResponse } from "../types.js";

export class OptimizerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function createOptimizerClient(baseUrl = config.optimizerUrl, fetchImpl: typeof fetch = fetch) {
  async function post(path: string, body: OptimizeRequest): Promise<OptimizeResponse> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.optimizerTimeoutMs),
      });
    } catch (err) {
      throw new OptimizerError(`optimizer unreachable at ${baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { detail?: unknown };
        if (typeof j.detail === "string") detail = j.detail;
      } catch {
        /* keep the status text */
      }
      throw new OptimizerError(`optimizer ${res.status}: ${detail}`, res.status);
    }
    return (await res.json()) as OptimizeResponse;
  }

  return {
    optimize: (req: OptimizeRequest) => post("/optimize", req),
    baseline: (req: OptimizeRequest) => post("/baseline", req),
  };
}
