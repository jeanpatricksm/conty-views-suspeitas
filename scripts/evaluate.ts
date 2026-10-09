// Gera o dataset sintético, roda o classificador e mede as taxas.
//   npm run evaluate   → imprime as métricas e reescreve o bloco do README
//   npm run dataset    → também grava data/dataset.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_DATASET, generateDataset } from "../src/dataset.ts";
import { evaluate, metricsBlock, README_END, README_START } from "../src/evaluate.ts";

const samples = generateDataset(DEFAULT_DATASET);
const metrics = evaluate(samples, DEFAULT_DATASET.seed);
const block = metricsBlock(metrics);
console.log(block);

if (process.argv.includes("--write-dataset")) {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../data/dataset.json", import.meta.url), JSON.stringify({ ...DEFAULT_DATASET, samples }));
  console.log(`\ndata/dataset.json gravado (${samples.length} séries)`);
}

if (process.argv.includes("--write-readme")) {
  const url = new URL("../README.md", import.meta.url);
  const readme = readFileSync(url, "utf8");
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < start) throw new Error("README sem os marcadores de métricas");
  writeFileSync(url, `${readme.slice(0, start + README_START.length)}\n${block}\n${readme.slice(end)}`);
  console.log("\nREADME.md atualizado");
}
