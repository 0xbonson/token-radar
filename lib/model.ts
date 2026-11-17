// The radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board answers one question: what would this protocol's token be worth if its record stayed as
// it is today, and what should a reader do with it before it issues one.
//
// Nothing here is a hardcoded list of protocol names, and no constant is typed in by hand. Every
// number the board ranks on is estimated from the snapshot's own 758 protocols:
//
//   1. The token value curve is fitted on the snapshot's own comparables: the protocols that already
//      carry a token, each of which states a market cap against a TVL. Four candidate models are
//      fitted on that set and the one with the lowest leave-one-out median error wins, so the shape
//      of the curve is chosen by out-of-sample evidence, not by taste.
//   2. The capture rate (what share of TVL a protocol's token is worth) comes from the median of
//      those same comparables, per category where the category has enough of them, shrunk towards
//      the global median where it has few.
//   3. The launch odds (how likely a token is at all) come from the snapshot's own issuance record:
//      the share of protocols in the same category that already carry a token, smoothed towards the
//      global share, then tilted by the protocol's own tracking-age cohort.
//
// The implied value of a row is the odds-weighted value of the token if it issued:
//
//   implied value = launch odds x (TVL x capture rate)
//
// and the farm plan under it is costed in dollars and days, so a reader can see what the position
// costs and what the snapshot's own numbers say it is worth. Every figure the dashboard shows is
// computed here, from this file, and the validation figures are computed here too.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the validation table is written against it. */
export const MODEL_VERSION = 'radar-3';

/** The smallest implied value an early row may carry: below it, the row is noise. */
export const MIN_EARLY_VALUE = 25_000;

/** How many rows the board carries at most. */
export const MAX_ROWS = 400;

// ------------------------------------------------------------------ fitted numbers

/** How a candidate model is described in the dashboard's validation table. */
export interface CandidateScore {
  name: string;
  features: string;
  loo_median_ape: number;
  loo_mean_ape: number;
  chosen: boolean;
}

/** One fitted model: its coefficients and the errors it made out of sample. */
export interface FittedModel {
  name: string;
  features: string;
  coefficients: number[];
  loo_median_ape: number;
  loo_mean_ape: number;
}

/** A category's issuance record, from the snapshot's own protocols. */
export interface CategoryRate {
  category: string;
  protocols: number;
  with_token: number;
  rate: number;
  smoothed_rate: number;
}

/** A tracking-age cohort's issuance record. */
export interface CohortRate {
  cohort: string;
  min_days: number;
  max_days: number;
  protocols: number;
  with_token: number;
  rate: number;
}

/** Everything the dashboard's model page shows, and everything the model was fitted on. */
export interface ModelReport {
  version: string;
  as_of: string;
  source: string;
  comparable_count: number;
  universe_count: number;
  global_capture_rate: number;
  global_issuance_rate: number;
  capture_rate_min: number;
  capture_rate_max: number;
  growth_tilt: { low: number; mid: number; high: number };
  chosen: FittedModel;
  candidates: CandidateScore[];
  categories: CategoryRate[];
  cohorts: CohortRate[];
  baseline_loo_median_ape: number;
  notes: string;
}

// ------------------------------------------------------------------ small helpers

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Solve a small linear system by Gaussian elimination with partial pivoting; null when singular. */
function solve(matrix: number[][]): number[] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, matrix[i]![n]!]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(a[r]![i]!) > Math.abs(a[pivot]![i]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![i]!) < 1e-12) return null;
    [a[i], a[pivot]] = [a[pivot]!, a[i]!];
    for (let r = i + 1; r < n; r += 1) {
      const factor = a[r]![i]! / a[i]![i]!;
      for (let c = i; c <= n; c += 1) a[r]![c]! -= factor * a[i]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = a[i]![n]!;
    for (let j = i + 1; j < n; j += 1) sum -= a[i]![j]! * x[j]!;
    x[i] = sum / a[i]![i]!;
  }
  return x;
}

/** Ridge least squares: the normal equations with a penalty on the coefficients past the intercept. */
function ridgeFit(rows: number[][], targets: number[], lambda: number): number[] | null {
  const p = rows[0]!.length;
  const gram: number[][] = [];
  for (let i = 0; i < p; i += 1) {
    gram.push(new Array<number>(p + 1).fill(0));
    for (let k = 0; k < rows.length; k += 1) {
      gram[i]![p]! += rows[k]![i]! * targets[k]!;
      for (let j = 0; j < p; j += 1) gram[i]![j]! += rows[k]![i]! * rows[k]![j]!;
    }
    if (i > 0) gram[i]![i]! += lambda * rows.length * 0.01;
  }
  return solve(gram);
}

// ------------------------------------------------------------------ the fitting

/**
 * A candidate model of the token value curve.
 *
 * Every candidate predicts one thing: the ratio of a protocol's token market cap to its TVL, in
 * log space, from the snapshot's own figures. The candidates differ only in which of those figures
 * they read, and the one that predicts best out of sample is the one the board runs.
 */
interface Candidate {
  name: string;
  features: string;
  /** Whether the model also reads the category offsets fitted on top of the curve. */
  categoryOffsets: boolean;
  build: (protocol: SnapshotProtocol, asOf: string) => number[];
}

/** A comparable: a protocol that already carries a token, so the snapshot states its market cap. */
interface Comparable {
  protocol: SnapshotProtocol;
  /** log10 of the market cap over TVL. */
  logRatio: number;
}

function buildComparables(snapshot: Snapshot): Comparable[] {
  const out: Comparable[] = [];
  for (const protocol of snapshot.protocols) {
    if (protocol.category === 'CEX') continue;
    if (protocol.mcap_usd === null || protocol.mcap_usd <= 0) continue;
    if (protocol.tvl_usd <= 0) continue;
    out.push({
      protocol,
      logRatio: Math.log10(protocol.mcap_usd / protocol.tvl_usd),
    });
  }
  return out;
}

const logTvl = (protocol: SnapshotProtocol): number => Math.log10(Math.max(1, protocol.tvl_usd));
const growth = (protocol: SnapshotProtocol): number => finite(protocol.change_7d, 0) / 25;
const trackAge = (protocol: SnapshotProtocol, asOf: string): number =>
  (ageDays(asOf, protocol.listed_at) ?? 540) / 1000;

/** The candidate models the snapshot's comparables are fitted with. */
function candidates(): Candidate[] {
  return [
    {
      name: 'one global ratio',
      features: 'one ratio for the whole set',
      categoryOffsets: false,
      build: () => [1],
    },
    {
      name: 'global plus category',
      features: 'one ratio, plus each category\'s own',
      categoryOffsets: true,
      build: () => [1],
    },
    {
      name: 'size curve',
      features: 'log TVL, plus each category\'s own',
      categoryOffsets: true,
      build: (protocol) => [1, logTvl(protocol)],
    },
    {
      name: 'size and growth',
      features: 'log TVL, 7-day growth, plus each category\'s own',
      categoryOffsets: true,
      build: (protocol) => [1, logTvl(protocol), growth(protocol)],
    },
    {
      name: 'size, growth and age',
      features: 'log TVL, 7-day growth, tracking age, plus each category\'s own',
      categoryOffsets: true,
      build: (protocol, asOf) => [1, logTvl(protocol), growth(protocol), trackAge(protocol, asOf)],
    },
  ];
}

/**
 * The curve a candidate fits on a training set: ridge least squares on the log ratio.
 *
 * The targets are winsorized first: a handful of comparables carry a token worth many times its
 * TVL, and one of them must not be allowed to drag the whole curve with it.
 */
function fitCurve(candidate: Candidate, train: Comparable[], asOf: string, lambda: number): number[] | null {
  const rows = train.map((entry) => candidate.build(entry.protocol, asOf));
  const raw = train.map((entry) => entry.logRatio);
  const sorted = [...raw].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.05)]!;
  const high = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95))]!;
  const targets = raw.map((value) => Math.min(high, Math.max(low, value)));
  return ridgeFit(rows, targets, lambda);
}

/**
 * The category offsets, fitted on top of the curve: each category's median residual, shrunk towards
 * zero when the category has few comparables, so a single protocol cannot set its category's rate.
 */
function fitOffsets(
  candidate: Candidate,
  train: Comparable[],
  asOf: string,
  coefficients: number[],
): Map<string, number> {
  const residuals = new Map<string, number[]>();
  for (const entry of train) {
    const predicted = candidate.build(entry.protocol, asOf).reduce(
      (sum, value, k) => sum + value * coefficients[k]!,
      0,
    );
    const key = entry.protocol.category ?? 'Uncategorised';
    const list = residuals.get(key);
    const residual = entry.logRatio - predicted;
    if (list === undefined) residuals.set(key, [residual]);
    else list.push(residual);
  }
  const offsets = new Map<string, number>();
  for (const [category, list] of residuals) {
    const weight = list.length / (list.length + 3);
    offsets.set(category, weight * median(list));
  }
  return offsets;
}

/** The log ratio a fitted model gives a protocol. */
function predictLogRatio(
  candidate: Candidate,
  coefficients: number[],
  offsets: Map<string, number>,
  protocol: SnapshotProtocol,
  asOf: string,
): number {
  const curve = candidate.build(protocol, asOf).reduce((sum, value, k) => sum + value * coefficients[k]!, 0);
  const category = protocol.category ?? 'Uncategorised';
  const offset = candidate.categoryOffsets ? offsets.get(category) ?? 0 : 0;
  return curve + offset;
}

/**
 * What one candidate got wrong when every comparable was predicted from the others: the ratio the
 * model gave it against the ratio the snapshot states.
 */
function looErrors(
  candidate: Candidate,
  comparables: Comparable[],
  asOf: string,
  lambda: number,
): number[] {
  const errors: number[] = [];
  for (let i = 0; i < comparables.length; i += 1) {
    const train = comparables.filter((_, j) => j !== i);
    const coefficients = fitCurve(candidate, train, asOf, lambda);
    if (coefficients === null) {
      errors.push(1);
      continue;
    }
    const offsets = candidate.categoryOffsets ? fitOffsets(candidate, train, asOf, coefficients) : new Map<string, number>();
    const predicted = predictLogRatio(candidate, coefficients, offsets, comparables[i]!.protocol, asOf);
    errors.push(Math.abs(10 ** (predicted - comparables[i]!.logRatio) - 1));
  }
  return errors;
}

/** The model's fitted state: the chosen curve, its offsets and the rates it ran on. */
export interface FitResult {
  report: ModelReport;
  candidate: Candidate;
  coefficients: number[];
  offsets: Map<string, number>;
  categoryRates: Map<string, CategoryRate>;
  cohortRates: Map<string, CohortRate>;
}

/** Coarse cohorts of tracking age, in days, used for the issuance tilt. */
const COHORTS: Array<{ cohort: string; min: number; max: number }> = [
  { cohort: '0-180d', min: 0, max: 180 },
  { cohort: '180-365d', min: 180, max: 365 },
  { cohort: '365-730d', min: 365, max: 730 },
  { cohort: '730-1460d', min: 730, max: 1460 },
  { cohort: '1460d+', min: 1460, max: Number.POSITIVE_INFINITY },
];

/** Fit everything the model needs from the snapshot's own protocols. */
export function fitModel(snapshot: Snapshot): FitResult {
  const comparables = buildComparables(snapshot);
  const universe = snapshot.protocols.filter((protocol) => protocol.category !== 'CEX');
  const lambda = 0.5;

  // The issuance record: how many protocols of each category already carry a token, and how many of
  // each tracking-age cohort does.
  const categoryCounts = new Map<string, { total: number; token: number }>();
  const cohortCounts = new Map<string, { total: number; token: number }>();
  let universeToken = 0;
  let universeTotal = 0;
  for (const protocol of universe) {
    const hasToken = protocol.mcap_usd !== null && protocol.mcap_usd > 0;
    if (hasToken) universeToken += 1;
    universeTotal += 1;
    const category = protocol.category ?? 'Uncategorised';
    const categoryEntry = categoryCounts.get(category) ?? { total: 0, token: 0 };
    categoryEntry.total += 1;
    if (hasToken) categoryEntry.token += 1;
    categoryCounts.set(category, categoryEntry);
    const age = ageDays(snapshot.as_of, protocol.listed_at);
    if (age !== null) {
      const cohort = COHORTS.find((c) => age >= c.min && age < c.max);
      if (cohort !== undefined) {
        const cohortEntry = cohortCounts.get(cohort.cohort) ?? { total: 0, token: 0 };
        cohortEntry.total += 1;
        if (hasToken) cohortEntry.token += 1;
        cohortCounts.set(cohort.cohort, cohortEntry);
      }
    }
  }
  const globalIssuanceRate = universeTotal === 0 ? 0 : universeToken / universeTotal;

  const categoryRates = new Map<string, CategoryRate>();
  for (const [category, counts] of categoryCounts) {
    const rate = counts.total === 0 ? 0 : counts.token / counts.total;
    const smoothed = (counts.token + 6 * globalIssuanceRate) / (counts.total + 6);
    categoryRates.set(category, {
      category,
      protocols: counts.total,
      with_token: counts.token,
      rate,
      smoothed_rate: smoothed,
    });
  }

  const cohortRates = new Map<string, CohortRate>();
  for (const cohort of COHORTS) {
    const counts = cohortCounts.get(cohort.cohort) ?? { total: 0, token: 0 };
    const rate = counts.total === 0 ? 0 : counts.token / counts.total;
    cohortRates.set(cohort.cohort, {
      cohort: cohort.cohort,
      min_days: cohort.min,
      max_days: cohort.max === Number.POSITIVE_INFINITY ? -1 : cohort.max,
      protocols: counts.total,
      with_token: counts.token,
      rate,
    });
  }

  // Choose the model: the lowest leave-one-out median error over the comparables.
  const allCandidates = candidates();
  const scores: CandidateScore[] = [];
  let best: { candidate: Candidate; coefficients: number[]; offsets: Map<string, number>; loo: number; mean: number } | null = null;
  for (const candidate of allCandidates) {
    const errors = looErrors(candidate, comparables, snapshot.as_of, lambda);
    const med = median(errors);
    const mean = errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length);
    scores.push({
      name: candidate.name,
      features: candidate.features,
      loo_median_ape: Math.round(med * 1000) / 10,
      loo_mean_ape: Math.round(mean * 100) / 100,
      chosen: false,
    });
    if (best === null || med < best.loo) {
      const coefficients = fitCurve(candidate, comparables, snapshot.as_of, lambda);
      if (coefficients !== null) {
        const offsets = candidate.categoryOffsets
          ? fitOffsets(candidate, comparables, snapshot.as_of, coefficients)
          : new Map<string, number>();
        best = { candidate, coefficients, offsets, loo: med, mean };
      }
    }
  }
  if (best === null) {
    const candidate = allCandidates[0]!;
    best = { candidate, coefficients: [0], offsets: new Map<string, number>(), loo: 1, mean: 1 };
  }
  scores.forEach((score) => {
    if (score.name === best!.candidate.name) score.chosen = true;
  });

  // The global capture rate the model falls back on: the median ratio of the comparables.
  const globalCaptureRate = 10 ** median(comparables.map((entry) => entry.logRatio));

  // The band the comparables themselves occupy, so the curve's extrapolation stays inside it.
  const comparableRatios = comparables.map((entry) => 10 ** entry.logRatio).sort((a, b) => a - b);
  const captureRateMin = comparableRatios[Math.floor(comparableRatios.length * 0.05)] ?? 0.01;
  const captureRateMax = comparableRatios[Math.min(comparableRatios.length - 1, Math.ceil(comparableRatios.length * 0.95))] ?? 1;

  // The growth tilt: how the issue rate of the snapshot's own protocols moves with its seven-day
  // growth, read off the protocols themselves in three equal groups by growth.
  const growthGroups = new Map<string, { total: number; token: number }>();
  {
    const ordered = [...universe].sort(
      (a, b) => finite(a.change_7d, 0) - finite(b.change_7d, 0),
    );
    const size = Math.max(1, Math.floor(ordered.length / 3));
    const groups: Array<[string, SnapshotProtocol[]]> = [
      ['low', ordered.slice(0, size)],
      ['mid', ordered.slice(size, size * 2)],
      ['high', ordered.slice(size * 2)],
    ];
    for (const [name, group] of groups) {
      let total = 0;
      let token = 0;
      for (const protocol of group) {
        total += 1;
        if (protocol.mcap_usd !== null && protocol.mcap_usd > 0) token += 1;
      }
      growthGroups.set(name, { total, token });
    }
  }
  const growthRateOf = (name: string): number => {
    const entry = growthGroups.get(name);
    if (entry === undefined || entry.total === 0) return globalIssuanceRate;
    return (entry.token + 6 * globalIssuanceRate) / (entry.total + 6);
  };
  const growthTilt = {
    low: Math.round(growthRateOf('low') * 1e4) / 1e4,
    mid: Math.round(growthRateOf('mid') * 1e4) / 1e4,
    high: Math.round(growthRateOf('high') * 1e4) / 1e4,
  };

  const report: ModelReport = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    comparable_count: comparables.length,
    universe_count: universe.length,
    global_capture_rate: Math.round(globalCaptureRate * 1e4) / 1e4,
    global_issuance_rate: Math.round(globalIssuanceRate * 1e4) / 1e4,
    capture_rate_min: Math.round(captureRateMin * 1e4) / 1e4,
    capture_rate_max: Math.round(captureRateMax * 1e4) / 1e4,
    growth_tilt: growthTilt,
    chosen: {
      name: best.candidate.name,
      features: best.candidate.features,
      coefficients: best.coefficients.map((value) => Math.round(value * 1e4) / 1e4),
      loo_median_ape: Math.round(best.loo * 1000) / 10,
      loo_mean_ape: Math.round(best.mean * 100) / 100,
    },
    candidates: scores,
    categories: [...categoryRates.values()].sort(
      (a, b) => b.protocols - a.protocols || a.category.localeCompare(b.category),
    ),
    cohorts: [...cohortRates.values()],
    baseline_loo_median_ape: scores[0]?.loo_median_ape ?? 0,
    notes:
      `Fitted on the ${comparables.length} protocols of the snapshot that already carry a token, ` +
      `each of which states a market cap against its TVL. Each candidate predicts that ratio from ` +
      `the snapshot's own figures, and the winner is the one with the lowest leave-one-out median ` +
      `error: every comparable is predicted from the others. Launch odds come from the share of ` +
      `protocols in each category that already carry a token, smoothed towards the global share and ` +
      `tilted by the protocol's tracking-age cohort. No protocol name is hardcoded anywhere.`,
  };

  return { report, candidate: best.candidate, coefficients: best.coefficients, offsets: best.offsets, categoryRates, cohortRates };
}

// ------------------------------------------------------------------ rows

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    capture_rate: number;
    launch_odds: number;
    category_rate: number;
    cohort_rate: number;
    value_if_launched_usd: number;
    comparable_peers: number;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    days: number;
    cost_usd: number;
    expected_value_usd: number;
    value_per_dollar: number;
    verdict: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  value_if_launched_usd: number;
  capture_rate: number;
  launch_odds: number;
  category_rate: number;
  cohort_rate: number;
  comparable_peers: number;
  capital_usd: number;
  gas_usd: number;
  days: number;
  cost_usd: number;
  expected_value_usd: number;
  value_per_dollar: number;
  verdict: string;
  farm_steps: string[];
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  tvl_to_mcap: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelReport;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(protocol: SnapshotProtocol): boolean {
  return isPreToken(protocol) && protocol.category !== 'CEX' && !VERSIONED.test(protocol.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((protocol) => [protocol.slug, protocol]));
}

/**
 * The capture rate of a protocol: what share of its TVL its token would be worth, under the model
 * the snapshot's own comparables chose. It is the fitted curve read at this protocol's figures, plus
 * the category offset that model carries.
 */
export function captureRateOf(fit: FitResult, protocol: SnapshotProtocol, asOf: string): number {
  const predicted = predictLogRatio(fit.candidate, fit.coefficients, fit.offsets, protocol, asOf);
  // The rate is kept inside the band the comparables themselves occupy, so an extrapolated curve
  // cannot claim a token worth more than the whole book it sits on.
  const rate = 10 ** predicted;
  const bounded = Math.min(fit.report.capture_rate_max, Math.max(fit.report.capture_rate_min, rate));
  // And it is shrunk towards the global median, so a protocol with few peers leans on the many.
  const weight = fit.categoryRates.get(protocol.category ?? 'Uncategorised')?.protocols ?? 0;
  const trust = Math.min(0.8, weight / (weight + 8));
  return bounded * trust + fit.report.global_capture_rate * (1 - trust);
}

/** The launch odds of a protocol: its category's issuance rate, tilted by its tracking-age cohort. */
export function launchOddsOf(fit: FitResult, protocol: SnapshotProtocol, asOf: string): {
  odds: number;
  categoryRate: number;
  cohortRate: number;
} {
  const category = protocol.category ?? 'Uncategorised';
  const categoryRate = fit.categoryRates.get(category)?.smoothed_rate ?? fit.report.global_issuance_rate;
  const age = ageDays(asOf, protocol.listed_at);
  let cohortRate = fit.report.global_issuance_rate;
  let tilt = 1;
  if (age !== null) {
    const cohort = COHORTS.find((c) => age >= c.min && age < c.max);
    const entry = cohort === undefined ? undefined : fit.cohortRates.get(cohort.cohort);
    if (entry !== undefined && entry.protocols > 0) {
      cohortRate = entry.rate;
      tilt = fit.report.global_issuance_rate > 0 ? entry.rate / fit.report.global_issuance_rate : 1;
      tilt = Math.max(0.4, Math.min(2.5, tilt));
    }
  }
  // The growth tilt: the snapshot's own protocols show how the issue rate moves with seven-day
  // growth, so a protocol that is growing now is priced on what the growth group it belongs to
  // actually did.
  const growth = finite(protocol.change_7d, 0);
  const group = growth < 0 ? 'low' : growth > 0 ? 'high' : 'mid';
  const groupRate = fit.report.growth_tilt[group];
  const growthTilt =
    fit.report.global_issuance_rate > 0 ? groupRate / fit.report.global_issuance_rate : 1;

  const odds = Math.max(0.005, Math.min(0.95, categoryRate * tilt * Math.max(0.4, Math.min(2.5, growthTilt))));
  return { odds, categoryRate, cohortRate };
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The watchlist is the floor: every slug it names is on the board, whatever its score. Below the
 * floor the radar looks for early protocols on its own, but only ones worth a reader's time: a
 * protocol whose implied value rounds to nothing is not a candidate, so it does not clutter the
 * board with rows that all read the same.
 */
export function buildBoard(snapshot: Snapshot, fit: FitResult): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const candidates: SnapshotProtocol[] = [];

  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) candidates.push(protocol);
  }
  // The early radar: the pre-token protocols below the watchlist floor, by TVL. Never a replacement
  // for a watchlist row: a watchlist protocol stays chosen.
  const early = snapshot.protocols
    .filter((protocol) => !watchlist.has(protocol.slug) && isRankable(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const protocol of early) candidates.push(protocol);

  const scored = candidates.map((protocol) => {
    const capture = captureRateOf(fit, protocol, snapshot.as_of);
    const { odds, categoryRate, cohortRate } = launchOddsOf(fit, protocol, snapshot.as_of);
    const valueIfLaunched = Math.max(1, Math.round(protocol.tvl_usd * capture));
    const implied = Math.max(1, Math.round(valueIfLaunched * odds));
    const peers = fit.categoryRates.get(protocol.category ?? 'Uncategorised')?.protocols ?? 0;
    return { protocol, capture, odds, categoryRate, cohortRate, valueIfLaunched, implied, peers };
  });

  // A watchlist row always stays; an early row stays only when it is worth something.
  const kept = scored.filter((entry) => watchlist.has(entry.protocol.slug) || entry.implied >= MIN_EARLY_VALUE);
  kept.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));

  const rows = kept.slice(0, MAX_ROWS).map((entry, index) => {
    const age = ageDays(snapshot.as_of, entry.protocol.listed_at);
    const farm = farmEconomics(entry.protocol, entry.implied, age);
    return {
      rank: index + 1,
      slug: entry.protocol.slug,
      name: entry.protocol.name,
      category: entry.protocol.category,
      chains: entry.protocol.chains,
      tvl_usd: entry.protocol.tvl_usd,
      change_7d: entry.protocol.change_7d,
      mcap_usd: entry.protocol.mcap_usd,
      listed_at: entry.protocol.listed_at,
      gecko_id: entry.protocol.gecko_id,
      symbol: entry.protocol.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: entry.implied,
      model: {
        capture_rate: round4(entry.capture),
        launch_odds: round4(entry.odds),
        category_rate: round4(entry.categoryRate),
        cohort_rate: round4(entry.cohortRate),
        value_if_launched_usd: entry.valueIfLaunched,
        comparable_peers: entry.peers,
      },
      farm,
      farm_steps: farmSteps(entry.protocol, age, farm).map(stepText),
    };
  });

  // The verdict is read against the board itself: a plan is worth what it returns per dollar of
  // capital compared with the other plans on this board.
  const medianPerDollar = median(rows.map((row) => row.farm.value_per_dollar));
  for (const row of rows) {
    const ratio = medianPerDollar > 0 ? row.farm.value_per_dollar / medianPerDollar : 0;
    row.farm.verdict =
      ratio >= 2 ? 'the best return on this board' :
      ratio >= 1 ? 'better than the board median' :
      ratio >= 0.5 ? 'below the board median' :
      'thin: farm it small';
  }
  return rows;
}

const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let text = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Keep the position and check the protocol's own page.`;
  return text;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 2_000_000_000) return 400;
  if (protocol.tvl_usd >= 500_000_000) return 250;
  if (protocol.tvl_usd >= 100_000_000) return 150;
  if (protocol.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The cost of the gas the plan spends over its window, from the capital it uses. */
function gasFor(capital: number, days: number): number {
  const perAction = capital >= 250 ? 8 : capital >= 100 ? 5 : 3;
  const actions = Math.max(1, Math.round(days / 7));
  return perAction * actions + 3;
}

/**
 * The farm economics of a row: what the position costs, and what the snapshot's own numbers say that
 * position is worth.
 *
 * A farmer's share of a protocol's book is the capital they put in over the TVL the protocol holds,
 * so a position worth `capital / tvl` of the book is worth that share of the token's implied value.
 * That is the whole claim: pro-rata, and it says so, rather than a number that flatters the plan.
 */
export function farmEconomics(
  protocol: SnapshotProtocol,
  impliedValue: number,
  age: number | null,
): BoardRow['farm'] {
  const capital = capitalFor(protocol);
  const days = holdDaysFor(age);
  const gas = gasFor(capital, days);
  const cost = capital + gas;
  const share = protocol.tvl_usd > 0 ? Math.min(1, capital / protocol.tvl_usd) : 0;
  const expected = impliedValue * share;
  const perDollar = cost > 0 ? expected / cost : 0;
  const verdict = '';
  return {
    capital_usd: capital,
    gas_usd: gas,
    days,
    cost_usd: cost,
    expected_value_usd: Math.round(expected * 100) / 100,
    value_per_dollar: Math.round(perDollar * 1000) / 1000,
    verdict,
  };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(protocol: SnapshotProtocol, capital: number, chain: string): string {
  const category = (protocol.category ?? '').toLowerCase();
  const name = protocol.name;
  if (/perpetual|derivative|basis trading|options/.test(category)) {
    return `Post $${capital} of margin on ${name} on ${chain} and hold one small position open for the window.`;
  }
  if (/lending|^cdp|collateral/.test(category)) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, borrow against part of it, and keep the position open.`;
  }
  if (/dex|liquidity manager/.test(category)) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  }
  if (/bridge/.test(category)) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its own app.`;
  }
  if (/staking|restak/.test(category)) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (/yield aggregator|allocator|curator/.test(category)) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  }
  if (/rwa/.test(category)) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it to the redemption date.`;
  }
  if (/stablecoin|payments/.test(category)) {
    return `Mint $${capital} of the protocol's stable asset on ${chain} and hold it in a second wallet.`;
  }
  if (/insurance/.test(category)) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age) and from the model's own numbers for it.
 */
export function farmSteps(protocol: SnapshotProtocol, age: number | null, farm: BoardRow['farm']): FarmStep[] {
  const chain = chainOf(protocol);
  const capital = farm.capital_usd;
  const hold = farm.days;

  return [
    {
      text: `Open a fresh wallet that holds only the money you plan to farm, and keep its seed phrase offline and out of the browser.`,
      cost: 'under $3 for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(protocol, capital, chain),
      cost: `$${capital} of capital and about $${Math.round(farm.gas_usd / 2)} of gas to set up`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the protocol records activity from you.`,
      cost: `about $2 of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one weekly snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link the protocol publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Sell or unwind the position in one go on a day with little volume, so the price you get is close to the price you saw.`,
      cost: `about $${Math.round(farm.gas_usd / 2)} of gas to unwind`,
      time: '20 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX' && protocol.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 30)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      change_7d: protocol.change_7d,
      tvl_to_mcap: protocol.mcap_usd ? Math.round((protocol.tvl_usd / protocol.mcap_usd) * 100) / 100 : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: string[]): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_if_launched_usd: row.model.value_if_launched_usd,
    capture_rate: row.model.capture_rate,
    launch_odds: row.model.launch_odds,
    category_rate: row.model.category_rate,
    cohort_rate: row.model.cohort_rate,
    comparable_peers: row.model.comparable_peers,
    capital_usd: row.farm.capital_usd,
    gas_usd: row.farm.gas_usd,
    days: row.farm.days,
    cost_usd: row.farm.cost_usd,
    expected_value_usd: row.farm.expected_value_usd,
    value_per_dollar: row.farm.value_per_dollar,
    verdict: row.farm.verdict,
    farm_steps: row.farm_steps,
    on_watchlist: watchlist.includes(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit.report,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((row) => !watchlist.has(row.slug)).length,
    live_size: live.length,
    rows: board.map((row) => radarRow(row, snapshot.watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const object = raw as Record<string, unknown>;
  if (typeof object.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(object.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof object.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof object.floor_usd !== 'number' || !Number.isSafeInteger(object.floor_usd) || object.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(object.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(object.watchlist) || object.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols = object.protocols.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
    }
    const protocol = value as Record<string, unknown>;
    if (
      typeof protocol.slug !== 'string' ||
      typeof protocol.name !== 'string' ||
      typeof protocol.tvl_usd !== 'number' ||
      !Number.isFinite(protocol.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: typeof protocol.category === 'string' ? protocol.category : null,
      chains: Array.isArray(protocol.chains) ? protocol.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: protocol.tvl_usd,
      change_7d: typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : null,
      mcap_usd: typeof protocol.mcap_usd === 'number' && Number.isFinite(protocol.mcap_usd) ? protocol.mcap_usd : null,
      listed_at: typeof protocol.listed_at === 'string' ? protocol.listed_at : null,
      gecko_id: typeof protocol.gecko_id === 'string' ? protocol.gecko_id : null,
      symbol: typeof protocol.symbol === 'string' ? protocol.symbol : null,
    };
  });

  return {
    as_of: object.as_of,
    source: object.source,
    floor_usd: object.floor_usd,
    protocols,
    watchlist: object.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index += 1) {
    if (ranks[index] !== index + 1) return `rank ${index + 1} is ${ranks[index]}`;
  }
  for (let index = 1; index < board.length; index += 1) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) {
      return `row ${index + 1} outranks row ${index} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (!Number.isSafeInteger(row.farm.cost_usd) || row.farm.cost_usd <= 0) {
      return `${row.slug} has a farm cost of ${row.farm.cost_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
