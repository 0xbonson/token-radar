// Token Radar interactive UI and client-side scoring coordinator.
// Computes live metrics via ECMAScript model in ./model.js.
// SPDX-License-Identifier: MIT

import { computeProtocol } from './model.js';

const radar = window.RADAR;

if (radar && radar.rows && radar.model) {
  const medianReturn = radar.model.board_median_per_dollar ?? 0.05;
  for (const row of radar.rows) {
    const metrics = computeProtocol(row, radar.model, radar.as_of, medianReturn);
    Object.assign(row, metrics);
  }
}

const formatCurrency = (val) => {
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${Math.round(val)}`;
};

const formatPercent = (val) => (val === null ? 'n/a' : `${val > 0 ? '+' : ''}${val.toFixed(1)}%`);

const formatDuration = (days) => {
  if (days === null) return 'n/a';
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
};

const state = {
  view: 'board',
  query: '',
  category: '',
  chain: '',
  watchlistOnly: false,
  sort: 'rank',
  selected: null,
};

const ui = {
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

function initDropdowns() {
  const categories = [...new Set(radar.rows.map((r) => r.category).filter(Boolean))].sort();
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    ui.category.appendChild(opt);
  }
  const chains = [...new Set(radar.rows.flatMap((r) => r.chains))].sort();
  for (const ch of chains) {
    const opt = document.createElement('option');
    opt.value = ch;
    opt.textContent = ch;
    ui.chain.appendChild(opt);
  }
}

function getFilteredRows() {
  const q = state.query.trim().toLowerCase();
  const filtered = radar.rows.filter((row) => {
    if (state.watchlistOnly && !row.on_watchlist) return false;
    if (state.category && row.category !== state.category) return false;
    if (state.chain && !row.chains.includes(state.chain)) return false;
    if (q) {
      const corpus = `${row.name} ${row.slug} ${row.category ?? ''} ${row.chains.join(' ')}`.toLowerCase();
      if (!corpus.includes(q)) return false;
    }
    return true;
  });

  const sortKey = state.sort === 'implied_value_usd' ? 'rank' : state.sort;
  filtered.sort((a, b) => {
    if (sortKey === 'rank') return a.rank - b.rank;
    const valA = a[sortKey] ?? -Infinity;
    const valB = b[sortKey] ?? -Infinity;
    if (valA === valB) return a.rank - b.rank;
    return valB - valA;
  });

  return filtered;
}

function createTableRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.slug = row.slug;
  const watchClass = row.on_watchlist ? 'dot watch' : 'dot';
  const watchPill = row.on_watchlist ? '<span class="pill">watchlist</span>' : '';
  const catPill = row.category ? `<span class="pill">${row.category}</span>` : '<span class="pill">—</span>';
  const chgClass = row.change_7d >= 0 ? 'up' : 'down';
  const oddsPct = Math.round(row.launch_odds * 100);
  const vpdPct = (row.value_per_dollar * 100).toFixed(0);
  tr.innerHTML = `
    <td class="rank">${row.rank}</td>
    <td><div class="name-cell"><span class="${watchClass}"></span><strong>${row.name}</strong>${watchPill}</div></td>
    <td>${catPill}</td>
    <td class="num">${formatCurrency(row.tvl_usd)}</td>
    <td class="num ${chgClass}">${formatPercent(row.change_7d)}</td>
    <td class="num">${formatDuration(row.age_days)}</td>
    <td class="num">${(row.capture_rate * 100).toFixed(0)}%</td>
    <td class="num"><div class="odds-cell"><span>${oddsPct}%</span><span class="bar"><i style="width:${oddsPct}%"></i></span></div></td>
    <td class="num value">${formatCurrency(row.implied_value_usd)}</td>
    <td class="num" title="${row.verdict}">${vpdPct}%</td>
  `;
  tr.addEventListener('click', () => openDetail(row.slug));
  return tr;
}

function renderBoard() {
  const visible = getFilteredRows();
  ui.rows.replaceChildren(...visible.map(createTableRow));
  ui.count.textContent = `${visible.length} of ${radar.rows.length} protocols shown`;
}

function renderLiveTokens() {
  ui.liveRows.innerHTML = radar.live.map((item) => `
    <tr>
      <td><div class="name-cell"><strong>${item.name}</strong></div></td>
      <td><span class="pill">${item.category ?? '—'}</span></td>
      <td class="num">${formatCurrency(item.tvl_usd)}</td>
      <td class="num">${formatCurrency(item.mcap_usd ?? 0)}</td>
      <td class="num">${item.tvl_to_mcap === null ? 'n/a' : `${item.tvl_to_mcap}x`}</td>
      <td class="num ${(item.change_7d ?? 0) >= 0 ? 'up' : 'down'}">${formatPercent(item.change_7d)}</td>
    </tr>
  `).join('');
  ui.liveNote.textContent =
    `These ${radar.live_size} protocols already have a token that trades, so their value is the market's own ` +
    `and not the model's. The board above ranks only the pre-token ones.`;
}

function parseStepText(line) {
  const matched = line.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/s);
  if (!matched) return { text: line, cost: '', time: '' };
  return { text: matched[1], cost: matched[2], time: matched[3] };
}

function openDetail(slug) {
  const row = radar.rows.find((p) => p.slug === slug);
  if (!row) return;
  state.selected = slug;

  const parsedSteps = row.farm_steps.map(parseStepText);
  ui.detailBody.innerHTML = `
    <h2>${row.name}</h2>
    <p class="sub">${row.category ?? 'Uncategorised'} &middot; ${row.slug}</p>
    <div class="stat-row">
      <div class="stat"><span>Implied value</span><strong class="value">${formatCurrency(row.implied_value_usd)}</strong></div>
      <div class="stat"><span>TVL</span><strong>${formatCurrency(row.tvl_usd)}</strong></div>
      <div class="stat"><span>Launch odds</span><strong>${Math.round(row.launch_odds * 100)}%</strong></div>
      <div class="stat"><span>Capture rate</span><strong>${(row.capture_rate * 100).toFixed(0)}%</strong></div>
    </div>
    <h3>How the value was reached</h3>
    <p class="note">
      ${formatCurrency(row.tvl_usd)} of TVL &times; a ${(row.capture_rate * 100).toFixed(0)}% capture rate is
      ${formatCurrency(row.value_if_launched_usd)} if the token issued, and the odds of it issuing are
      ${Math.round(row.launch_odds * 100)}% &mdash; the issue rate of the ${row.comparable_peers}
      protocols in this category, tilted by the cohort this one is in.
      ${row.change_7d === null ? '' : `Seven-day change ${formatPercent(row.change_7d)}.`}
      ${row.age_days === null ? 'Age unknown.' : `Running ${formatDuration(row.age_days)}.`}
    </p>
    <h3>Chains</h3>
    <div class="chains">${row.chains.map((chain) => `<span class="pill">${chain}</span>`).join('') || '<span class="pill">&mdash;</span>'}</div>
    <h3>How to farm it</h3>
    <p class="note">
      $${row.capital_usd} of capital, about $${row.gas_usd} of gas, ${row.days} days:
      $${row.cost_usd} in total. At ${row.comparable_peers} peers' issue rate that position is worth
      about $${row.expected_value_usd.toFixed(2)} of the implied value (${(row.value_per_dollar * 100).toFixed(0)}% return per $1), so
      <strong>${row.verdict}</strong>.
    </p>
    <ol class="steps">
      ${parsedSteps.map((step) => `<li>${step.text} <b>${step.cost}</b> &middot; ${step.time}.</li>`).join('')}
    </ol>
  `;
  ui.detail.hidden = false;
}

function closeDetail() {
  ui.detail.hidden = true;
  state.selected = null;
}

function renderModelView() {
  const m = radar.model;
  const metrics = [
    ['model version', m.version],
    ['snapshot', m.as_of],
    ['tokens already trading', `${m.comparable_count} protocols`],
    ['protocols read', `${m.universe_count} protocols`],
    ['global capture rate', `${(m.global_capture_rate * 100).toFixed(0)}%`],
    ['global issue rate', `${(m.global_issuance_rate * 100).toFixed(1)}%`],
    ['capture band', `${(m.capture_rate_min * 100).toFixed(1)}% to ${(m.capture_rate_max * 100).toFixed(0)}%`],
    ['growth tilt, low', `${(m.growth_tilt.low * 100).toFixed(1)}%`],
    ['growth tilt, mid', `${(m.growth_tilt.mid * 100).toFixed(1)}%`],
    ['growth tilt, high', `${(m.growth_tilt.high * 100).toFixed(1)}%`],
    ['chosen model', m.chosen.name],
    ['chosen reads', m.chosen.features],
    ['chosen LOO median error', `${m.chosen.loo_median_ape}%`],
    ['board rows', `${radar.board_size} (${radar.early_size} below the floor)`],
    ['watchlist covered', `${radar.watchlist_size} of ${radar.watchlist_size}`],
  ];
  ui.modelTerms.innerHTML = metrics.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  document.getElementById('model-asof').textContent = m.as_of;
  document.getElementById('model-comps').textContent = String(m.comparable_count);
  document.getElementById('model-notes').textContent = m.notes ?? '';

  ui.candidateRows.innerHTML = m.candidates.map((cand) => `
    <tr class="${cand.chosen ? 'chosen' : ''}">
      <td>${cand.chosen ? `${cand.name} ✓` : cand.name}</td>
      <td>${cand.features}</td>
      <td class="num">${cand.loo_median_ape}%</td>
      <td class="num">${cand.loo_mean_ape}%</td>
    </tr>
  `).join('');

  ui.categoryRows.innerHTML = m.categories.map((cat) => `
    <tr>
      <td>${cat.category}</td>
      <td class="num">${cat.protocols}</td>
      <td class="num">${cat.with_token}</td>
      <td class="num">${(cat.smoothed_rate * 100).toFixed(1)}%</td>
    </tr>
  `).join('');

  ui.cohortRows.innerHTML = m.cohorts.map((coh) => `
    <tr>
      <td>${coh.cohort}</td>
      <td class="num">${coh.protocols}</td>
      <td class="num">${coh.with_token}</td>
      <td class="num">${(coh.rate * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

function switchView(viewName) {
  state.view = viewName;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.view === viewName);
  }
  document.getElementById('view-board').hidden = viewName !== 'board';
  document.getElementById('view-live').hidden = viewName !== 'live';
  document.getElementById('view-model').hidden = viewName !== 'model';
}

function syncUrlHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('row/')) {
    const slug = decodeURIComponent(hash.slice(4));
    const target = radar.rows.find((p) => p.slug === slug);
    if (target) {
      state.query = slug;
      ui.q.value = slug;
      renderBoard();
      openDetail(slug);
    }
    return;
  }
  if (hash.startsWith('view/')) {
    const [viewName, yCoord] = hash.slice(5).split('@y=');
    if (viewName === 'board' || viewName === 'live' || viewName === 'model') switchView(viewName);
    if (yCoord !== undefined) {
      const y = Number(yCoord);
      if (Number.isFinite(y)) window.scrollTo(0, y);
    }
    return;
  }
  if (hash.startsWith('filter/')) {
    for (const segment of hash.slice(7).split('/')) {
      const [param, val] = segment.split('=');
      if (param === 'category') {
        state.category = decodeURIComponent(val ?? '');
        ui.category.value = state.category;
      } else if (param === 'chain') {
        state.chain = decodeURIComponent(val ?? '');
        ui.chain.value = state.chain;
      } else if (param === 'watchlist') {
        state.watchlistOnly = val === '1';
        ui.watchlistOnly.checked = state.watchlistOnly;
      } else if (param === 'sort') {
        const key = decodeURIComponent(val ?? 'rank');
        const exists = [...ui.sort.options].some((opt) => opt.value === key);
        state.sort = key === 'implied_value_usd' ? 'rank' : key;
        ui.sort.value = exists ? key : state.sort;
      }
    }
    renderBoard();
    return;
  }
  if (hash.startsWith('search/')) {
    const queryStr = decodeURIComponent(hash.slice(7));
    state.query = queryStr;
    ui.q.value = queryStr;
    renderBoard();
  }
}

function init() {
  ui.asof.textContent = `Snapshot of ${radar.as_of} · ${radar.board_size} protocols on the board · ${radar.watchlist_size} on the watchlist`;
  initDropdowns();
  renderBoard();
  renderLiveTokens();
  renderModelView();

  ui.q.addEventListener('input', (e) => {
    state.query = e.target.value;
    renderBoard();
  });
  ui.category.addEventListener('change', (e) => {
    state.category = e.target.value;
    renderBoard();
  });
  ui.chain.addEventListener('change', (e) => {
    state.chain = e.target.value;
    renderBoard();
  });
  ui.watchlistOnly.addEventListener('change', (e) => {
    state.watchlistOnly = e.target.checked;
    renderBoard();
  });
  ui.sort.addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderBoard();
  });
  document.getElementById('close-detail').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }
  window.addEventListener('hashchange', syncUrlHash);
  syncUrlHash();
}

init();
