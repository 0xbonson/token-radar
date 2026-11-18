// The radar's scoring model: evaluates pre-token DeFi protocols from raw snapshot figures.
// Runs natively in the browser and in Node.js with zero external dependencies.
// SPDX-License-Identifier: MIT

const DAY_MS = 86400000;

/**
 * Operating age of a protocol in days.
 * Reads: snapshot date `asOf` (YYYY-MM-DD) and protocol `listed_at` (YYYY-MM-DD).
 */
function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Historical token issuance rate for tracking-age cohorts.
 * Reads: protocol tracking age in days mapped into the snapshot's 5 age cohorts.
 */
function cohortLaunchRate(age, stats) {
  if (age === null || !stats || !stats.cohorts) return stats ? stats.global_issuance_rate : 0.1695;
  const cohort = stats.cohorts.find(function (c) {
    const min = c.min_days !== undefined ? c.min_days : c.min;
    const max = c.max_days !== undefined ? c.max_days : (c.max === undefined ? -1 : c.max);
    return age >= min && (max === -1 || max === Infinity || age < max);
  });
  return cohort && cohort.protocols > 0 ? cohort.rate : stats.global_issuance_rate;
}

/**
 * Historical token issuance rate for protocol category, smoothed towards the global rate.
 * Reads: protocol DefiLlama `category` from snapshot.
 */
function categoryLaunchRate(category, stats) {
  if (!stats) return 0.1695;
  const key = category || 'Uncategorised';
  const entry = stats.category_rates_map ? stats.category_rates_map[key] : null;
  if (entry && entry.smoothed_rate !== undefined) return entry.smoothed_rate;
  if (stats.categories) {
    const found = stats.categories.find(function (c) { return c.category === key; });
    if (found && found.smoothed_rate !== undefined) return found.smoothed_rate;
  }
  return stats.global_issuance_rate || 0.1695;
}

/**
 * Issuance rate tilt across 7-day TVL change terciles (low / mid / high).
 * Reads: protocol `change_7d` percentage growth figure from snapshot.
 */
function growthTiltOf(change7d, stats) {
  const g = typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0;
  const group = g < 0 ? 'low' : g > 0 ? 'high' : 'mid';
  if (stats && stats.growth_tilt && stats.growth_tilt[group] !== undefined) {
    const rate = stats.growth_tilt[group];
    const globalRate = stats.global_issuance_rate || 0.1695;
    return globalRate > 0 ? rate / globalRate : 1;
  }
  return 1;
}

/**
 * Launch odds: how likely the protocol is to issue a token.
 * Reads: protocol `category`, `listed_at` (age), and `change_7d` (growth).
 */
function launchOddsOf(protocol, stats, asOf) {
  const categoryRate = categoryLaunchRate(protocol.category, stats);
  const age = ageDays(asOf, protocol.listed_at);
  const cohortRate = cohortLaunchRate(age, stats);
  const globalRate = stats && stats.global_issuance_rate ? stats.global_issuance_rate : 0.1695;
  let cohortTilt = 1;
  if (age !== null && globalRate > 0) {
    cohortTilt = Math.max(0.4, Math.min(2.5, cohortRate / globalRate));
  }
  const growthTilt = Math.max(0.4, Math.min(2.5, growthTiltOf(protocol.change_7d, stats)));
  const odds = Math.max(0.005, Math.min(0.95, categoryRate * cohortTilt * growthTilt));
  return {
    odds: Math.round(odds * 1e4) / 1e4,
    categoryRate: Math.round(categoryRate * 1e4) / 1e4,
    cohortRate: Math.round(cohortRate * 1e4) / 1e4,
  };
}

/**
 * Category-specific capture rate offset fitted on comparable protocols.
 * Reads: protocol DefiLlama `category` from snapshot.
 */
function categoryCaptureRate(category, stats) {
  if (!stats || !stats.category_offsets) return 0;
  const key = category || 'Uncategorised';
  return stats.category_offsets[key] || 0;
}

/**
 * Capture rate: what share of TVL the token would be worth if issued.
 * Reads: protocol `tvl_usd`, `change_7d`, `listed_at` (age), and `category`.
 */
function captureRateOf(protocol, stats, asOf) {
  const logTvl = Math.log10(Math.max(1, protocol.tvl_usd || 1));
  const g = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growth = g / 25;
  const age = ageDays(asOf, protocol.listed_at);
  const trackAge = (age !== null ? age : 540) / 1000;
  const coeffs = stats && stats.coefficients ? stats.coefficients : [3.01459, -0.46817, -0.08012, -0.11999];
  const curve = coeffs[0] + coeffs[1] * logTvl + coeffs[2] * growth + coeffs[3] * trackAge;
  const offset = categoryCaptureRate(protocol.category, stats);
  const rate = Math.pow(10, curve + offset);
  const minBound = stats && stats.capture_rate_min !== undefined ? stats.capture_rate_min : 0.0059;
  const maxBound = stats && stats.capture_rate_max !== undefined ? stats.capture_rate_max : 14.5468;
  const bounded = Math.min(maxBound, Math.max(minBound, rate));
  const key = protocol.category || 'Uncategorised';
  const entry = stats && stats.category_rates_map ? stats.category_rates_map[key] : null;
  const peers = entry ? entry.protocols : (stats && stats.categories ? (stats.categories.find(function (c) { return c.category === key; }) || {}).protocols || 0 : 0);
  const trust = Math.min(0.8, peers / (peers + 8));
  const globalCap = stats && stats.global_capture_rate !== undefined ? stats.global_capture_rate : 0.246;
  const finalRate = bounded * trust + globalCap * (1 - trust);
  return Math.round(finalRate * 1e4) / 1e4;
}

/**
 * Implied value of the pre-token protocol.
 * Reads: protocol `tvl_usd` multiplied by capture rate and launch odds.
 */
function impliedValueOf(protocol, stats, asOf) {
  const capture = captureRateOf(protocol, stats, asOf);
  const oddsResult = launchOddsOf(protocol, stats, asOf);
  const valueIfLaunched = Math.max(1, Math.round((protocol.tvl_usd || 0) * capture));
  const implied = Math.max(1, Math.round(valueIfLaunched * oddsResult.odds));
  return {
    impliedValue: implied,
    valueIfLaunched: valueIfLaunched,
    capture: capture,
    odds: oddsResult.odds,
    categoryRate: oddsResult.categoryRate,
    cohortRate: oddsResult.cohortRate,
  };
}

/**
 * Capital required for farming position, staged by protocol TVL.
 * Reads: protocol `tvl_usd`.
 */
function capitalFor(protocol) {
  const tvl = protocol.tvl_usd || 0;
  if (tvl >= 2000000000) return 400;
  if (tvl >= 500000000) return 250;
  if (tvl >= 100000000) return 150;
  if (tvl >= 50000000) return 100;
  return 50;
}

/**
 * Farming hold duration in days, staged by protocol age.
 * Reads: protocol tracking age in days.
 */
function holdDaysFor(age) {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Estimated gas cost over farming window.
 * Reads: allocated capital and planned hold duration.
 */
function gasFor(capital, days) {
  const perAction = capital >= 250 ? 8 : capital >= 100 ? 5 : 3;
  const actions = Math.max(1, Math.round(days / 7));
  return perAction * actions + 3;
}

/**
 * Primary network chain for interaction.
 * Reads: protocol `chains` array.
 */
function chainOf(protocol) {
  return protocol.chains && protocol.chains.length > 0 ? protocol.chains[0] : 'its main chain';
}

/**
 * Tailored DeFi action description.
 * Reads: protocol `category`, `name`, and primary `chain`.
 */
function actionFor(protocol, capital, chain) {
  const cat = (protocol.category || '').toLowerCase();
  const name = protocol.name;
  if (/perpetual|derivative|basis trading|options/.test(cat)) {
    return 'Post $' + capital + ' of margin on ' + name + ' on ' + chain + ' and hold one small position open for the window.';
  }
  if (/lending|^cdp|collateral/.test(cat)) {
    return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow against part of it, and keep the position open.';
  }
  if (/dex|liquidity manager/.test(cat)) {
    return 'Provide $' + capital + ' of liquidity to ' + name + '\'s deepest pool on ' + chain + ' and keep the position open.';
  }
  if (/bridge/.test(cat)) {
    return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds inside its own app.';
  }
  if (/staking|restak/.test(cat)) {
    return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
  }
  if (/yield aggregator|allocator|curator/.test(cat)) {
    return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the shares.';
  }
  if (/rwa/.test(cat)) {
    return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it to the redemption date.';
  }
  if (/stablecoin|payments/.test(cat)) {
    return 'Mint $' + capital + ' of the protocol\'s stable asset on ' + chain + ' and hold it in a second wallet.';
  }
  if (/insurance/.test(cat)) {
    return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open.';
  }
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/**
 * Format step text with Cost and Time bounds.
 */
function formatStep(text, cost, time) {
  let res = text + ' Cost: ' + cost + '. Time: ' + time + '.';
  if (res.length > 600) res = res.slice(0, 596) + '...';
  if (res.length < 20) res += ' Keep the position and check the protocol\'s own page.';
  return res;
}

/**
 * Concrete 7-step farming plan.
 * Reads: protocol record, age, and computed farm parameters.
 */
function farmSteps(protocol, age, capital, gas, holdDays) {
  const chain = chainOf(protocol);
  return [
    formatStep(
      'Open a fresh wallet that holds only the money you plan to farm, and keep its seed phrase offline and out of the browser.',
      'under $3 for the first transaction',
      '5 minutes'
    ),
    formatStep(
      actionFor(protocol, capital, chain),
      '$' + capital + ' of capital and about $' + Math.round(gas / 2) + ' of gas to set up',
      '15 minutes to set up'
    ),
    formatStep(
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the protocol records activity from you.',
      'about $2 of gas a week',
      '10 minutes a week'
    ),
    formatStep(
      'Hold the position for at least ' + holdDays + ' days, so the activity is counted in more than one weekly snapshot.',
      'the $' + capital + ' stays in the position',
      holdDays + ' days'
    ),
    formatStep(
      'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link the protocol publishes.',
      'no fee to check, and never pay to claim',
      '10 minutes'
    ),
    formatStep(
      'Sell or unwind the position in one go on a day with little volume, so the price you get is close to the price you saw.',
      'about $' + Math.round(gas / 2) + ' of gas to unwind',
      '20 minutes'
    ),
    formatStep(
      'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it cleanly.',
      'nothing but the log',
      '5 minutes'
    ),
  ];
}

/**
 * Complete costed farming economics for one protocol row.
 * Reads: protocol `tvl_usd`, tracking age, and model implied value.
 */
function farmPlanFor(protocol, impliedValue, asOf, boardMedianPerDollar) {
  const age = ageDays(asOf, protocol.listed_at);
  const capital = capitalFor(protocol);
  const days = holdDaysFor(age);
  const gas = gasFor(capital, days);
  const cost = capital + gas;
  const tvl = protocol.tvl_usd || 0;
  const share = tvl > 0 ? Math.min(1, capital / tvl) : 0;
  const expected = impliedValue * share;
  const perDollar = cost > 0 ? expected / cost : 0;
  const median = boardMedianPerDollar || 0.05;
  const ratio = median > 0 ? perDollar / median : 0;
  const verdict =
    ratio >= 2 ? 'the best return on this board' :
    ratio >= 1 ? 'better than the board median' :
    ratio >= 0.5 ? 'below the board median' :
    'thin: farm it small';
  const steps = farmSteps(protocol, age, capital, gas, days);
  return {
    capital_usd: capital,
    gas_usd: gas,
    days: days,
    cost_usd: cost,
    expected_value_usd: Math.round(expected * 100) / 100,
    value_per_dollar: Math.round(perDollar * 1000) / 1000,
    verdict: verdict,
    farm_steps: steps,
  };
}

/**
 * Evaluates all model figures for a protocol and mutates/populates the row.
 */
function computeProtocol(protocol, stats, asOf, boardMedianPerDollar) {
  const age = ageDays(asOf, protocol.listed_at);
  const valuation = impliedValueOf(protocol, stats, asOf);
  const farm = farmPlanFor(protocol, valuation.impliedValue, asOf, boardMedianPerDollar);
  const key = protocol.category || 'Uncategorised';
  const peers = stats && stats.category_rates_map && stats.category_rates_map[key]
    ? stats.category_rates_map[key].protocols
    : (stats && stats.categories ? (stats.categories.find(function (c) { return c.category === key; }) || {}).protocols || 0 : 0);

  protocol.age_days = age;
  protocol.capture_rate = valuation.capture;
  protocol.launch_odds = valuation.odds;
  protocol.category_rate = valuation.categoryRate;
  protocol.cohort_rate = valuation.cohortRate;
  protocol.value_if_launched_usd = valuation.valueIfLaunched;
  protocol.implied_value_usd = valuation.impliedValue;
  protocol.comparable_peers = peers;
  protocol.capital_usd = farm.capital_usd;
  protocol.gas_usd = farm.gas_usd;
  protocol.days = farm.days;
  protocol.cost_usd = farm.cost_usd;
  protocol.expected_value_usd = farm.expected_value_usd;
  protocol.value_per_dollar = farm.value_per_dollar;
  protocol.verdict = farm.verdict;
  protocol.farm_steps = farm.farm_steps;
  return protocol;
}

if (typeof window !== 'undefined') {
  window.TokenRadarModel = {
    ageDays: ageDays,
    cohortLaunchRate: cohortLaunchRate,
    categoryLaunchRate: categoryLaunchRate,
    growthTiltOf: growthTiltOf,
    categoryCaptureRate: categoryCaptureRate,
    captureRateOf: captureRateOf,
    launchOddsOf: launchOddsOf,
    impliedValueOf: impliedValueOf,
    capitalFor: capitalFor,
    holdDaysFor: holdDaysFor,
    gasFor: gasFor,
    actionFor: actionFor,
    farmSteps: farmSteps,
    farmPlanFor: farmPlanFor,
    computeProtocol: computeProtocol,
  };
}

var _modelExport = {
  ageDays: ageDays,
  cohortLaunchRate: cohortLaunchRate,
  categoryLaunchRate: categoryLaunchRate,
  growthTiltOf: growthTiltOf,
  categoryCaptureRate: categoryCaptureRate,
  captureRateOf: captureRateOf,
  launchOddsOf: launchOddsOf,
  impliedValueOf: impliedValueOf,
  capitalFor: capitalFor,
  holdDaysFor: holdDaysFor,
  gasFor: gasFor,
  actionFor: actionFor,
  farmSteps: farmSteps,
  farmPlanFor: farmPlanFor,
  computeProtocol: computeProtocol,
};

if (typeof window !== 'undefined') {
  window.TokenRadarModel = _modelExport;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TokenRadarModel = _modelExport;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = _modelExport;
}
