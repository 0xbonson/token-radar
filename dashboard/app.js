// The radar's page: it reads the data the program wrote, and renders the board, the filters and the
// detail view of one protocol.
//
// Everything is plain DOM: the dataset is in window.RADAR, and the page never asks the network for
// anything.

const radar = window.RADAR;

const money = (value) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
};

const percent = (value) => (value === null ? 'n/a' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`);

const days = (value) => {
  if (value === null) return 'n/a';
  if (value < 365) return `${value}d`;
  const years = value / 365;
  return `${years.toFixed(1)}y`;
};

/** The state of the page: what is searched, filtered and sorted. */
const state = {
  view: 'board',
  query: '',
  category: '',
  chain: '',
  watchlistOnly: false,
  sort: 'rank',
  selected: null,
};

const elements = {
  rows: document.getElementById('rows'),
  liveRows: document.getElementById('live-rows'),
  liveNote: document.getElementById('live-note'),
  count: document.getElementById('count'),
  q: document.getElementById('q'),
  category: document.getElementById('category'),
  chain: document.getElementById('chain'),
  watchlistOnly: document.getElementById('watchlist-only'),
  sort: document.getElementById('sort'),
  detail: document.getElementById('detail'),
  detailBody: document.getElementById('detail-body'),
  asof: document.getElementById('asof'),
  modelTerms: document.getElementById('model-terms'),
  candidateRows: document.getElementById('candidate-rows'),
  categoryRows: document.getElementById('category-rows'),
  cohortRows: document.getElementById('cohort-rows'),
};

/** Fill the two filter menus from the data itself, so they always match the board. */
function fillMenus() {
  const categories = [...new Set(radar.rows.map((row) => row.category).filter(Boolean))].sort();
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    elements.category.appendChild(option);
  }
  const chains = [...new Set(radar.rows.flatMap((row) => row.chains))].sort();
  for (const chain of chains) {
    const option = document.createElement('option');
    option.value = chain;
    option.textContent = chain;
    elements.chain.appendChild(option);
  }
}

/** The rows the filters leave, sorted the way the sort box says. */
function visibleRows() {
  const query = state.query.trim().toLowerCase();
  const rows = radar.rows.filter((row) => {
    if (state.watchlistOnly && !row.on_watchlist) return false;
    if (state.category && row.category !== state.category) return false;
    if (state.chain && !row.chains.includes(state.chain)) return false;
    if (query) {
      const haystack = `${row.name} ${row.slug} ${row.category ?? ''} ${row.chains.join(' ')}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const key = state.sort === 'implied_value_usd' ? 'rank' : state.sort;
  rows.sort((a, b) => {
    if (key === 'rank') return a.rank - b.rank;
    const left = a[key] ?? -Infinity;
    const right = b[key] ?? -Infinity;
    if (left === right) return a.rank - b.rank;
    if (key === 'age_days') return right - left;
    return right - left;
  });
  return rows;
}

/** One board row, as a table row. */
function boardRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.slug = row.slug;

  const rank = document.createElement('td');
  rank.className = 'rank';
  rank.textContent = String(row.rank);
  tr.appendChild(rank);

  const name = document.createElement('td');
  const cell = document.createElement('div');
  cell.className = 'name-cell';
  const dot = document.createElement('span');
  dot.className = row.on_watchlist ? 'dot watch' : 'dot';
  const strong = document.createElement('strong');
  strong.textContent = row.name;
  cell.append(dot, strong);
  if (row.on_watchlist) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = 'watchlist';
    cell.appendChild(pill);
  }
  name.appendChild(cell);
  tr.appendChild(name);

  const category = document.createElement('td');
  category.innerHTML = row.category ? `<span class="pill">${row.category}</span>` : '<span class="pill">—</span>';
  tr.appendChild(category);

  const tvl = document.createElement('td');
  tvl.className = 'num';
  tvl.textContent = money(row.tvl_usd);
  tr.appendChild(tvl);

  const change = document.createElement('td');
  change.className = `num ${row.change_7d >= 0 ? 'up' : 'down'}`;
  change.textContent = percent(row.change_7d);
  tr.appendChild(change);

  const age = document.createElement('td');
  age.className = 'num';
  age.textContent = days(row.age_days);
  tr.appendChild(age);

  const capture = document.createElement('td');
  capture.className = 'num';
  capture.textContent = `${(row.capture_rate * 100).toFixed(0)}%`;
  tr.appendChild(capture);

  const odds = document.createElement('td');
  odds.className = 'num';
  const oddsCell = document.createElement('div');
  oddsCell.className = 'odds-cell';
  const bar = document.createElement('span');
  bar.className = 'bar';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(row.launch_odds * 100)}%`;
  bar.appendChild(fill);
  const oddsText = document.createElement('span');
  oddsText.textContent = `${Math.round(row.launch_odds * 100)}%`;
  oddsCell.append(oddsText, bar);
  odds.appendChild(oddsCell);
  tr.appendChild(odds);

  const value = document.createElement('td');
  value.className = 'num value';
  value.textContent = money(row.implied_value_usd);
  tr.appendChild(value);

  const farm = document.createElement('td');
  farm.className = 'num';
  farm.textContent = `${(row.value_per_dollar * 100).toFixed(0)}%`;
  farm.title = row.verdict;
  tr.appendChild(farm);

  tr.addEventListener('click', () => openDetail(row.slug));
  return tr;
}

/** Draw the board with the current filters. */
function drawBoard() {
  const rows = visibleRows();
  elements.rows.replaceChildren(...rows.map(boardRow));
  elements.count.textContent = `${rows.length} of ${radar.rows.length} protocols shown`;
}

/** Draw the live-token view: the market's own numbers, kept apart from the board's claim. */
function drawLive() {
  elements.liveRows.replaceChildren(
    ...radar.live.map((row) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.innerHTML = `<div class="name-cell"><strong>${row.name}</strong></div>`;
      const category = document.createElement('td');
      category.innerHTML = `<span class="pill">${row.category ?? '—'}</span>`;
      const tvl = document.createElement('td');
      tvl.className = 'num';
      tvl.textContent = money(row.tvl_usd);
      const cap = document.createElement('td');
      cap.className = 'num';
      cap.textContent = money(row.mcap_usd ?? 0);
      const ratio = document.createElement('td');
      ratio.className = 'num';
      ratio.textContent = row.tvl_to_mcap === null ? 'n/a' : `${row.tvl_to_mcap}x`;
      const change = document.createElement('td');
      change.className = `num ${(row.change_7d ?? 0) >= 0 ? 'up' : 'down'}`;
      change.textContent = percent(row.change_7d);
      tr.append(name, category, tvl, cap, ratio, change);
      return tr;
    }),
  );
  elements.liveNote.textContent =
    `These ${radar.live_size} protocols already have a token that trades, so their value is the market's own ` +
    `and not the model's. The board above ranks only the pre-token ones.`;
}

/** The farm plan of one protocol: the board's own steps, with their costs and times. */
function farmSteps(row) {
  return row.farm_steps.map((text) => {
    const parts = text.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/s);
    if (!parts) return { text, cost: '', time: '' };
    return { text: parts[1], cost: parts[2], time: parts[3] };
  });
}

/** The detail view of one protocol: its numbers, then its farm plan. */
function openDetail(slug) {
  const row = radar.rows.find((item) => item.slug === slug);
  if (!row) return;
  state.selected = slug;

  const steps = farmSteps(row);
  elements.detailBody.innerHTML = `
    <h2>${row.name}</h2>
    <p class="sub">${row.category ?? 'Uncategorised'} &middot; ${row.slug}</p>
    <div class="stat-row">
      <div class="stat"><span>Implied value</span><strong class="value">${money(row.implied_value_usd)}</strong></div>
      <div class="stat"><span>TVL</span><strong>${money(row.tvl_usd)}</strong></div>
      <div class="stat"><span>Launch odds</span><strong>${Math.round(row.launch_odds * 100)}%</strong></div>
      <div class="stat"><span>Capture rate</span><strong>${(row.capture_rate * 100).toFixed(0)}%</strong></div>
    </div>
    <h3>How the value was reached</h3>
    <p class="note">
      ${money(row.tvl_usd)} of TVL &times; a ${(row.capture_rate * 100).toFixed(0)}% capture rate is
      ${money(row.value_if_launched_usd)} if the token issued, and the odds of it issuing are
      ${Math.round(row.launch_odds * 100)}% &mdash; the issue rate of the ${row.comparable_peers}
      protocols in this category, tilted by the cohort this one is in.
      ${row.change_7d === null ? '' : `Seven-day change ${percent(row.change_7d)}.`}
      ${row.age_days === null ? 'Age unknown.' : `Running ${days(row.age_days)}.`}
    </p>
    <h3>Chains</h3>
    <div class="chains">${row.chains.map((chain) => `<span class="pill">${chain}</span>`).join('') || '<span class="pill">&mdash;</span>'}</div>
    <h3>How to farm it</h3>
    <p class="note">
      $${row.capital_usd} of capital, about $${row.gas_usd} of gas, ${row.days} days:
      $${row.cost_usd} in total. At ${row.comparable_peers} peers' issue rate that position is worth
      about $${row.expected_value_usd.toFixed(2)} of the implied value, so
      <strong>${row.verdict}</strong>.
    </p>
    <ol class="steps">
      ${steps.map((step) => `<li>${step.text} <b>${step.cost}</b> &middot; ${step.time}.</li>`).join('')}
    </ol>
  `;
  elements.detail.hidden = false;
}

function closeDetail() {
  elements.detail.hidden = true;
  state.selected = null;
}

/** The model page: what the board was fitted on, and how it did out of sample. */
function drawModel() {
  const model = radar.model;
  const terms = [
    ['model version', model.version],
    ['snapshot', model.as_of],
    ['tokens already trading', `${model.comparable_count} protocols`],
    ['protocols read', `${model.universe_count} protocols`],
    ['global capture rate', `${(model.global_capture_rate * 100).toFixed(0)}%`],
    ['global issue rate', `${(model.global_issuance_rate * 100).toFixed(1)}%`],
    ['capture band', `${(model.capture_rate_min * 100).toFixed(1)}% to ${(model.capture_rate_max * 100).toFixed(0)}%`],
    ['growth tilt, low', `${(model.growth_tilt.low * 100).toFixed(1)}%`],
    ['growth tilt, mid', `${(model.growth_tilt.mid * 100).toFixed(1)}%`],
    ['growth tilt, high', `${(model.growth_tilt.high * 100).toFixed(1)}%`],
    ['chosen model', model.chosen.name],
    ['chosen reads', model.chosen.features],
    ['chosen LOO median error', `${model.chosen.loo_median_ape}%`],
    ['board rows', `${radar.board_size} (${radar.early_size} below the floor)`],
    ['watchlist covered', `${radar.watchlist_size} of ${radar.watchlist_size}`],
  ];
  elements.modelTerms.innerHTML = terms.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('');

  document.getElementById('model-asof').textContent = model.as_of;
  document.getElementById('model-comps').textContent = String(model.comparable_count);
  document.getElementById('model-notes').textContent = model.notes;

  elements.candidateRows.replaceChildren(
    ...model.candidates.map((candidate) => {
      const tr = document.createElement('tr');
      if (candidate.chosen) tr.className = 'chosen';
      const name = document.createElement('td');
      name.textContent = candidate.chosen ? `${candidate.name} \u2713` : candidate.name;
      const reads = document.createElement('td');
      reads.textContent = candidate.features;
      const med = document.createElement('td');
      med.className = 'num';
      med.textContent = `${candidate.loo_median_ape}%`;
      const mean = document.createElement('td');
      mean.className = 'num';
      mean.textContent = `${candidate.loo_mean_ape}%`;
      tr.append(name, reads, med, mean);
      return tr;
    }),
  );

  elements.categoryRows.replaceChildren(
    ...model.categories.map((category) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = category.category;
      const total = document.createElement('td');
      total.className = 'num';
      total.textContent = String(category.protocols);
      const token = document.createElement('td');
      token.className = 'num';
      token.textContent = String(category.with_token);
      const rate = document.createElement('td');
      rate.className = 'num';
      rate.textContent = `${(category.smoothed_rate * 100).toFixed(1)}%`;
      tr.append(name, total, token, rate);
      return tr;
    }),
  );

  elements.cohortRows.replaceChildren(
    ...model.cohorts.map((cohort) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = cohort.cohort;
      const total = document.createElement('td');
      total.className = 'num';
      total.textContent = String(cohort.protocols);
      const token = document.createElement('td');
      token.className = 'num';
      token.textContent = String(cohort.with_token);
      const rate = document.createElement('td');
      rate.className = 'num';
      rate.textContent = `${(cohort.rate * 100).toFixed(1)}%`;
      tr.append(name, total, token, rate);
      return tr;
    }),
  );
}

/** Switch the visible view. */
function showView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  }
  document.getElementById('view-board').hidden = view !== 'board';
  document.getElementById('view-live').hidden = view !== 'live';
  document.getElementById('view-model').hidden = view !== 'model';
}

/**
 * The page's address, as a state the reader can be sent to.
 *
 * A link like #row/axis opens that protocol's detail view, and #search/dex filters the board, so a
 * reader can share the exact view they are looking at.
 */
function readHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('row/')) {
    const slug = decodeURIComponent(hash.slice(4));
    const row = radar.rows.find((item) => item.slug === slug);
    if (row) {
      state.query = slug;
      elements.q.value = slug;
      drawBoard();
      openDetail(slug);
    }
    return;
  }
  if (hash.startsWith('view/')) {
    // A view link may carry a scroll target, as #view/model@y=900, so a reader can share the exact
    // part of the page they are looking at.
    const [view, at] = hash.slice(5).split('@y=');
    if (view === 'board' || view === 'live' || view === 'model') showView(view);
    if (at !== undefined) {
      const target = Number(at);
      if (Number.isFinite(target)) window.scrollTo(0, target);
    }
    return;
  }
  if (hash.startsWith('filter/')) {
    // A filter link, as #filter/category=Payments/watchlist=1/sort=implied_value_usd, opens the
    // board with those filters applied, so a reader can share the exact subset they are reading.
    for (const part of hash.slice(7).split('/')) {
      const [key, value] = part.split('=');
      if (key === 'category') {
        state.category = decodeURIComponent(value ?? '');
        elements.category.value = state.category;
      } else if (key === 'chain') {
        state.chain = decodeURIComponent(value ?? '');
        elements.chain.value = state.chain;
      } else if (key === 'watchlist') {
        state.watchlistOnly = value === '1';
        elements.watchlistOnly.checked = state.watchlistOnly;
      } else if (key === 'sort') {
        // The board is ranked by implied value, so a link may name it directly.
        const asked = decodeURIComponent(value ?? 'rank');
        const known = [...elements.sort.options].some((option) => option.value === asked);
        state.sort = asked === 'implied_value_usd' ? 'rank' : asked;
        elements.sort.value = known ? asked : state.sort;
      }
    }
    drawBoard();
    return;
  }
  if (hash.startsWith('search/')) {
    const query = decodeURIComponent(hash.slice(7));
    state.query = query;
    elements.q.value = query;
    drawBoard();
  }
}

/** Wire the page up. */
function main() {
  elements.asof.textContent = `Snapshot of ${radar.as_of} · ${radar.board_size} protocols on the board · ${radar.watchlist_size} on the watchlist`;
  fillMenus();
  drawBoard();
  drawLive();
  drawModel();

  elements.q.addEventListener('input', (event) => {
    state.query = event.target.value;
    drawBoard();
  });
  elements.category.addEventListener('change', (event) => {
    state.category = event.target.value;
    drawBoard();
  });
  elements.chain.addEventListener('change', (event) => {
    state.chain = event.target.value;
    drawBoard();
  });
  elements.watchlistOnly.addEventListener('change', (event) => {
    state.watchlistOnly = event.target.checked;
    drawBoard();
  });
  elements.sort.addEventListener('change', (event) => {
    state.sort = event.target.value;
    drawBoard();
  });
  document.getElementById('close-detail').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetail();
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }
  window.addEventListener('hashchange', readHash);
  readHash();
}

main();
