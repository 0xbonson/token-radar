# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xbonson/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xbonson/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that have no token yet. It reads the sealed protocol snapshot, scores every pre-token protocol on what its token would be worth if it issued one tomorrow, and ranks them: the board shows the implied value, the launch odds, the category's capture rate and a farm plan with costs and times for each protocol. Protocols whose token already trades are kept out of the board and shown separately with the market's own numbers.

The model is stated in full on the dashboard's own page, and every constant comes from the snapshot: no protocol name is special-cased anywhere.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html` through any static server to read the board.

<sub>Entered on [make.fun](https://make.fun/?ref=kewdhhyh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
