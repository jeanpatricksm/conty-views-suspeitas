import { Hono } from "hono";
import { classify, THRESHOLDS } from "./classifier.ts";

export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  /** Os limiares em uso, para quem quiser auditar a decisão. */
  app.get("/criteria", (c) => c.json(THRESHOLDS));

  app.post("/classify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const series = body?.hourly_views;
    const start = body?.start_hour_local ?? 0;
    if (
      !Array.isArray(series) ||
      series.length === 0 ||
      series.length > 24 * 60 ||
      !series.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)
    ) {
      return c.json({ error: "hourly_views deve ser uma lista de 1 a 1440 números ≥ 0 (views ganhas em cada hora)" }, 400);
    }
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start > 23) {
      return c.json({ error: "start_hour_local deve ser um inteiro de 0 a 23 (hora local da primeira posição)" }, 400);
    }
    return c.json({ post_id: typeof body?.post_id === "string" ? body.post_id : null, ...classify({ hourly_views: series as number[], start_hour_local: start }) });
  });

  return app;
}
