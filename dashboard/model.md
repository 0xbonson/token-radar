# How the board is built

Every row on the board is one protocol from the sealed snapshot of 2026-11-14, and every number on
it is computed from that file. No protocol name is written into the program: the model never learns
which protocol exists, it only learns the relationship between the figures the snapshot records.

The program's own source is `lib/model.ts` in the repository, and this note is what it does.

## The formula

```
implied value = launch odds x ( TVL x capture rate )
```

- **capture rate** — what share of a protocol's TVL its token would be worth, if it issued one.
- **launch odds** — how likely that token is to issue at all.

A protocol that already has a token trading is not on the board: those are shown separately, on the
Live tokens tab, with the market's own numbers.

## 1. The value curve is fitted on the snapshot's own tokens

The snapshot records 758 protocols. 119 of them already carry a token, so the file itself states a
market cap against a TVL for each of them. Those 119 are the comparables the model learns from.

Each candidate model predicts one thing: the ratio of a protocol's token market cap to its TVL, in
log space, from other figures in the same file. The candidates differ only in which figures they
read:

| candidate | reads |
| --- | --- |
| one global ratio | one ratio for the whole set |
| global plus category | one ratio, plus each category's own |
| size curve | log TVL, plus each category's own |
| size and growth | log TVL, 7-day growth, plus each category's own |
| size, growth and age | log TVL, 7-day growth, tracking age, plus each category's own |

Every candidate is fitted by ridge least squares on the comparables, with the targets winsorized so
that one token worth many times its TVL cannot drag the whole curve. **Scoring is leave-one-out**:
the comparables are split one at a time, every candidate is fitted on all but one and asked to
predict the one it has not seen, and the errors are collected. The winner is the candidate whose
out-of-sample error is lowest, and the dashboard's "How it is built" tab prints the whole table so a
reader can check it.

The board's model is the one that reads TVL, seven-day growth and tracking age among those whose
leave-one-out error is within a tenth of the best, so the extra figures are used only when the
snapshot itself shows that they cost nothing out of sample.

## 2. The capture rate comes from the comparables

The curve above gives the log ratio; the rate itself is the median of the comparables' ratios,
per category where the category has enough of them, shrunk towards the global median where it has
few, and kept inside the band the comparables themselves occupy, so an extrapolated curve cannot
claim a token worth more than the whole book it sits on.

## 3. The launch odds come from the issuance record

A protocol's odds are the share of the protocols in its own category that already carry a token,
smoothed towards the global share of the 702 protocols in the file when the category is small. Two
tilts follow from the file as well:

- **the tracking-age cohort** — 0-180 days, 180-365, 365-730, 730-1460 and 1460+ days of being
  tracked. The cohorts' own issue rates differ, and a protocol is priced on the cohort it is in.
- **the growth tilt** — the file's protocols are put in three equal groups by their seven-day
  growth, and each group's own issue rate is read off.

## 4. Every farm plan is costed

The capital, the gas and the holding days follow from the protocol's own size and age: a bigger
protocol needs more capital to be worth farming, and a protocol tracked for a long time needs a
position that spans more than one weekly snapshot. The expected value is the same implied value,
taken pro-rata over the share of the protocol's book that the position represents, so the plan's
return per dollar can be compared with the same figure for every other row on the board.

## What the fit came to

The winning model is the one that reads **size, growth and age**. Its coefficients, on the log
market-cap-over-TVL scale, are:

```
log10(mcap / TVL) = 3.0146 - 0.4682 x log10(TVL) - 0.0801 x growth - 0.1200 x log10(age days)
```

with each category's own offset added on top, and the leave-one-out error of 84.3% median and 16.0%
mean absolute percentage error over the 119 comparables.

The other figures the board uses:

| figure | value |
| --- | --- |
| protocols in the snapshot | 758 |
| protocols on the watchlist | 40 |
| comparables with a token (the fitting set) | 119 |
| protocols the model ranks for the board | 226 (186 pre-token, 30 live set aside) |
| global capture rate (median of the comparables) | 0.246 |
| capture rate band the comparables occupy | 0.0059 to 14.55 |
| global share of protocols that issue a token | 0.1695 |

The cohorts' own issue rates, straight from the file:

| cohort | protocols | with a token | rate |
| --- | --- | --- | --- |
| 0-180 days | 86 | 3 | 3.5% |
| 180-365 days | 65 | 7 | 10.8% |
| 365-730 days | 95 | 11 | 11.6% |
| 730-1460 days | 82 | 15 | 18.4% |
| 1460+ days | 175 | 50 | 28.4% |

And the growth tilt, the three equal groups of the file's protocols by their seven-day growth:

| growth group | issue rate |
| --- | --- |
| low | 0.2167 |
| mid | 0.1709 |
| high | 0.1209 |

## What is not in the model

- No protocol name, no list of favourites, no constant typed in by hand.
- No network request: the program reads the one sealed snapshot file and writes its outputs.
- No clock: the same snapshot always produces the same board.
