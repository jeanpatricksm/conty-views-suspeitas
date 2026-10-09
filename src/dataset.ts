// Gerador de séries sintéticas de views por hora. Determinístico pela semente.

export type Truth = "legit" | "suspicious";
export type Scenario =
  | "organic_normal"
  | "organic_viral_ramp"
  | "organic_viral_fast"
  | "organic_global_audience"
  | "organic_low_volume"
  | "bought_spike"
  | "bot_flat_injection"
  | "bought_then_cliff";

export const SCENARIOS: Record<Scenario, Truth> = {
  organic_normal: "legit",
  organic_viral_ramp: "legit",
  organic_viral_fast: "legit",
  organic_global_audience: "legit",
  organic_low_volume: "legit",
  bought_spike: "suspicious",
  bot_flat_injection: "suspicious",
  bought_then_cliff: "suspicious",
};

export type Sample = {
  id: string;
  scenario: Scenario;
  truth: Truth;
  start_hour_local: number;
  hourly_views: number[];
};

type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: Rng, min: number, max: number) => min + rand() * (max - min);
const int = (rand: Rng, min: number, max: number) => Math.floor(between(rand, min, max + 1));

function gaussian(rand: Rng): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Peso da hora do dia para público humano no Brasil: vale às 4h, pico às 20h. */
function diurnal(hour: number, amplitude: number): number {
  const phase = Math.cos(((hour - 20) / 24) * 2 * Math.PI); // 1 às 20h, −1 às 8h
  const nightDip = hour >= 1 && hour < 7 ? 0.35 : 1;
  return (1 - amplitude) + amplitude * ((phase + 1) / 2) * nightDip + amplitude * 0.15;
}

/** Ruído de contagem (Poisson aproximado) + variação humana multiplicativa. */
function humanNoise(rand: Rng, expected: number, spread = 0.12): number {
  const multiplied = expected * Math.max(0.2, 1 + spread * gaussian(rand));
  return Math.max(0, Math.round(multiplied + Math.sqrt(Math.max(multiplied, 1)) * gaussian(rand)));
}

/** Curva orgânica: estreia que decai, modulada pelo ciclo dia/noite. */
function organic(rand: Rng, hours: number, start: number, opts: { initial: number; tau: number; amplitude: number; floor: number }): number[] {
  return Array.from({ length: hours }, (_, i) => {
    const decay = opts.initial * Math.exp(-i / opts.tau) + opts.floor;
    return decay * diurnal((start + i) % 24, opts.amplitude);
  });
}

function viralBump(hours: number, at: number, height: number, rampHours: number, decayTau: number): number[] {
  return Array.from({ length: hours }, (_, i) => {
    if (i < at - rampHours) return 0;
    if (i <= at) return height * ((i - (at - rampHours) + 1) / (rampHours + 1)) ** 2;
    return height * Math.exp(-(i - at) / decayTau);
  });
}

function generate(rand: Rng, scenario: Scenario, index: number): Sample {
  const hours = int(rand, 48, 120);
  const start = int(rand, 0, 23);
  const base = { initial: between(rand, 300, 4000), tau: between(rand, 10, 40), amplitude: between(rand, 0.6, 0.9), floor: between(rand, 20, 120) };
  let expected = organic(rand, hours, start, base);
  let injected = Array.from({ length: hours }, () => 0);

  switch (scenario) {
    case "organic_normal":
      break;
    case "organic_viral_ramp": {
      const bump = viralBump(hours, int(rand, 14, hours - 20), between(rand, 4, 25) * base.initial, int(rand, 3, 9), between(rand, 5, 24));
      expected = expected.map((x, i) => x + bump[i]! * diurnal((start + i) % 24, base.amplitude));
      break;
    }
    case "organic_viral_fast": {
      // Estourou em 1h (repost grande), mas a cauda humana dura horas.
      const bump = viralBump(hours, int(rand, 14, hours - 20), between(rand, 8, 40) * base.initial, 0, between(rand, 4, 14));
      expected = expected.map((x, i) => x + bump[i]! * diurnal((start + i) % 24, base.amplitude));
      break;
    }
    case "organic_global_audience":
      expected = organic(rand, hours, start, { ...base, amplitude: between(rand, 0.05, 0.25) });
      break;
    case "organic_low_volume":
      expected = organic(rand, hours, start, { ...base, initial: between(rand, 10, 60), floor: between(rand, 1, 8) });
      break;
    case "bought_spike": {
      const at = int(rand, 8, hours - 10);
      const block = int(rand, 1, 3);
      const height = between(rand, 10, 60) * Math.max(...expected.slice(at - 6, at)) + 2000;
      injected = injected.map((_, i) => (i >= at && i < at + block ? height * between(rand, 0.85, 1.15) : 0));
      break;
    }
    case "bot_flat_injection": {
      const at = int(rand, 4, Math.max(5, hours - 36));
      const length = int(rand, 24, Math.min(60, hours - at));
      const rate = between(rand, 4, 12) * Math.max(...expected.slice(at, at + length)) + 400;
      injected = injected.map((_, i) => (i >= at && i < at + length ? rate * (1 + 0.012 * gaussian(rand)) : 0));
      break;
    }
    case "bought_then_cliff": {
      const at = int(rand, 4, hours - 30);
      const length = int(rand, 8, 24);
      const rate = between(rand, 6, 20) * Math.max(...expected.slice(at, at + length + 4)) + 500;
      // Entrega comprada que oscila um pouco (não é plana), e para de uma vez.
      injected = injected.map((_, i) => (i >= at && i < at + length ? rate * (1 + 0.15 * Math.sin(i * 1.7)) * between(rand, 0.9, 1.1) : 0));
      break;
    }
  }

  const hourly = expected.map((x, i) => humanNoise(rand, x) + Math.round(injected[i]!));
  return { id: `${scenario}-${String(index).padStart(3, "0")}`, scenario, truth: SCENARIOS[scenario], start_hour_local: start, hourly_views: hourly };
}

export const DEFAULT_DATASET = { seed: 20260601, perScenario: 150 } as const;

export function generateDataset(options: { seed: number; perScenario: number } = DEFAULT_DATASET): Sample[] {
  const rand = mulberry32(options.seed);
  const samples: Sample[] = [];
  for (const scenario of Object.keys(SCENARIOS) as Scenario[]) {
    for (let i = 0; i < options.perScenario; i += 1) samples.push(generate(rand, scenario, i));
  }
  return samples;
}
