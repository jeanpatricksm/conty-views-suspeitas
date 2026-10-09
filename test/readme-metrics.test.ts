import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateDataset } from "../src/dataset.ts";
import { evaluateDefault, metricsBlock, README_END, README_START } from "../src/evaluate.ts";

describe("números do README", () => {
  it("o bloco de métricas do README é exatamente o que `npm run evaluate` mede", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = readme.indexOf(README_START);
    const end = readme.indexOf(README_END);
    expect(start, "README sem o marcador de início").toBeGreaterThanOrEqual(0);
    const written = readme.slice(start + README_START.length, end).trim();
    expect(written).toBe(metricsBlock(evaluateDefault()));
  });

  it("o dataset é reproduzível pela semente", () => {
    const a = generateDataset({ seed: 1, perScenario: 3 });
    const b = generateDataset({ seed: 1, perScenario: 3 });
    expect(a).toEqual(b);
    expect(generateDataset({ seed: 2, perScenario: 3 })).not.toEqual(a);
  });
});
