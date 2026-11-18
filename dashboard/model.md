# Token Radar Scoring Model

The board ranks pre-token DeFi protocols by implied token value derived strictly from DefiLlama snapshot data. No protocol name or valuation is hardcoded; all scores follow from empirical market benchmarks.

## 1. Core Formulas

- **Operating Age**: `age_days = Math.max(0, Math.floor((as_of - listed_at) / 86400000))`
- **Cohort Rate**: `cohort_rate = cohort.with_token / cohort.protocols` (for age brackets `0-180d`, `180-365d`, `365-730d`, `730-1460d`, `1460d+`)
- **Category Rate**: `category_rate = (with_token + 6 * global_issuance) / (total + 6)` (empirical Bayes smoothing)
- **Growth Tilt**: `growth_tilt = growth_group_rate / global_issuance` (terciles of 7-day TVL change: low < 0%, mid = 0%, high > 0%)
- **Launch Odds**: `launch_odds = Math.max(0.005, Math.min(0.95, category_rate * cohort_tilt * growth_tilt))`
- **Value Curve**: `log10(mcap/tvl) = 3.0146 - 0.4682*log10(tvl) - 0.0801*(change_7d/25) - 0.1200*(age_days/1000) + category_offset`
- **Capture Rate**: `capture_rate = bounded_curve_rate * trust + global_capture_median * (1 - trust)`
- **Implied Value**: `implied_value_usd = Math.max(1, Math.round(Math.max(1, Math.round(tvl_usd * capture_rate)) * launch_odds))`
- **Farming Return**: `value_per_dollar = (implied_value_usd * (capital / tvl_usd)) / (capital + gas)`

## 2. Model Functions (`dashboard/model.js`)

- `ageDays(asOf, listedAt)`: Computes protocol operating age in whole days from snapshot `as_of` and protocol `listed_at`.
- `cohortLaunchRate(age, stats)`: Returns empirical issuance rate for protocol's tracking-age cohort.
- `categoryLaunchRate(category, stats)`: Returns smoothed historical issuance rate for protocol's DefiLlama category.
- `growthTiltOf(change7d, stats)`: Maps 7-day TVL percentage change (`change_7d`) to issuance multiplier.
- `launchOddsOf(protocol, stats, asOf)`: Calculates probability of token issuance from category rate, cohort tilt, and growth tilt.
- `categoryCaptureRate(category, stats)`: Retrieves fitted category residual offset from 119 tokenized comparables.
- `captureRateOf(protocol, stats, asOf)`: Predicts market cap to TVL ratio from log TVL, 7d growth, and age, bounded and shrunk by sample weight.
- `impliedValueOf(protocol, stats, asOf)`: Computes probability-weighted token value from TVL, capture rate, and launch odds.
- `farmPlanFor(protocol, impliedValue, asOf, median)`: Generates actionable, costed 7-step farming plan with capital, gas, hold duration, and return per dollar.
- `computeProtocol(protocol, stats, asOf, median)`: Derives all metrics for a protocol in the browser.

## 3. Snapshot Figures Grounding

- `tvl_usd`: Total Value Locked in whole USD. Determines protocol scale, regression curve evaluation, capital requirements, and pro-rata farm share.
- `change_7d`: 7-day TVL change in percent. Feeds into value curve regression and growth tercile issuance tilt.
- `listed_at`: UTC date DefiLlama began tracking the protocol. Establishes operating age for cohort issuance rate and minimum farming duration.
- `category`: DefiLlama category classification. Selects category capture offset, peer group size, and category issuance rate.
- `chains`: Active deployment networks. Determines execution chain, action type, and gas estimation.
- `symbol` / `gecko_id`: Token identifiers. Used to separate pre-token opportunities from protocols whose tokens already trade live.
