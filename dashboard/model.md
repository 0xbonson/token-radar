# Token Radar Scoring Model

Ranks pre-token DeFi protocols by empirical implied token value derived strictly from DefiLlama snapshot data across tokenized peers.

## 1. Formulas (`dashboard/model.js`)

- **Operating Age**: `age_days = Math.max(0, Math.floor((as_of - listed_at) / 86400000))`
- **Category Issuance Rate**: `category_rate = (with_token + 6 * global_issuance) / (total + 6)`
- **Cohort Issuance Rate**: `cohort_rate = cohort.with_token / cohort.protocols`
- **Growth Tilt**: `growth_tilt = tercile_issuance_rate / global_issuance` (terciles of 7d TVL change)
- **Launch Odds**: `launch_odds = clamp(0.005, 0.95, category_rate * (cohort_rate / global_issuance) * growth_tilt)`
- **Category Capture Offset**: `offset = (count / (count + 3)) * median(residuals)`
- **Valuation Capture Rate**: `capture_rate = clamp(min, max, 10^(beta_0 + beta_1*logTVL + beta_2*growth + beta_3*age + offset))`
- **Value If Launched**: `value_if_launched_usd = round(tvl_usd * capture_rate)`
- **Implied Market Value**: `implied_value_usd = round(value_if_launched_usd * launch_odds)`
- **Farming Return**: `value_per_dollar = (implied_value_usd * min(1, capital / tvl_usd)) / (capital + gas)`

## 2. Snapshot Grounding

- `tvl_usd`: Total Value Locked in USD; drives size curve feature, capital requirement, and allocation share.
- `change_7d`: 7-day TVL change percent; informs growth tercile issuance multiplier.
- `listed_at`: UTC date indexed by DefiLlama; establishes age and age cohort issuance rate.
- `category`: DeFi sector classification; sets category issuance baseline and residual valuation offset.
- `chains`: Operational blockchains; determines primary execution chain and gas fee estimation.
- `symbol` / `gecko_id` / `mcap_usd`: Token identity and market cap; filters out protocols whose token already trades.
