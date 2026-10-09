// Classificador explicável de views por hora. Sem modelo: cada sinal é uma conta
// simples, com limiar fixo, e a decisão é uma regra que cabe numa frase.

export const THRESHOLDS = {
  /** Série mínima para julgar: menos de 24h não mostra ciclo nem cauda. */
  minHours: 24,
  /** Abaixo disso, ruído domina; o classificador não acusa. */
  minTotalViews: 3000,

  /** Pico: hora com ≥ 8× a mediana das 6h anteriores e ≥ 1000 views acima dela. */
  spikeRatio: 8,
  spikeMinExtra: 1000,
  /** Bloco do pico: horas seguidas com ≥ 50% do pico. Comprado dura pouco. */
  spikeBlockFraction: 0.5,
  spikeMaxBlockHours: 4,
  /** Cauda: média das 3h depois do bloco ÷ pico. Comprado despenca; orgânico decai devagar. */
  boughtTailMax: 0.15,
  ambiguousTailMax: 0.3,

  /** Repetição mecânica: janela de 12h com média ≥ 200 e coeficiente de variação < 3,5%. */
  flatWindowHours: 12,
  flatMinMean: 200,
  flatMaxCv: 0.035,

  /** Queda abrupta: 3h sustentadas ≥ 300 e, de uma hora para outra, ≤ 12% disso por 3h. */
  cliffMinLevel: 300,
  cliffMaxRatio: 0.12,

  /** Ciclo dia/noite: média 02h–06h ÷ média 12h–22h (horário local). Humano dorme. */
  diurnalMinHours: 48,
  diurnalMaxNightDayRatio: 0.85,
} as const;

export type Label = "legit" | "suspicious" | "inconclusive";
export type SignalId = "bought_spike" | "ambiguous_spike" | "mechanical_flat" | "abrupt_cliff" | "no_day_night_cycle";

export type Signal = {
  id: SignalId;
  fired: boolean;
  strength: "strong" | "weak";
  value: number | null;
  threshold: string;
  hours: [number, number] | null;
  explanation: string;
};

export type Classification = {
  label: Label;
  reason: string;
  signals: Signal[];
  stats: { hours: number; total_views: number; peak_hour: number; peak_views: number };
};

export type SeriesInput = {
  /** Views ganhas em cada hora desde a publicação (não acumulado). */
  hourly_views: number[];
  /** Hora local (0–23, America/Sao_Paulo) da primeira posição da série. */
  start_hour_local: number;
};

const T = THRESHOLDS;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Pico isolado: subiu de uma vez e despencou logo depois. */
function spikeSignals(v: number[]): Signal[] {
  let bought: Signal | null = null;
  let ambiguous: Signal | null = null;
  for (let i = 3; i < v.length - 1; i += 1) {
    const base = median(v.slice(Math.max(0, i - 6), i));
    if (v[i]! < Math.max(base, 1) * T.spikeRatio || v[i]! - base < T.spikeMinExtra) continue;

    let end = i;
    let peak = v[i]!;
    while (end + 1 < v.length && v[end + 1]! >= T.spikeBlockFraction * Math.max(peak, v[end + 1]!)) {
      end += 1;
      peak = Math.max(peak, v[end]!);
    }
    const block = end - i + 1;
    const tail = v.slice(end + 1, end + 4);
    if (tail.length < 3) break; // pico no fim da série: sem cauda, sem julgamento
    const tailRatio = mean(tail) / peak;
    const ratio = round(v[i]! / Math.max(base, 1), 1);

    if (block <= T.spikeMaxBlockHours && tailRatio < T.boughtTailMax) {
      bought ??= {
        id: "bought_spike",
        fired: true,
        strength: "strong",
        value: round(tailRatio, 3),
        threshold: `bloco ≤ ${T.spikeMaxBlockHours}h e cauda < ${pct(T.boughtTailMax)} do pico`,
        hours: [i, end],
        explanation: `entre as horas ${i} e ${end} as views saltaram ${ratio}× acima do normal e, logo depois, caíram para ${pct(tailRatio)} do pico: público humano não some de uma hora para outra depois de um pico`,
      };
    } else if (block <= T.spikeMaxBlockHours && tailRatio < T.ambiguousTailMax) {
      ambiguous ??= {
        id: "ambiguous_spike",
        fired: true,
        strength: "weak",
        value: round(tailRatio, 3),
        threshold: `cauda entre ${pct(T.boughtTailMax)} e ${pct(T.ambiguousTailMax)} do pico`,
        hours: [i, end],
        explanation: `pico de ${ratio}× nas horas ${i}–${end} caiu rápido (para ${pct(tailRatio)}), mas não o bastante para afirmar que foi comprado`,
      };
    }
    i = end;
  }
  return [
    bought ?? { id: "bought_spike", fired: false, strength: "strong", value: null, threshold: `bloco ≤ ${T.spikeMaxBlockHours}h e cauda < ${pct(T.boughtTailMax)} do pico`, hours: null, explanation: "nenhum pico que suba e despenque em poucas horas" },
    ambiguous ?? { id: "ambiguous_spike", fired: false, strength: "weak", value: null, threshold: `cauda entre ${pct(T.boughtTailMax)} e ${pct(T.ambiguousTailMax)} do pico`, hours: null, explanation: "nenhum pico de queda ambígua" },
  ];
}

/** Repetição mecânica: views quase idênticas hora após hora. */
function flatSignal(v: number[]): Signal {
  let best: { cv: number; at: number } | null = null;
  for (let i = 0; i + T.flatWindowHours <= v.length; i += 1) {
    const window = v.slice(i, i + T.flatWindowHours);
    const m = mean(window);
    if (m < T.flatMinMean) continue;
    const cv = Math.sqrt(mean(window.map((x) => (x - m) ** 2))) / m;
    if (!best || cv < best.cv) best = { cv, at: i };
  }
  const threshold = `variação < ${pct(T.flatMaxCv)} em ${T.flatWindowHours}h seguidas`;
  if (best && best.cv < T.flatMaxCv) {
    const end = best.at + T.flatWindowHours - 1;
    return {
      id: "mechanical_flat",
      fired: true,
      strength: "strong",
      value: round(best.cv, 4),
      threshold,
      hours: [best.at, end],
      explanation: `das horas ${best.at} a ${end} as views ficaram quase constantes (variação de ${round(best.cv * 100, 1)}%): audiência real oscila com a hora do dia; isso parece entrega automática`,
    };
  }
  return { id: "mechanical_flat", fired: false, strength: "strong", value: best ? round(best.cv, 4) : null, threshold, hours: null, explanation: "as views variam hora a hora como audiência real" };
}

/** Queda abrupta: um nível sustentado que some de uma hora para outra. */
function cliffSignal(v: number[]): Signal {
  const threshold = `nível ≥ ${T.cliffMinLevel} por 3h cai para ≤ ${pct(T.cliffMaxRatio)} e fica lá por 3h`;
  for (let i = 3; i + 2 < v.length; i += 1) {
    const before = v.slice(i - 3, i);
    if (Math.min(...before) < T.cliffMinLevel) continue;
    const level = mean(before);
    const after = v.slice(i, i + 3);
    if (Math.max(...after) <= T.cliffMaxRatio * level) {
      const ratio = mean(after) / level;
      return {
        id: "abrupt_cliff",
        fired: true,
        strength: "strong",
        value: round(ratio, 3),
        threshold,
        hours: [i - 3, i + 2],
        explanation: `na hora ${i} as views caíram de ~${Math.round(level)}/h para ~${Math.round(mean(after))}/h (${pct(ratio)}) e não voltaram: é o desenho de uma entrega comprada que terminou`,
      };
    }
  }
  return { id: "abrupt_cliff", fired: false, strength: "strong", value: null, threshold, hours: null, explanation: "nenhuma queda brusca de um nível sustentado" };
}

/**
 * Sem ciclo dia/noite em 48h ou mais. Cada hora é dividida pela mediana das 24h ao
 * redor dela (tira a tendência de estreia e de pico), e compara-se a mediana das
 * madrugadas (2h–6h) com a dos dias (12h–22h). Sozinho, não acusa: pode ser
 * público espalhado em fusos.
 */
function diurnalSignal(v: number[], startHour: number): Signal {
  const threshold = `madrugada ÷ dia ≥ ${pct(T.diurnalMaxNightDayRatio)} em ${T.diurnalMinHours}h+`;
  if (v.length < T.diurnalMinHours) {
    return { id: "no_day_night_cycle", fired: false, strength: "weak", value: null, threshold, hours: null, explanation: `série com menos de ${T.diurnalMinHours}h; ciclo dia/noite não avaliado` };
  }
  const night: number[] = [];
  const day: number[] = [];
  for (let i = 12; i + 12 <= v.length; i += 1) {
    const local = median(v.slice(i - 12, i + 12));
    if (local < 20) continue;
    const hour = (startHour + i) % 24;
    if (hour >= 2 && hour < 6) night.push(v[i]! / local);
    if (hour >= 12 && hour < 22) day.push(v[i]! / local);
  }
  if (!night.length || !day.length) {
    return { id: "no_day_night_cycle", fired: false, strength: "weak", value: null, threshold, hours: null, explanation: "volume baixo demais para medir o ciclo dia/noite" };
  }
  const ratio = median(night) / median(day);
  const fired = ratio >= T.diurnalMaxNightDayRatio;
  return {
    id: "no_day_night_cycle",
    fired,
    strength: "weak",
    value: round(ratio, 3),
    threshold,
    hours: null,
    explanation: fired
      ? `de madrugada (2h–6h) o post manteve ${pct(ratio)} do ritmo do dia: público humano costuma cair bem mais à noite`
      : `de madrugada o post caiu para ${pct(ratio)} do ritmo do dia, como esperado para público humano`,
  };
}

/** A queda logo depois de um pico já explicado é o próprio pico: não conta duas vezes. */
function cliffAfterSpikes(cliff: Signal, spikes: Signal[]): Signal {
  if (!cliff.fired || !cliff.hours) return cliff;
  const [from, to] = cliff.hours;
  const covered = spikes.some((spike) => spike.fired && spike.hours && spike.hours[0] <= to && spike.hours[1] >= from);
  return covered ? { ...cliff, fired: false, explanation: "a única queda brusca é o fim do pico já apontado acima" } : cliff;
}

/**
 * Decisão:
 * - série curta ou com poucas views: não acusa (inconclusive se algum sinal disparou, legit se nenhum);
 * - qualquer sinal forte: suspicious;
 * - só sinais fracos: inconclusive — o classificador prefere não acusar;
 * - nenhum sinal: legit.
 */
export function classify(input: SeriesInput): Classification {
  const v = input.hourly_views.map((x) => Math.max(0, Math.round(x)));
  const total = v.reduce((a, b) => a + b, 0);
  const peakViews = Math.max(0, ...v);
  const stats = { hours: v.length, total_views: total, peak_hour: v.indexOf(peakViews), peak_views: peakViews };

  if (v.length < T.minHours) {
    return { label: "inconclusive", reason: `série com ${v.length}h; são necessárias pelo menos ${T.minHours}h para ver ciclo e cauda`, signals: [], stats };
  }

  const spikes = spikeSignals(v);
  const signals = [...spikes, cliffAfterSpikes(cliffSignal(v), spikes), flatSignal(v), diurnalSignal(v, input.start_hour_local)];
  const strong = signals.filter((s) => s.fired && s.strength === "strong");
  const weak = signals.filter((s) => s.fired && s.strength === "weak");

  if (total < T.minTotalViews) {
    return strong.length || weak.length
      ? { label: "inconclusive", reason: `há padrão estranho (${[...strong, ...weak].map((s) => s.id).join(", ")}), mas com ${total} views no total o ruído é grande demais para acusar`, signals, stats }
      : { label: "legit", reason: "volume baixo e nenhum padrão incompatível com audiência humana", signals, stats };
  }
  if (strong.length) {
    return { label: "suspicious", reason: strong.map((s) => s.explanation).join("; ") + ".", signals, stats };
  }
  if (weak.length) {
    return {
      label: "inconclusive",
      reason: `${weak.map((s) => s.explanation).join("; ")}. Sozinho, isso não basta para acusar: pode ser público em vários fusos ou um repost que perdeu força.`,
      signals,
      stats,
    };
  }
  return { label: "legit", reason: "subida, ciclo dia/noite e queda compatíveis com audiência humana; nenhum sinal disparou", signals, stats };
}
