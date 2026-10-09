import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { classify } from "../src/classifier.ts";

/** Série humana determinística: estreia que decai, ciclo dia/noite, sem ruído. */
function human(hours: number, start = 18, initial = 2000, tau = 20, floor = 80): number[] {
  return Array.from({ length: hours }, (_, i) => {
    const hour = (start + i) % 24;
    const day = hour >= 1 && hour < 7 ? 0.3 : hour >= 18 && hour <= 23 ? 1 : 0.7;
    // pequena irregularidade fixa, para não ser uma curva perfeita
    const wobble = 1 + 0.15 * Math.sin(i * 2.3) + 0.08 * Math.cos(i * 0.9);
    return Math.round((initial * Math.exp(-i / tau) + floor) * day * wobble);
  });
}

const signal = (result: ReturnType<typeof classify>, id: string) => result.signals.find((s) => s.id === id);

describe("casos óbvios", () => {
  it("post normal: legítimo, com motivo legível", () => {
    const result = classify({ hourly_views: human(72), start_hour_local: 18 });
    expect(result.label).toBe("legit");
    expect(result.reason).toMatch(/compatíveis com audiência humana/);
    expect(result.signals.every((s) => !s.fired)).toBe(true);
  });

  it("views constantes por 30h: repetição mecânica", () => {
    const v = human(72);
    for (let i = 20; i < 50; i += 1) v[i] = v[i]! + 3000 + ((i * 7) % 5) * 10;
    const result = classify({ hourly_views: v, start_hour_local: 18 });
    expect(result.label).toBe("suspicious");
    expect(signal(result, "mechanical_flat")).toMatchObject({ fired: true });
    expect(result.reason).toMatch(/quase constantes/);
  });

  it("nível alto sustentado que some de uma hora para outra: queda abrupta", () => {
    const v = human(72);
    for (let i = 20; i < 34; i += 1) v[i] = v[i]! + 4000 + (i % 3) * 600;
    const result = classify({ hourly_views: v, start_hour_local: 18 });
    expect(result.label).toBe("suspicious");
    expect(signal(result, "abrupt_cliff")).toMatchObject({ fired: true });
  });
});

describe("pico orgânico × pico comprado", () => {
  const base = human(72);

  it("pico comprado: sobe numa hora e despenca na seguinte", () => {
    const v = [...base];
    v[30] = v[30]! + 25_000;
    v[31] = v[31]! + 22_000;
    const result = classify({ hourly_views: v, start_hour_local: 18 });
    expect(result.label).toBe("suspicious");
    expect(signal(result, "bought_spike")).toMatchObject({ fired: true, hours: [30, 31] });
    expect(result.reason).toMatch(/não some de uma hora para outra/);
  });

  it("pico orgânico do mesmo tamanho, que sobe de uma vez mas tem cauda longa: não acusa", () => {
    const v = [...base];
    // mesmo salto na hora 30, mas a audiência fica e decai devagar (meia-vida de ~5h)
    for (let i = 30; i < 72; i += 1) v[i] = v[i]! + Math.round(25_000 * Math.exp(-(i - 30) / 7));
    const result = classify({ hourly_views: v, start_hour_local: 18 });
    expect(result.label).not.toBe("suspicious");
    expect(signal(result, "bought_spike")).toMatchObject({ fired: false });
  });

  it("a diferença está na cauda: mesmo salto, cauda que decai devagar vs. cauda que some", () => {
    const organic = [...base];
    const bought = [...base];
    organic[30] = organic[30]! + 25_000;
    bought[30] = bought[30]! + 25_000;
    // depois do salto, a audiência humana vai embora aos poucos: 10k, 6k, 3,6k, 2,2k…
    for (let i = 31; i < 72; i += 1) organic[i] = organic[i]! + Math.round(10_000 * 0.6 ** (i - 31));
    const o = signal(classify({ hourly_views: organic, start_hour_local: 18 }), "bought_spike");
    const b = signal(classify({ hourly_views: bought, start_hour_local: 18 }), "bought_spike");
    expect(o?.fired).toBe(false);
    expect(b?.fired).toBe(true);
    expect(b?.value).toBeLessThan(0.15);
  });
});

describe("quando o classificador prefere não acusar", () => {
  it("sem ciclo dia/noite, mas com variação humana: inconclusive, não suspicious", () => {
    // público espalhado em vários fusos: madrugada no Brasil é dia em outro lugar
    const v = Array.from({ length: 72 }, (_, i) => Math.round((1500 * Math.exp(-i / 30) + 400) * (1 + 0.2 * Math.sin(i * 2.3) + 0.1 * Math.cos(i * 0.7))));
    const result = classify({ hourly_views: v, start_hour_local: 18 });
    expect(result.label).toBe("inconclusive");
    expect(signal(result, "no_day_night_cycle")).toMatchObject({ fired: true, strength: "weak" });
    expect(result.reason).toMatch(/não basta para acusar/);
  });

  it("padrão estranho com volume baixo: inconclusive", () => {
    const v = Array.from({ length: 48 }, (_, i) => (i === 20 ? 1200 : 20));
    const result = classify({ hourly_views: v, start_hour_local: 0 });
    expect(result.stats.total_views).toBeLessThan(3000);
    expect(result.label).toBe("inconclusive");
    expect(result.reason).toMatch(/ruído é grande demais/);
  });

  it("série curta demais: inconclusive", () => {
    expect(classify({ hourly_views: human(12), start_hour_local: 18 }).label).toBe("inconclusive");
  });
});

describe("API", () => {
  it("devolve classificação, motivo e sinais", async () => {
    const res = await createApp().request("/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: "p1", start_hour_local: 18, hourly_views: human(72) }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { post_id: string; label: string; reason: string; signals: unknown[] };
    expect(body).toMatchObject({ post_id: "p1", label: "legit" });
    expect(body.signals).toHaveLength(5);
  });

  it("valida a série", async () => {
    const app = createApp();
    const post = (body: unknown) => app.request("/classify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ hourly_views: [1, -2] })).status).toBe(400);
    expect((await post({ hourly_views: [1, 2], start_hour_local: 24 })).status).toBe(400);
  });
});
