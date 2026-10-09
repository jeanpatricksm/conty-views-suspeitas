import { classify, type Label } from "./classifier.ts";
import { DEFAULT_DATASET, generateDataset, type Sample, type Scenario } from "./dataset.ts";

export type Metrics = {
  seed: number;
  samples: number;
  legit_total: number;
  suspicious_total: number;
  /** Legítimos classificados como suspeitos ÷ legítimos. */
  false_positive_rate: number;
  /** Legítimos em que o classificador preferiu não decidir. */
  legit_inconclusive_rate: number;
  /** Suspeitos classificados como suspeitos ÷ suspeitos. */
  detection_rate: number;
  /** Suspeitos classificados como legítimos ÷ suspeitos. */
  miss_rate: number;
  by_scenario: Record<Scenario, Record<Label, number>>;
};

const ratio = (part: number, total: number) => (total ? Math.round((part / total) * 10_000) / 10_000 : 0);

export function evaluate(samples: Sample[], seed: number): Metrics {
  const byScenario = {} as Record<Scenario, Record<Label, number>>;
  let fp = 0;
  let legitInconclusive = 0;
  let tp = 0;
  let missed = 0;
  let legit = 0;
  let suspicious = 0;

  for (const sample of samples) {
    const { label } = classify(sample);
    byScenario[sample.scenario] ??= { legit: 0, suspicious: 0, inconclusive: 0 };
    byScenario[sample.scenario][label] += 1;
    if (sample.truth === "legit") {
      legit += 1;
      if (label === "suspicious") fp += 1;
      if (label === "inconclusive") legitInconclusive += 1;
    } else {
      suspicious += 1;
      if (label === "suspicious") tp += 1;
      if (label === "legit") missed += 1;
    }
  }

  return {
    seed,
    samples: samples.length,
    legit_total: legit,
    suspicious_total: suspicious,
    false_positive_rate: ratio(fp, legit),
    legit_inconclusive_rate: ratio(legitInconclusive, legit),
    detection_rate: ratio(tp, suspicious),
    miss_rate: ratio(missed, suspicious),
    by_scenario: byScenario,
  };
}

export function evaluateDefault(): Metrics {
  return evaluate(generateDataset(DEFAULT_DATASET), DEFAULT_DATASET.seed);
}

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

/** Bloco que vai no README entre os marcadores. O teste compara o README com isto. */
export function metricsBlock(metrics: Metrics): string {
  const rows = (Object.entries(metrics.by_scenario) as Array<[Scenario, Record<Label, number>]>).map(
    ([scenario, counts]) => `| \`${scenario}\` | ${counts.legit} | ${counts.inconclusive} | ${counts.suspicious} |`,
  );
  return [
    `Semente \`${metrics.seed}\`, ${metrics.samples} séries (${metrics.legit_total} legítimas, ${metrics.suspicious_total} suspeitas).`,
    "",
    `- **Taxa de falso positivo: ${pct(metrics.false_positive_rate)}** (legítimas classificadas como suspeitas)`,
    `- Legítimas em que o classificador preferiu não acusar (inconclusive): ${pct(metrics.legit_inconclusive_rate)}`,
    `- Detecção: ${pct(metrics.detection_rate)} das suspeitas classificadas como suspeitas`,
    `- Suspeitas que passaram como legítimas: ${pct(metrics.miss_rate)}`,
    "",
    "| cenário | legit | inconclusive | suspicious |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export const README_START = "<!-- metrics:start -->";
export const README_END = "<!-- metrics:end -->";
