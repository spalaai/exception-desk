import {
  STATUS_LABELS,
  formatMoney,
  decisionFor,
  filterItems,
  sortItems,
  computeKpis,
  buildCsv,
  buildCsvRows,
  exportFilename,
} from './lib/desk-logic.js';

const $ = (sel, root = document) => root.querySelector(sel);

const STORAGE_KEY = 'exception-desk-decisions';
const SESSION_KEY = 'exception-desk-session';

const CATEGORY_META = {
  'dispute / chargeback': { label: 'Chargeback', color: '#b4232c' },
  'duplicate charge': { label: 'Duplicate charge', color: '#c2410c' },
  'failed payment': { label: 'Failed payment', color: '#475569' },
  'invoice mismatch': { label: 'Invoice mismatch', color: '#a16207' },
  'refund request': { label: 'Refund request', color: '#0d6b6e' },
  'other / needs human': { label: 'Needs human', color: '#7c8591' },
};

let state = {
  items: [],
  triageId: null,
  insights: null,
  selectedId: null,
  sampleText: '',
  filters: { status: '', category: '', query: '', sort: 'priority' },
};
/** @type {Record<string, { status: string, finalReply?: string, note?: string, updatedAt?: string }>} */
let decisions = {};

/* ---------------- persistence ---------------- */

function loadDecisionsFor(triageId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[triageId] || {};
  } catch {
    return {};
  }
}

function saveDecisions() {
  if (!state.triageId) return;
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[state.triageId] = decisions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked: decisions stay in memory */
  }
}

function saveSession() {
  if (!state.triageId || !state.items.length) return;
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        triageId: state.triageId,
        items: state.items,
        insights: state.insights,
        inputText: $('#batch-input').value,
        selectedId: state.selectedId,
      })
    );
  } catch {
    /* ignore */
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!saved?.triageId || !Array.isArray(saved.items) || !saved.items.length) return false;
    state.triageId = saved.triageId;
    state.items = saved.items;
    state.insights = saved.insights;
    state.selectedId = saved.selectedId || saved.items[0].id;
    if (typeof saved.inputText === 'string') $('#batch-input').value = saved.inputText;
    decisions = loadDecisionsFor(state.triageId);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function catTag(category) {
  const m = CATEGORY_META[category] || { label: category, color: '#7c8591' };
  return `<span class="tag"><span class="sw" style="background:${m.color}"></span>${esc(m.label)}</span>`;
}

function statusPill(status) {
  return `<span class="status st-${status}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function sourceTag(source) {
  if (source === 'ai') return '<span class="tag src-ai">AI</span>';
  if (source === 'rules-fallback') return '<span class="tag src-rules-fallback" title="The model call failed or timed out; rules were used for this item">Rules fallback</span>';
  return '<span class="tag">Rules</span>';
}

function timeShort(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

let toastTimer;
function toast(text, isError = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function visibleItems() {
  return sortItems(filterItems(state.items, decisions, state.filters), state.filters.sort);
}

/* ---------------- views ---------------- */

function showView(name) {
  const intake = name === 'intake';
  $('#intake-view').classList.toggle('hidden', !intake);
  $('#review-view').classList.toggle('hidden', intake);
  $('#new-batch').classList.toggle('hidden', intake);
  $('#back-to-queue')?.classList.toggle('hidden', !(intake && state.items.length));
  window.scrollTo(0, 0);
}

function setComposerError(title, text, retry = false) {
  const box = $('#composer-error');
  if (!title) {
    box.classList.add('hidden');
    return;
  }
  $('#composer-error-title').textContent = title;
  $('#composer-error-text').textContent = text || '';
  $('#composer-retry').classList.toggle('hidden', !retry);
  box.classList.remove('hidden');
}

function updateInputStats() {
  const v = $('#batch-input').value;
  const stats = $('#input-stats');
  if (!v.trim()) {
    stats.textContent = '';
  } else {
    const lines = v.split(/\r?\n/).length;
    const kb = (new Blob([v]).size / 1024).toFixed(1);
    stats.textContent = `${lines} lines · ${kb} KB`;
  }
  $('#sample-note').classList.toggle('hidden', !(state.sampleText && v === state.sampleText));
}

function renderLoading() {
  showView('review');
  $('#kpis').innerHTML = Array.from({ length: 5 }, () => '<div class="kpi"><div class="skeleton" style="height:12px;width:60%"></div><div class="skeleton" style="height:26px;width:45%;margin-top:10px"></div></div>').join('');
  $('#status-tabs').innerHTML = '';
  $('#queue-banner').classList.add('hidden');
  $('#queue-empty').classList.add('hidden');
  $('#export-open').disabled = true;
  $('#queue-list').innerHTML =
    '<li class="loading-caption"><span class="spinner"></span>Triaging batch: parsing, categorising, linking related cases…</li>' +
    Array.from({ length: 7 }, () => '<li class="sk-row"><div class="skeleton a"></div><div class="skeleton b"></div><div class="skeleton c"></div></li>').join('');
  $('#detail-empty').classList.add('hidden');
  const dc = $('#detail-content');
  dc.classList.remove('hidden');
  dc.innerHTML = `<div class="detail-scroll">
    <div class="skeleton" style="height:14px;width:30%"></div>
    <div class="skeleton" style="height:24px;width:70%;margin-top:12px"></div>
    <div class="skeleton" style="height:96px;margin-top:22px"></div>
    <div class="skeleton" style="height:80px;margin-top:20px"></div>
    <div class="skeleton" style="height:140px;margin-top:20px"></div></div>`;
}

function renderKpis() {
  const k = computeKpis(state.items, decisions);
  const pct = (n) => (k.total ? (n / k.total) * 100 : 0);
  const groups = state.insights?.relatedGroups ?? 0;
  $('#kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">To review</div>
      <div class="kpi-value">${k.pending}<small> / ${k.total}</small></div>
      <div class="progress" title="${k.reviewed} of ${k.total} reviewed">
        <span class="seg-ok" style="width:${pct(k.approved)}%"></span><span class="seg-esc" style="width:${pct(k.escalated)}%"></span><span class="seg-rej" style="width:${pct(k.rejected)}%"></span>
      </div>
    </div>
    <div class="kpi ${k.p1Open ? 'alert-kpi' : ''}">
      <div class="kpi-label">Urgent (P1) open</div>
      <div class="kpi-value">${k.p1Open}</div>
      <div class="kpi-foot">Disputes, duplicates, $500+</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Amount still in review</div>
      <div class="kpi-value">${formatMoney(k.openAmount, { blankZero: false })}</div>
      <div class="kpi-foot">${k.pending} open item${k.pending === 1 ? '' : 's'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Refunds approved</div>
      <div class="kpi-value">${formatMoney(k.approvedRefunds, { blankZero: false })}</div>
      <div class="kpi-foot">For you to issue in your processor</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Related groups</div>
      <div class="kpi-value">${groups}</div>
      <div class="kpi-foot">Cases linked within this batch</div>
    </div>`;
}

function renderTabs() {
  const k = computeKpis(state.items, decisions);
  const tabs = [
    ['', 'All', k.total],
    ['pending', 'To review', k.pending],
    ['approved', 'Approved', k.approved],
    ['escalated', 'Escalated', k.escalated],
    ['rejected', 'Rejected', k.rejected],
  ];
  $('#status-tabs').innerHTML = tabs
    .map(
      ([v, label, n]) =>
        `<button type="button" role="tab" class="status-tab" data-status="${v}" aria-selected="${state.filters.status === v}">${label}<span class="count">${n}</span></button>`
    )
    .join('');
}

function renderQueue() {
  renderKpis();
  renderTabs();
  const list = $('#queue-list');
  const empty = $('#queue-empty');
  const items = visibleItems();
  const k = computeKpis(state.items, decisions);
  $('#export-open').disabled = !state.items.length;

  const banner = $('#queue-banner');
  if (state.items.length && k.pending === 0) {
    banner.innerHTML = `<span>All ${k.total} exceptions reviewed. Export the decisions to hand off.</span><button type="button" class="btn ghost sm" data-action="export">Export CSV</button>`;
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');

  if (!items.length) {
    list.innerHTML = '';
    empty.innerHTML = `<div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      <strong>No exceptions match these filters</strong><span>${state.items.length} in this batch. Try another status or clear the search.</span>
      <button type="button" class="btn ghost sm" data-action="clear-filters">Clear filters</button>`;
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items
    .map((item) => {
      const d = decisionFor(decisions, item.id);
      const who = item.displayCustomer || item.displayEmail || '';
      const amt = formatMoney(item.displayAmount);
      const rel = item.relatedIds?.length
        ? `<span class="tag rel" title="Linked to ${esc(item.relatedIds.join(', '))}">↔ ${esc(item.relatedIds.join(', '))}</span>`
        : '';
      return `<li class="queue-item ${item.id === state.selectedId ? 'selected' : ''} ${d.status !== 'pending' ? 'done' : ''}" data-id="${esc(item.id)}" tabindex="-1">
        <span class="prio prio-${esc(item.priority)}">${esc(item.priority)}</span>
        <div class="q-main">
          <div class="q-top"><span class="q-id">${esc(item.id)}</span><span class="q-subject">${esc(item.displaySubject || item.suggestedAction || 'Exception')}</span></div>
          <div class="q-sub">${catTag(item.category)}${who ? `<span class="q-who">${esc(who)}</span>` : ''}${rel}</div>
        </div>
        <div class="q-right"><span class="q-amount ${amt ? '' : 'none'}">${amt || '—'}</span>${statusPill(d.status)}</div>
      </li>`;
    })
    .join('');

  const sel = list.querySelector('.queue-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function renderRaw(item) {
  const ev = new Set(item.evidenceLines || []);
  return (item.rawText || '')
    .split(/\r?\n/)
    .map((line, i) => `<span class="ln ${ev.has(i) ? 'ev' : ''}">${esc(line) || ' '}</span>`)
    .join('');
}

function renderDetail() {
  const item = state.items.find((x) => x.id === state.selectedId);
  const dc = $('#detail-content');
  if (!item) {
    dc.classList.add('hidden');
    $('#detail-empty').classList.remove('hidden');
    return;
  }
  $('#detail-empty').classList.add('hidden');
  dc.classList.remove('hidden');

  const d = decisionFor(decisions, item.id);
  const conf = Math.round((item.confidence || 0) * 100);
  const amt = formatMoney(item.displayAmount);
  const facts = item.facts || [];
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const signals = item.matchedSignals || [];
  const draft = d.finalReply || item.draftReply || '';
  const edited = d.finalReply && d.finalReply !== item.draftReply;
  const who = [item.displayCustomer, item.displayEmail].filter(Boolean).join(' · ');

  dc.innerHTML = `
    <div class="detail-scroll">
      <div class="d-head">
        <div>
          <div class="d-crumbs"><span class="prio prio-${esc(item.priority)}">${esc(item.priority)}</span>${catTag(item.category)}<span class="q-id">${esc(item.id)}</span>${statusPill(d.status)}</div>
          <h2 class="d-title">${esc(item.displaySubject || 'Exception')}</h2>
          ${who ? `<p class="d-who">${esc(who)}</p>` : '<p class="d-who">No customer details found in the source</p>'}
        </div>
        <div class="d-amount"><div class="v">${amt || '—'}</div><div class="l">${amt ? 'Amount in question' : 'No amount found'}</div></div>
      </div>

      <div class="rec">
        <div class="rec-label"><span>Suggested next step</span>
          <span class="conf ${conf < 60 ? 'low' : ''}" title="How strongly the signals support this suggestion">${sourceTag(item.source)} Confidence ${conf}% <span class="conf-bar"><span style="width:${conf}%"></span></span></span>
        </div>
        <p class="rec-action">${esc(item.suggestedAction)}</p>
        <p class="rec-why"><strong>Why:</strong> ${esc(item.why)}</p>
        ${signals.length ? `<div class="signals">${signals.map((s) => `<span class="signal">${esc(s)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="section">
        <div class="section-title">Key facts <span class="hint">Pulled from the source text</span></div>
        ${
          facts.length
            ? `<dl class="facts">${facts.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`
            : '<div class="facts-empty">Nothing structured could be read from this item. Check the source below before deciding.</div>'
        }
      </div>

      ${
        item.relatedLinks?.length
          ? `<div class="section"><div class="section-title">Related in this batch</div><div class="related">${item.relatedLinks
              .map((l) => {
                const o = byId.get(l.id);
                return `<button type="button" class="related-link" data-goto="${esc(l.id)}"><span class="rid">${esc(l.id)}</span><span class="rsub">${esc(o?.displaySubject || '')}</span><span class="rwhy">${esc(l.label)}</span></button>`;
              })
              .join('')}</div></div>`
          : ''
      }

      <div class="section">
        <div class="section-title">Source <span class="hint"><span class="legend-sw"></span>Lines used as evidence</span></div>
        <pre class="raw-text">${renderRaw(item)}</pre>
      </div>

      <div class="section">
        <div class="section-title">Draft reply to customer <button type="button" class="btn ghost sm" id="copy-reply">Copy reply</button></div>
        <textarea id="detail-draft" class="draft" rows="5" aria-label="Draft reply">${esc(draft)}</textarea>
        <div class="draft-meta"><span id="draft-edited">${edited ? 'Edited by you' : 'Suggested draft. Edit before sending from your own inbox.'}</span><span id="draft-count">${draft.length} chars</span></div>
      </div>

      <div class="section" style="margin-bottom:12px">
        <div class="section-title">Internal note <span class="hint">Exported with the decision</span></div>
        <input id="detail-note" class="note-input" type="text" placeholder="e.g. Checked ledger, second capture confirmed" value="${esc(d.note || '')}" />
      </div>
    </div>

    <div class="decision-bar">
      <div class="decision-state">${
        d.status === 'pending'
          ? 'Waiting for your decision'
          : `${statusPill(d.status)} ${d.updatedAt ? `at ${esc(timeShort(d.updatedAt))}` : ''} · recorded only, nothing sent`
      }</div>
      <div class="decision-buttons">
        ${d.status !== 'pending' ? '<button type="button" class="btn ghost" data-decide="pending">Undo</button>' : ''}
        <button type="button" class="btn reject" data-decide="rejected">Reject <span class="kbd-hint">R</span></button>
        <button type="button" class="btn escalate" data-decide="escalated">Escalate <span class="kbd-hint">X</span></button>
        <button type="button" class="btn approve" data-decide="approved">Approve <span class="kbd-hint">A</span></button>
      </div>
    </div>`;
}

function selectItem(id) {
  if (!state.items.some((x) => x.id === id)) return;
  state.selectedId = id;
  saveSession();
  renderQueue();
  renderDetail();
}

function nextPendingAfter(id) {
  const items = sortItems(filterItems(state.items, decisions, { ...state.filters, status: '' }), state.filters.sort);
  const start = items.findIndex((i) => i.id === id);
  for (let n = 1; n <= items.length; n++) {
    const cand = items[(start + n) % items.length];
    if (cand.id !== id && decisionFor(decisions, cand.id).status === 'pending') return cand.id;
  }
  return null;
}

function setDecision(status) {
  const id = state.selectedId;
  const item = state.items.find((x) => x.id === id);
  if (!item) return;
  const prev = decisionFor(decisions, id);
  const draftEl = $('#detail-draft');
  const noteEl = $('#detail-note');
  const finalReply = draftEl ? draftEl.value : prev.finalReply;
  decisions[id] = {
    status,
    finalReply: finalReply || '',
    note: noteEl ? noteEl.value : prev.note || '',
    updatedAt: new Date().toISOString(),
  };
  saveDecisions();
  if (status === 'pending') {
    toast(`${id} moved back to review`);
    selectItem(id);
    return;
  }
  toast(`${id} ${STATUS_LABELS[status].toLowerCase()} · recorded only, nothing sent`);
  const next = nextPendingAfter(id);
  selectItem(next || id);
}

function moveSelection(delta) {
  const items = visibleItems();
  if (!items.length) return;
  let idx = items.findIndex((i) => i.id === state.selectedId);
  idx = idx === -1 ? 0 : (idx + delta + items.length) % items.length;
  selectItem(items[idx].id);
}

/* ---------------- triage ---------------- */

async function runTriage() {
  const text = $('#batch-input').value;
  setComposerError('');
  if (!text.trim()) {
    setComposerError('Nothing to triage yet', 'Paste at least one exception, upload a CSV/JSON/TXT file, or load the sample batch.');
    $('#batch-input').focus();
    return;
  }
  const btn = $('#triage-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  $('.btn-label', btn).textContent = 'Triaging…';
  renderLoading();
  const minDelay = new Promise((r) => setTimeout(r, 450));
  try {
    const res = await fetch('/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    await minDelay;
    if (!res.ok) {
      showView('intake');
      setComposerError("Couldn't triage this batch", data.error || `The server answered ${res.status}.`, res.status >= 500);
      return;
    }
    state.triageId = data.triageId;
    state.items = data.items || [];
    state.insights = data.insights;
    state.filters = { status: '', category: '', query: '', sort: 'priority' };
    $('#search').value = '';
    $('#filter-category').value = '';
    $('#sort-by').value = 'priority';
    decisions = loadDecisionsFor(state.triageId);
    state.selectedId = sortItems(state.items)[0]?.id || null;
    saveSession();
    showView('review');
    selectItem(state.selectedId);
    if (data.message) toast(data.message);
  } catch {
    await minDelay;
    showView('intake');
    setComposerError('Server not reachable', 'Exception Desk could not reach its local server. Check that npm start is still running in your terminal, then try again.', true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    $('.btn-label', btn).textContent = 'Triage batch';
  }
}

async function loadSample() {
  try {
    const res = await fetch('/api/sample');
    const data = await res.json();
    if (!res.ok || !data.text) throw new Error(data.error || 'Sample not found');
    state.sampleText = data.text;
    $('#batch-input').value = data.text;
    setComposerError('');
    updateInputStats();
    return true;
  } catch (err) {
    setComposerError("Couldn't load the sample batch", err.message || 'Is the server running?', true);
    return false;
  }
}

/* ---------------- export ---------------- */

function exportScope() {
  return document.querySelector('input[name="scope"]:checked')?.value === 'reviewed';
}

function renderExportPreview() {
  const k = computeKpis(state.items, decisions);
  $('#export-summary').innerHTML = [
    ['approved', 'Approved'],
    ['escalated', 'Escalated'],
    ['rejected', 'Rejected'],
    ['pending', 'Still to review'],
  ]
    .map(([key, label]) => `<div><b>${k[key]}</b><span>${label}</span></div>`)
    .join('');
  $('#scope-all-label').textContent = `All exceptions (${k.total})`;
  $('#scope-reviewed-label').textContent = `Reviewed only (${k.reviewed})`;
  const rows = buildCsvRows(state.items, decisions, { reviewedOnly: exportScope() });
  const head = '<tr><th>id</th><th>status</th><th>amount_usd</th><th>customer</th><th>final_reply</th><th>reviewer_note</th></tr>';
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td class="mono">${esc(r.id)}</td><td>${statusPill(r.status)}</td><td class="r">${esc(r.amount_usd)}</td><td>${esc(r.customer || r.email)}</td><td class="clip">${esc(r.final_reply)}</td><td class="clip">${esc(r.reviewer_note)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="muted">No reviewed items yet. Approve, escalate or reject at least one, or export all.</td></tr>';
  $('#export-preview').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $('#export-download').disabled = !rows.length;
  $('#export-filename').textContent = `${exportFilename()} · ${rows.length} row${rows.length === 1 ? '' : 's'} · 16 columns`;
}

function openExport() {
  if (!state.items.length) return;
  renderExportPreview();
  $('#export-dialog').showModal();
}

function downloadCsv() {
  const reviewedOnly = exportScope();
  const rows = buildCsvRows(state.items, decisions, { reviewedOnly });
  const csv = buildCsv(state.items, decisions, { reviewedOnly });
  const name = exportFilename();
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('#export-dialog').close();
  toast(`Exported ${rows.length} rows to ${name}`);
}

/* ---------------- mode ---------------- */

async function loadMode() {
  const el = $('#mode-badge');
  try {
    const data = await (await fetch('/api/mode')).json();
    const ai = data.mode === 'ai';
    $('.mode-text', el).textContent = ai ? data.label : 'Demo mode · rules engine';
    el.title = ai
      ? 'A model triages each item; batch checks and rules fallback still apply.'
      : 'No API key configured. Deterministic rules triage every item.';
    el.classList.toggle('ai', ai);
  } catch {
    $('.mode-text', el).textContent = 'Server offline';
  }
}

/* ---------------- events ---------------- */

$('#triage-btn').addEventListener('click', runTriage);
$('#composer-retry').addEventListener('click', runTriage);
$('#load-sample').addEventListener('click', loadSample);
$('#try-sample').addEventListener('click', async () => {
  if (await loadSample()) runTriage();
});
$('#batch-input').addEventListener('input', () => {
  updateInputStats();
  setComposerError('');
});
$('#file-upload').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setComposerError('File too large', 'Upload a file under 2 MB (up to 100 exceptions per batch).');
  } else {
    $('#batch-input').value = await file.text();
    updateInputStats();
    toast(`Loaded ${file.name}`);
  }
  e.target.value = '';
});

$('#new-batch').addEventListener('click', () => showView('intake'));
$('#brand-home').addEventListener('click', (e) => {
  e.preventDefault();
  showView('intake');
});

$('#status-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-status]');
  if (!tab) return;
  state.filters.status = tab.dataset.status;
  renderQueue();
});
$('#filter-category').addEventListener('change', (e) => {
  state.filters.category = e.target.value;
  renderQueue();
});
$('#sort-by').addEventListener('change', (e) => {
  state.filters.sort = e.target.value;
  renderQueue();
});
$('#search').addEventListener('input', (e) => {
  state.filters.query = e.target.value;
  renderQueue();
});

$('#queue-list').addEventListener('click', (e) => {
  const li = e.target.closest('.queue-item');
  if (li) selectItem(li.dataset.id);
});
$('#review-view').addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'clear-filters') {
    state.filters = { ...state.filters, status: '', category: '', query: '' };
    $('#search').value = '';
    $('#filter-category').value = '';
    renderQueue();
  } else if (t.dataset.action === 'export') openExport();
});

const detail = $('#detail');
detail.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) return selectItem(go.dataset.goto);
  const dec = e.target.closest('[data-decide]');
  if (dec) return setDecision(dec.dataset.decide);
  if (e.target.closest('#copy-reply')) {
    try {
      await navigator.clipboard.writeText($('#detail-draft').value);
      toast('Reply copied. Paste it into your email or helpdesk.');
    } catch {
      $('#detail-draft').select();
      toast('Clipboard blocked. The reply is selected, press Ctrl/Cmd+C.', true);
    }
  }
});
detail.addEventListener('input', (e) => {
  const id = state.selectedId;
  if (!id) return;
  const d = decisionFor(decisions, id);
  if (e.target.id === 'detail-draft') {
    decisions[id] = { ...d, status: d.status, finalReply: e.target.value };
    $('#draft-edited').textContent = 'Edited by you';
    $('#draft-count').textContent = `${e.target.value.length} chars`;
    saveDecisions();
  } else if (e.target.id === 'detail-note') {
    decisions[id] = { ...d, status: d.status, note: e.target.value };
    saveDecisions();
  }
});

$('#export-open').addEventListener('click', openExport);
$('#export-download').addEventListener('click', downloadCsv);
document.querySelectorAll('input[name="scope"]').forEach((r) => r.addEventListener('change', renderExportPreview));

document.addEventListener('keydown', (e) => {
  if ($('#export-dialog').open) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if ($('#review-view').classList.contains('hidden') || !state.items.length) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = {
    j: () => moveSelection(1),
    arrowdown: () => moveSelection(1),
    k: () => moveSelection(-1),
    arrowup: () => moveSelection(-1),
    a: () => setDecision('approved'),
    x: () => setDecision('escalated'),
    r: () => setDecision('rejected'),
    e: () => {
      const t = $('#detail-draft');
      if (!t) return;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    },
    '/': () => $('#search').focus(),
  };
  if (map[k]) {
    e.preventDefault();
    map[k]();
  }
});

/* ---------------- boot ---------------- */

// "Back to queue" shortcut on the intake screen when a triaged batch exists.
const back = document.createElement('button');
back.type = 'button';
back.id = 'back-to-queue';
back.className = 'btn ghost lg hidden';
back.textContent = 'Back to review queue';
back.addEventListener('click', () => {
  showView('review');
  renderQueue();
  renderDetail();
});
$('.hero-actions').insertBefore(back, $('.hero-note'));

loadMode();
updateInputStats();
if (restoreSession()) {
  showView('review');
  selectItem(state.selectedId);
} else {
  showView('intake');
}
