# Token Radar Scoring Model

Ranks pre-token DeFi protocols by implied token value derived from DefiLlama snapshot data. Valuations are grounded in empirical market benchmarks across tokenized peers.

## 1. Formulas & Implementing Functions (`dashboard/model.js`)

- **Operating Age**: `age_days = Math.max(0, Math.floor((as_of - listed_at) / 86400000))`  
  `ageDays(asOf, listedAt)`
- **Category Issuance Rate**: `category_rate = (with_token + 6 * global_issuance) / (total + 6)`  
  `categoryLaunchRate(category, stats)`
- **Cohort Issuance Rate**: `cohort_rate = cohort.with_token / cohort.protocols`  
  `cohortIssuanceRate(age, stats)` / `cohortLaunchRate`
- **Growth Tilt**: `growth_tilt = tercile_issuance_rate / global_issuance` (terciles of 7d TVL change)  
  `growthTiltOf(change7d, stats)`
- **Launch Odds**: `launch_odds = Math.max(0.005, Math.min(0.95, category_rate * cohort_tilt * growth_tilt))`  
  `launchOddsOf(protocol, stats, asOf)`
- **Category Capture Offset**: `offset = (count / (count + 3)) * median(residuals)`  
  `categoryCaptureRate(category, stats)`
- **Valuation Capture Rate**: `capture_rate = bounded_curve_rate * weight + global_median * (1 - weight)`  
  `captureRateOf(protocol, stats, asOf)`
- **Implied Market Value**: `implied_value_usd = Math.max(1, Math.round(Math.max(1, Math.round(tvl_usd * capture_rate)) * launch_odds))`  
  `impliedValueOf(protocol, stats, asOf)`
- **Farming Return**: `value_per_dollar = (implied_value_usd * min(1, capital / tvl_usd)) / (capital + gas)`  
  `farmPlanFor(protocol, impliedValue, age, medianPerDollar)`
- **Protocol Metrics Computation**: Derives display metrics, valuations, and farm steps.  
  `computeProtocol(protocol, stats, asOf, medianPerDollar)`

## 2. Snapshot Figures Grounding

- `tvl_usd`: Total Value Locked in USD; drives curve regression feature, capital required, and pro-rata farm allocation.
- `change_7d`: 7-day TVL change percent; informs growth tercile issuance multiplier.
- `listed_at`: UTC date indexed by DefiLlama; establishes protocol age and age cohort issuance rate.
- `category`: DeFi sector classification; sets category issuance baseline and residual valuation offset.
- `chains`: Operational blockchains; determines primary execution chain and gas fee estimation.
- `symbol` / `gecko_id` / `mcap_usd`: Token identity and market cap; filters out protocols whose token already trades.
