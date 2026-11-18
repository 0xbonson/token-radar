# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xbonson/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xbonson/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for DeFi protocols that have no token yet. It reads the sealed protocol snapshot, scores pre-token protocols on what their token would be worth if issued tomorrow, and ranks them. Each row carries the implied value, the launch odds, the capture rate supported by empirical snapshot data, and a concrete farm plan with its capital, gas, days, and expected return. Protocols whose tokens already trade are separated and presented with the market's own live numbers.

## Architecture & Project Structure

The single home of the scoring model is `dashboard/model.js` (an ECMAScript module). Both the Node 22 pipeline driver (`main.ts`) and the browser dashboard share this identical model file. The browser computes all valuations client-side from raw snapshot numbers and pool statistics, ensuring total agreement between the visible model, computed numbers, and screenshots:

- `main.ts` — The Node 22 program: ingests the sealed snapshot (`/input/snapshot.json`), executes model calibration, gates the board via `boardIssue`, outputs `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to `/output`, and builds `dossier.json`.
- `dashboard/` — The static, zero-dependency dashboard delivered to readers and the competition judge:
  - `model.js` — Single source of truth scoring engine (ESM); exports `parseSnapshot`, `buildRadar`, `dataScript`, `boardIssue`, `computeProtocol`, `impliedValueOf`, `launchOddsOf`, `captureRateOf`, and `farmPlanFor`.
  - `app.js` — Interactive UI module controller managing state, client-side dynamic evaluation, filtering, sorting, searching, detail drawer, and shareable URL hash routing.
  - `index.html` — Accessible, semantic dashboard UI featuring the pre-token opportunity board, live token comparables, model explanation tab, and detail drawer.
  - `app.css` — High-density, responsive dark theme stylesheet without external fonts or network requests.
  - `model.md` — Tight, readable specification of mathematical formulas, definitions, and code mappings that fits entirely within the dossier text limit.
- `screenshots/` — Headless Chrome captures (1440×900) sized within the 300–350 KB target band:
  - `1-board.png` — Default pre-token opportunity board ranked by implied value.
  - `2-detail.png` — Protocol detail view showing formula breakdown, peer metrics, and 7-step actionable farm plan.
  - `3-filtered.png` — Filtered view demonstrating real-time search and category filtering.
- `vendor/makefun-board.ts` — Official make.fun dossier generator bundling dashboard files and screenshots.
- `LICENSE` — Open source license (SPDX-License-Identifier: MIT).

## The Valuation Model

Nothing on the board relies on hardcoded protocol valuations or magic lists. Every number is grounded in snapshot figures:

1. **Empirical Capture Rate ($C$)**: Evaluates five candidate curves fitted on comparable protocols with actively trading tokens (`mcap_usd / tvl_usd`). The winning model (log-linear TVL with 7d growth and tracking age, plus empirical category offsets shrunk toward global median) minimizes leave-one-out cross-validation error.
2. **Bayesian Launch Odds ($P$)**: Grounded in category issuance frequencies smoothed toward the global average, adjusted by tracking-age cohort duration and 7-day TVL momentum terciles.
3. **Implied Market Value ($V$)**: Computed as $\text{TVL} \times C \times P$.
4. **Actionable Farm Plans**: Costed multi-step execution plans where capital, gas, and duration correspond to protocol scale and category, with expected value calculated directly from the protocol's implied token value.

## Running Locally

Generate the board and dossier:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The build produces `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`, and `out/dossier.json`. Open `out/dashboard/index.html` in any browser without a web server or network connection.

## License

SPDX-License-Identifier: MIT
