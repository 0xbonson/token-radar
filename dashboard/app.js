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

  const key = state.sort;
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

/** The farm plan of one protocol, built from its own record. */
function farmSteps(row) {
  const chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const capital = row.tvl_usd >= 2_000_000_000 ? 400 : row.tvl_usd >= 500_000_000 ? 250 : row.tvl_usd >= 100_000_000 ? 150 : 100;
  const hold = row.age_days === null ? 45 : row.age_days < 180 ? 60 : row.age_days < 365 ? 45 : 30;
  const category = (row.category ?? '').toLowerCase();
  let action = `Deposit $${capital} of USDC into ${row.name} on ${chain} and keep the position open.`;
  if (/perpetual|derivative|basis|options/.test(category)) {
    action = `Post $${capital} of margin on ${row.name} on ${chain} and hold one small position open for the window.`;
  } else if (/lending|^cdp|collateral/.test(category)) {
    action = `Supply $${capital} of USDC to ${row.name} on ${chain}, borrow against part of it, and keep the position open.`;
  } else if (/dex|liquidity manager/.test(category)) {
    action = `Provide $${capital} of liquidity to ${row.name}'s deepest pool on ${chain} and keep the position open.`;
  } else if (/bridge/.test(category)) {
    action = `Bridge $${capital} of USDC to ${chain} through ${row.name} and use the bridged funds inside its own app.`;
  } else if (/staking|restak/.test(category)) {
    action = `Stake $${capital} of the chain's staking asset through ${row.name} and keep the receipt.`;
  } else if (/yield aggregator|allocator|curator/.test(category)) {
    action = `Deposit $${capital} into a ${row.name} vault on ${chain} and hold the shares.`;
  } else if (/rwa/.test(category)) {
    action = `Mint $${capital} of the protocol's yield asset on ${chain} and hold it to the redemption date.`;
  }

  return [
    { text: 'Open a fresh wallet that holds only the money you plan to farm, and keep its seed phrase offline.', cost: `under $3 for the first transaction`, time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and about $${capital >= 250 ? 8 : 5} of gas`, time: '15 minutes to set up' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days, so the activity is counted in more than one weekly snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link the protocol publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The detail view of one protocol: its numbers, then its farm plan. */
function openDetail(slug) {
  const row = radar.rows.find((item) => item.slug === slug);
  if (!row) return;
  state.selected = slug;

  const steps = farmSteps(row);
  elements.detailBody.innerHTML = `
    <h2>${row.name}</h2>
    <p class="sub">${row.category ?? 'Uncategorised'} · ${row.slug}</p>
    <div class="stat-row">
      <div class="stat"><span>Implied value</span><strong class="value">${money(row.implied_value_usd)}</strong></div>
      <div class="stat"><span>TVL</span><strong>${money(row.tvl_usd)}</strong></div>
      <div class="stat"><span>Launch odds</span><strong>${Math.round(row.launch_odds * 100)}%</strong></div>
      <div class="stat"><span>Capture rate</span><strong>${(row.capture_rate * 100).toFixed(0)}%</strong></div>
    </div>
    <h3>How the value was reached</h3>
    <p class="note">
      ${money(row.tvl_usd)} of TVL &times; ${Math.round(row.implied_value_usd / Math.max(row.tvl_usd, 1) * 10000) / 100}%
      of that value, at ${Math.round(row.launch_odds * 100)}% launch odds.
      ${row.change_7d === null ? '' : `Seven-day change ${percent(row.change_7d)}.`}
      ${row.age_days === null ? 'Age unknown.' : `Running ${days(row.age_days)}.`}
    </p>
    <h3>Chains</h3>
    <div class="chains">${row.chains.map((chain) => `<span class="pill">${chain}</span>`).join('') || '<span class="pill">—</span>'}</div>
    <h3>How to farm it</h3>
    <ol class="steps">
      ${steps.map((step) => `<li>${step.text} <b>${step.cost}</b> · ${step.time}.</li>`).join('')}
    </ol>
  `;
  elements.detail.hidden = false;
}

function closeDetail() {
  elements.detail.hidden = true;
  state.selected = null;
}

/** The model page: the constants the board ran on. */
function drawModel() {
  const model = radar.model;
  const terms = [
    ['tvl_value', model.tvl_value],
    ['growth_weight', model.growth_weight],
    ['growth_cap', `${model.growth_cap}%`],
    ['peak_age_days', `${model.peak_age_days} days`],
    ['age_spread_days', `${model.age_spread_days} days`],
    ['odds_floor', `${Math.round(model.odds_floor * 100)}%`],
    ['odds_cap', `${Math.round(model.odds_cap * 100)}%`],
    ['chain_drag_pct', `${model.chain_drag_pct}% per extra chain`],
    ['chain_drag_after', `${model.chain_drag_after} chains`],
    ['model_version', radar.model_version],
    ['snapshot', `${radar.as_of} · ${radar.board_size} rows · ${radar.early_size} early`],
  ];
  elements.modelTerms.innerHTML = terms.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('');
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
