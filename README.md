# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xbonson/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xbonson/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that have no token yet. It reads the sealed protocol snapshot, scores every pre-token protocol on what its token would be worth if it issued one tomorrow, and ranks them. Each row carries the implied value, the launch odds, the capture rate the snapshot supports, and a farm plan with its capital, gas, days and expected return. Protocols whose token already trades are kept out of the board and shown separately, with the market's own numbers.

## The model

Nothing on the board is a hand-written list of protocol names. Every figure comes out of the snapshot:

1. **The value curve is fitted on the snapshot's own tokens.** The 119 protocols that already carry a token state a market cap against their TVL. Five candidate models predict that ratio from the snapshot's own figures and each is scored by leave-one-out error — every comparable predicted from the others. The model with the lowest out-of-sample error is the one the board runs, and the dashboard shows the whole table.
2. **Launch odds come from the issuance record.** The odds are the share of protocols in the same category that already carry a token, smoothed towards the global share for small categories, then tilted by the cohort of protocols tracked for as long as this one has.
3. **Every farm plan is costed.** Capital, gas and holding days follow from the protocol's own size and age; the return is the same implied value, taken pro-rata over the share of the protocol's book the position represents.

The dashboard's third tab shows the fitted candidates, the category issue rates and the tracking-age cohorts, so a reader can check the numbers the board ranked on.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html` through any static server to read the board; it makes no network request.

<sub>Entered on [make.fun](https://make.fun/?ref=kewdhhyh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
