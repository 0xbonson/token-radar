// The radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is "what would this protocol's token be worth if it issued one
// tomorrow, given the record it has today". That is two numbers multiplied:
//
//   expected value = tvl x capture rate x launch odds
//
// The capture rate is what share of a protocol's TVL a token would ever turn into value: a lending
// market keeps a thin spread, a derivatives venue keeps a fat fee on turnover, and a bridge keeps
// almost none. It is set by the category the snapshot records, never by the protocol's name.
//
// The launch odds are how likely a token is at all: a protocol that has run for years without one
// has shown it can grow without a listing, but a protocol that is fresh and small has not yet
// proved anything. Age, seven-day growth and how many chains it spans all move that number.
//
// Every constant lives in MODEL below and is stated in the dashboard, so a reader can see exactly
// how the board was built and change any of it in the sandbox.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** The value a dollar of TVL is worth if a token does issue, before the odds. */
  tvl_value: number;
  /** The weight of the seven-day growth in the launch odds. */
  growth_weight: number;
  /** The growth at which the odds stop rising, in per cent. */
  growth_cap: number;
  /** The age at which the odds are at their highest, in days. */
  peak_age_days: number;
  /** The age spread of the odds' rise and fall, in days. */
  age_spread_days: number;
  /** The smallest odds any protocol gets. */
  odds_floor: number;
  /** The largest odds any protocol gets. */
  odds_cap: number;
  /** What each extra chain a protocol spans costs it, in per cent. */
  chain_drag_pct: number;
  /** The chains beyond which the drag stops. */
  chain_drag_after: number;
}

export const MODEL: ModelConstants = {
  tvl_value: 0.12,
  growth_weight: 0.55,
  growth_cap: 60,
  peak_age_days: 420,
  age_spread_days: 320,
  odds_floor: 0.04,
  odds_cap: 0.92,
  chain_drag_pct: 6,
  chain_drag_after: 2,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** The smallest implied value an early row may carry: below it, the row is noise. */
export const MIN_EARLY_VALUE = 25_000;

/** How many rows the board carries at most. */
export const MAX_ROWS = 400;

/**
 * What share of a protocol's TVL its token would be worth, by the category the snapshot records.
 *
 * The order of the list matters: the first entry that matches the category wins, so the specific
 * categories are named before the general ones.
 */
const CAPTURE: Array<[RegExp, number]> = [
  [/perpetual|derivative/i, 0.42],
  [/basis trading/i, 0.38],
  [/options/i, 0.34],
  [/prediction/i, 0.26],
  [/synthet/i, 0.24],
  [/liquidity manager/i, 0.22],
  [/lending|^cdp|collateral/i, 0.20],
  [/dex/i, 0.19],
  [/launchpad/i, 0.18],
  [/yield aggregator|allocator|curator/i, 0.16],
  [/yield/i, 0.14],
  [/rwa/i, 0.13],
  [/bridge/i, 0.10],
  [/staking|restak/i, 0.07],
  [/stablecoin|cefi|payments/i, 0.06],
  [/insurance/i, 0.06],
];

/** The capture rate of one protocol, from its category. */
export function captureRate(protocol: SnapshotProtocol): number {
  const category = protocol.category ?? '';
  for (const [pattern, rate] of CAPTURE) {
    if (pattern.test(category)) return rate;
  }
  return 0.09;
}

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
    tvl_value: number;
    capture_rate: number;
    launch_odds: number;
    growth_pct: number;
    age_days: number | null;
    chain_drag: number;
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
  capture_rate: number;
  launch_odds: number;
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
  model: ModelConstants;
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

/**
 * How likely a token is, from a protocol's own record.
 *
 * The shape is a bell in the protocol's age: a protocol that has just started has not proved
 * itself, one that has run a few years has proved it can grow without a listing, and one that has
 * run for a decade has had its chance and let it pass. Seven-day growth lifts the odds, because a
 * protocol that is growing now is one the market is watching.
 */
export function launchOdds(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const age = ageDays(asOf, protocol.listed_at);
  const ageDaysUsed = age ?? model.peak_age_days / 2;
  const offset = (ageDaysUsed - model.peak_age_days) / model.age_spread_days;
  const ageShape = Math.exp(-offset * offset);

  const growth = Math.min(model.growth_cap, Math.max(-model.growth_cap, finite(protocol.change_7d, 0)));
  const growthLift = 1 + (growth / 100) * model.growth_weight;

  const extraChains = Math.max(0, protocol.chains.length - model.chain_drag_after);
  const chainDrag = 1 - (extraChains * model.chain_drag_pct) / 100;

  const odds = ageShape * growthLift * chainDrag;
  return Math.min(model.odds_cap, Math.max(model.odds_floor, odds));
}

/** The implied value of one protocol: its TVL's value, its capture rate and its launch odds. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; capture: number; odds: number; age: number | null; chainDrag: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const capture = captureRate(protocol);
  const odds = launchOdds(protocol, asOf, model);
  const extraChains = Math.max(0, protocol.chains.length - model.chain_drag_after);
  const chainDrag = 1 - (extraChains * model.chain_drag_pct) / 100;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.tvl_value * capture * odds * chainDrag));
  return { implied, capture, odds, age, chainDrag };
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
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The watchlist is the floor: every slug it names is on the board, whatever its score. Below the
 * floor the radar looks for early protocols on its own, but only ones worth a reader's time: a
 * protocol whose implied value rounds to nothing is not a candidate, so it does not clutter the
 * board with rows that all read the same.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
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
    const { implied, capture, odds, age, chainDrag } = impliedValue(protocol, snapshot.as_of, model);
    return { protocol, implied, capture, odds, age, chainDrag };
  });

  // A watchlist row always stays; an early row stays only when it is worth something.
  const kept = scored.filter((entry) => watchlist.has(entry.protocol.slug) || entry.implied >= MIN_EARLY_VALUE);
  kept.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));

  return kept.slice(0, MAX_ROWS).map((entry, index) => ({
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
    age_days: entry.age,
    implied_value_usd: entry.implied,
    model: {
      tvl_value: model.tvl_value,
      capture_rate: round4(entry.capture),
      launch_odds: round4(entry.odds),
      growth_pct: entry.protocol.change_7d,
      age_days: entry.age,
      chain_drag: round4(entry.chainDrag),
    },
    farm_steps: farmSteps(entry.protocol, entry.age).map(stepText),
  }));
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
  return protocol.chains.length > 0 ? protocol.chains[0] : 'its main chain';
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
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(protocol: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(protocol);
  const capital = capitalFor(protocol);
  const hold = holdDaysFor(age);
  const gas = capital >= 250 ? 8 : capital >= 100 ? 5 : 3;
  const action = actionFor(protocol, capital, chain);

  return [
    {
      text: `Open a fresh wallet that holds only the money you plan to farm, and keep its seed phrase offline and out of the browser.`,
      cost: 'under $3 for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the protocol records activity from you.`,
      cost: 'about $2 of gas a week',
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
    capture_rate: row.model.capture_rate,
    launch_odds: row.model.launch_odds,
    on_watchlist: watchlist.includes(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
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
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
