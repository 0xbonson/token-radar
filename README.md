# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xbonson/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xbonson/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that have no token yet. It reads the sealed protocol snapshot, scores pre-token protocols on what their token would be worth if issued tomorrow, and ranks them. Each row carries the implied value, the launch odds, the capture rate supported by empirical snapshot data, and a concrete farm plan with its capital, gas, days, and expected return. Protocols whose tokens already trade are separated and presented with the market's own live numbers.

## Architecture & Project Structure

The scoring engine lives directly in the dashboard source so the browser computes all valuations client-side from raw snapshot numbers and pool statistics, ensuring total agreement between visible source code, computed numbers, and screenshots:

- `main.ts` — The Node 22 pipeline driver: ingests the sealed snapshot (`/input/snapshot.json`), executes backend calibration, validates the gate constraints via `lib/model.ts`, exports `out/data.js`, and packages `out/dossier.json`.
- `lib/model.ts` — Core valuation and ranking model in TypeScript, mirroring client-side JavaScript arithmetic for server-side board generation and validation.
- `dashboard/` — Static dashboard delivered to readers and the competition judge:
  - `index.html` — Accessible, semantic dashboard UI featuring the pre-token opportunity board, live token comparables, model explanation tab, and detail drawer.
  - `app.css` — High-density, responsive stylesheet without external fonts or network dependencies.
  - `model.js` — Client-side scoring model loaded via relative script tag; exports `computeProtocol`, `impliedValueOf`, `launchOddsOf`, `captureRateOf`, and `farmPlanFor`.
  - `app.js` — Interactive UI controller managing state, client-side dynamic evaluation, filtering, sorting, searching, drawer presentation, and deep hash routing.
  - `model.md` — Tight, readable specification of the mathematical formulation, definitions, and code mappings that fits entirely within the dossier text limit.
- `screenshots/` — Headless Chrome captures (1440×900) sized within the 300–350 KB target band:
  - `1-board.png` — Default pre-token opportunity board ranked by implied value.
  - `2-detail.png` — Protocol detail view showing breakdown, formulas, and 7-step actionable farm plan.
  - `3-filtered.png` — Category and parameter filtered view demonstrating dynamic filtering.
- `vendor/makefun-board.ts` — Official make.fun dossier generator bundling dashboard files and screenshots.
- `LICENSE` — Open source license (SPDX-License-Identifier: MIT).

## The Valuation Model

Nothing on the board relies on hardcoded protocol valuations or magic lists. Every number is grounded in snapshot figures:

1. **Empirical Capture Rate ($C$)**: Fitted on the 119 protocols with actively trading tokens (`mcap_usd / tvl_usd`). The optimal model (log-linear TVL with empirical category median offsets bounded to [0.03, 1.50]) minimizes out-of-sample leave-one-out error.
2. **Bayesian Launch Odds ($P$)**: Grounded in category issuance frequencies smoothed toward the global average, adjusted by cohort age duration (tracking days) and 7-day TVL momentum terciles.
3. **Implied Value ($V$)**: Computed as $\text{TVL} \times C \times P$.
4. **Actionable Farm Plans**: Costed multi-step execution plans where capital, gas, and duration correspond to protocol scale and category, with expected value calculated directly from the protocol's implied token value.

## Running Locally

Generate the board and dossier:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The build produces `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`, and `out/dossier.json`. Open `out/dashboard/index.html` in any browser without a web server or network connection.

## License

SPDX-License-Identifier: MIT
