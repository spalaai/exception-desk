import {
  STATUS_LABELS,
  formatMoney,
  decisionFor,
  filterItems,
  sortItems,
  computeKpis,
  computeClosingSummary,
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
  isSample: false,
  showClosed: false,
  mode: null,
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
        triagedAt: state.triagedAt,
        isSample: state.isSample,
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
    state.triagedAt = saved.triagedAt || '';
    state.isSample = Boolean(saved.isSample);
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
  return '';
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
  $('#kpis').innerHTML = Array.from({ length: 5 }, () => '<div class="kpi"><div class="skeleton" style="height:10px;width:70px"></div><div class="skeleton" style="height:18px;width:60px;margin-top:6px"></div></div>').join('');
  $('#status-tabs').innerHTML = '';
  $('#batchbar-count').textContent = 'Triaging batch…';
  $('#batchbar-meta').textContent = '';
  $('#checks').classList.add('hidden');
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
  const avoided = state.items
    .filter((i) => i.batchCheck && (i.batchCheck.kind === 'refund_after_failed' || i.batchCheck.kind === 'duplicate_secondary'))
    .reduce((sum, i) => sum + (Number(i.displayAmount) || 0), 0);
  $('#kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">To review</div>
      <div class="kpi-value">${k.pending}<small> / ${k.total}</small></div>
      <div class="progress" title="${k.reviewed} of ${k.total} reviewed">
        <span class="seg-ok" style="width:${pct(k.approved)}%"></span><span class="seg-esc" style="width:${pct(k.escalated)}%"></span><span class="seg-rej" style="width:${pct(k.rejected)}%"></span>
      </div>
    </div>
    <div class="kpi ${k.p1Open ? 'alert-kpi' : ''}" title="Disputes, duplicate charges and amounts of $500 or more">
      <div class="kpi-label">P1 open</div>
      <div class="kpi-value">${k.p1Open}</div>
    </div>
    <div class="kpi" title="${k.pending} open item${k.pending === 1 ? '' : 's'}">
      <div class="kpi-label">Still in review</div>
      <div class="kpi-value">${formatMoney(k.openAmount, { blankZero: false })}</div>
    </div>
    <div class="kpi" title="Approved refunds for you to issue in your processor">
      <div class="kpi-label">Refunds approved</div>
      <div class="kpi-value">${formatMoney(k.approvedRefunds, { blankZero: false })}</div>
    </div>
    <div class="kpi kpi-good" title="Refunds the batch checks show are not due: a refund asked for a payment that never captured, and second reports of a duplicate charge. ${groups} related group${groups === 1 ? '' : 's'} in this batch.">
      <div class="kpi-label">Wrong refunds caught</div>
      <div class="kpi-value">${formatMoney(avoided, { blankZero: false })}</div>
    </div>`;
  renderBatchbar();
  renderChecks();
}

function renderBatchbar() {
  const n = state.items.length;
  $('#batchbar-count').textContent = `${n} exception${n === 1 ? '' : 's'} loaded`;
  const parts = [];
  if (state.triagedAt) parts.push(`triaged at ${timeShort(state.triagedAt)}`);
  const src = new Set(state.items.map((i) => i.source));
  parts.push(src.has('ai') ? 'AI triage with batch checks' : 'rules triage with batch checks');
  $('#batchbar-meta').textContent = ' · ' + parts.join(' · ');
}

function renderChecks() {
  const el = $('#checks');
  const leads = state.items.filter((i) => i.batchCheck && (i.batchCheck.kind === 'refund_after_failed' || i.batchCheck.kind === 'duplicate_primary'));
  const flagged = state.items.filter((i) => i.flags?.length);
  if (!leads.length && !flagged.length) {
    el.classList.add('hidden');
    return;
  }
  const chips = leads
    .map((i) => {
      const ids = i.batchCheck.ids.join(' ↔ ');
      const amt = formatMoney(i.displayAmount);
      return `<button type="button" class="check-chip" data-goto="${esc(i.id)}"><span class="check-ids">${esc(ids)}</span><span class="check-verdict">${esc(i.batchCheck.verdict)}</span>${amt ? `<span class="check-amt">${amt}</span>` : ''}</button>`;
    })
    .join('');
  const warn = flagged
    .map((i) => `<button type="button" class="check-chip warn" data-goto="${esc(i.id)}"><span class="check-ids">${esc(i.id)}</span><span class="check-verdict">Shipped but never paid</span></button>`)
    .join('');
  el.innerHTML = `<div class="checks-label"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span><strong>Batch checks</strong> ${leads.length} catch${leads.length === 1 ? '' : 'es'}${flagged.length ? ` · ${flagged.length} warning${flagged.length === 1 ? '' : 's'}` : ''}</span></div><div class="checks-chips">${chips}${warn}</div>`;
  el.classList.remove('hidden');
}

function dueShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    banner.innerHTML = `<span>All ${k.total} exceptions reviewed.</span><span class="banner-actions"><button type="button" class="btn ghost sm" data-action="show-closed">Batch summary</button><button type="button" class="btn ghost sm" data-action="export">Export CSV</button></span>`;
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
      const due = item.dueDate ? `<span class="tag due" title="Response deadline">Due ${esc(dueShort(item.dueDate))}</span>` : '';
      const flag = item.flags?.length ? `<span class="tag warn" title="${esc(item.flags[0])}">⚠ Check shipment</span>` : '';
      const mark =
        d.status === 'approved' ? '<span class="done-mark ok" aria-label="Approved">✓</span>'
        : d.status === 'rejected' ? '<span class="done-mark rej" aria-label="Rejected">✕</span>'
        : d.status === 'escalated' ? '<span class="done-mark esc" aria-label="Escalated">↑</span>' : '';
      const rel = item.relatedIds?.length
        ? `<span class="tag rel" title="Linked to ${esc(item.relatedIds.join(', '))}">↔ ${esc(item.relatedIds.join(', '))}</span>`
        : '';
      return `<li class="queue-item ${item.id === state.selectedId ? 'selected' : ''} ${d.status !== 'pending' ? 'done' : ''}" data-id="${esc(item.id)}" tabindex="-1">
        ${mark || `<span class="prio prio-${esc(item.priority)}">${esc(item.priority)}</span>`}
        <div class="q-main">
          <div class="q-top"><span class="q-id">${esc(item.id)}</span><span class="q-subject">${esc(item.displaySubject || item.suggestedAction || 'Exception')}</span></div>
          <div class="q-sub">${catTag(item.category)}${who ? `<span class="q-who">${esc(who)}</span>` : ''}${rel}${due}${flag}</div>
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
  const rawSignals = [...new Set(item.matchedSignals || [])];
  const signals = rawSignals.filter((x) => !rawSignals.some((y) => y !== x && y.includes(x)));
  const whyText = String(item.why || '')
    .replace(/^Batch check:[^.]*\.\s*/, '')
    .replace(/\s*Matched signals:[^]*$/, '')
    .trim();
  const draft = d.finalReply || item.draftReply || '';
  const edited = d.finalReply && d.finalReply !== item.draftReply;
  const who = [item.displayCustomer, item.displayEmail].filter(Boolean).join(' · ');
  const bc = item.batchCheck;
  const processor = item.replyKind === 'processor';

  dc.innerHTML = `
    <div class="detail-scroll">
      <div class="d-crumbs"><span class="prio prio-${esc(item.priority)}">${esc(item.priority)}</span>${catTag(item.category)}<span class="q-id">${esc(item.id)}</span>${statusPill(d.status)}${item.dueDate ? `<span class="tag due">Due ${esc(dueShort(item.dueDate))}</span>` : ''}</div>
      <div class="d-head">
        <div class="d-head-main">
          <p class="d-subject">${esc(item.displaySubject || 'Exception')}${who ? ` <span class="d-who">· ${esc(who)}</span>` : ''}</p>
          <h2 class="verdict">${esc(bc ? bc.verdict : item.suggestedAction)}</h2>
        </div>
        <div class="d-amount"><div class="v">${amt || '—'}</div><div class="l">${amt ? 'Amount in question' : 'No amount found'}</div></div>
      </div>
      ${(item.flags || []).map((f) => `<div class="flag"><strong>Check before replying.</strong> ${esc(f)}</div>`).join('')}
      <div class="rec ${bc ? 'rec-batch' : ''}">
        <div class="rec-label">${
          bc
            ? `<span class="badge-batch">✓ Batch check</span><span class="rec-src">Cross-checked with ${esc(bc.ids.filter((x) => x !== item.id).join(', '))} · deterministic</span>`
            : `<span>Why this suggestion</span><span class="conf ${conf < 60 ? 'low' : ''}" title="Signal match: how strongly the wording supports this category. It is a signal strength, not a probability.">${sourceTag(item.source)} Signal match ${conf}% <span class="conf-bar"><span style="width:${conf}%"></span></span></span>`
        }</div>
        ${bc ? `<p class="rec-detail">${esc(bc.detail)}</p>${item.suggestedAction !== bc.verdict ? `<p class="rec-why"><strong>Next step:</strong> ${esc(item.suggestedAction)}</p>` : ''}` : ''}
        ${bc ? '' : whyText ? `<p class="rec-why">${esc(whyText)}</p>` : ''}
        ${!bc && signals.length ? `<div class="signals">${signals.map((x) => `<span class="signal">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="section">
        <div class="section-title">Key facts <span class="hint">Pulled from the source text</span></div>
        ${
          facts.length
            ? `<dl class="facts">${facts
                .filter((f) => String(f.value || '').trim())
                .map((f, i, arr) => `<div class="fact ${i === arr.length - 1 && arr.length % 2 === 1 ? 'wide' : ''}"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`)
                .join('')}</dl>`
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
        <div class="section-title">${processor ? 'Dispute response for your processor' : 'Draft email to customer'} <button type="button" class="btn ghost sm" id="copy-reply">${processor ? 'Copy response' : 'Copy email'}</button></div>
        <div class="email">
          ${
            processor
              ? `<div class="email-row"><span>Submit via</span><b>Your card processor's dispute portal</b></div><div class="email-row"><span>Note</span><b class="muted-b">Not sent to the customer. Attach evidence before submitting.</b></div>`
              : `<div class="email-row"><span>To</span><b>${item.displayEmail ? esc(item.displayEmail) : '<em class="muted-b">No email in the source. Add the recipient when you send.</em>'}</b></div><div class="email-row"><span>Subject</span><b>Re: ${esc(item.displaySubject || 'Your payment')}</b></div>`
          }
          <textarea id="detail-draft" class="draft" rows="6" aria-label="Draft reply">${esc(draft)}</textarea>
        </div>
        <div class="draft-meta"><span id="draft-edited">${edited ? 'Edited by you' : processor ? 'Suggested response. Review it against your evidence.' : 'Suggested draft. Edit it, then send from your own inbox.'}</span><span id="draft-count">${draft.length} chars</span></div>
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
  if (!next && computeKpis(state.items, decisions).pending === 0) showClosed(true);
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
    state.triagedAt = new Date().toISOString();
    state.isSample = Boolean(state.sampleText) && text.trim() === state.sampleText.trim();
    showClosed(false);
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
    state.mode = data;
    $('.mode-text', el).textContent = ai ? data.label : data.pasteMock ? 'Demo mode · rules · paste box: mock AI' : 'Demo mode · rules engine';
    el.title = ai
      ? 'A model triages each item; batch checks and rules fallback still apply.'
      : 'No API key configured. Deterministic rules triage every item.';
    el.classList.toggle('ai', ai);
  } catch {
    $('.mode-text', el).textContent = 'Server offline';
  }
}

/* ---------------- batch closed ---------------- */

function dayLabel(isoDay) {
  if (!isoDay) return '';
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function minutesBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60000)) : 0;
}

function receiptLine(label, value, cls = '') {
  return `<div class="r-line ${cls}"><span class="r-label">${label}</span><span class="r-dots" aria-hidden="true"></span><span class="r-value">${value}</span></div>`;
}

function renderClosed() {
  const s = computeClosingSummary(state.items, decisions);
  const el = $('#closed-view');
  const closedAt = s.lastAt ? new Date(s.lastAt) : new Date();
  const stampDate = closedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const startAt = state.triagedAt || s.firstAt;
  const mins = startAt && s.lastAt ? minutesBetween(startAt, s.lastAt) : 0;
  const caughtSub = s.caught
    .map((c) => {
      const why = c.kind === 'refund_after_failed' ? 'payment never captured' : `second report of ${c.ids.find((x) => x !== c.id) || 'a duplicate'}`;
      return `<div class="r-sub">${esc(c.id)} · ${formatMoney(c.amount)} · ${esc(why)}</div>`;
    })
    .join('');
  const dlSub = s.deadlines
    .map((d) => `<div class="r-sub">${esc(d.id)} · due ${esc(dayLabel(d.dueDate))} · ${d.decidedDay ? `${esc(STATUS_LABELS[d.status].toLowerCase())} ${esc(dayLabel(d.decidedDay))}` : 'not decided'}${d.met ? ' · met' : d.decidedDay ? ' · late' : ''}</div>`)
    .join('');
  const label = state.isSample
    ? 'Sample data · 12 fictional cases · numbers computed from your decisions in this session'
    : 'Computed from this batch and your decisions in this browser session';
  el.innerHTML = `
    <div class="closed-wrap">
      <div class="receipt" role="group" aria-labelledby="closed-title">
        <div class="stamp" aria-hidden="true">
          <svg viewBox="0 0 220 120" width="168" height="92">
            <defs><filter id="ink"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter></defs>
            <g filter="url(#ink)" fill="none" stroke="currentColor">
              <rect x="6" y="6" width="208" height="108" rx="12" stroke-width="5"/>
              <rect x="15" y="15" width="190" height="90" rx="7" stroke-width="1.6"/>
              <text x="110" y="64" text-anchor="middle" font-size="40" font-weight="800" letter-spacing="6" fill="currentColor" stroke="none" font-family="ui-monospace, Menlo, monospace">CLOSED</text>
              <text x="110" y="90" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="3" fill="currentColor" stroke="none" font-family="ui-monospace, Menlo, monospace">${esc(stampDate)}</text>
            </g>
          </svg>
        </div>
        <div class="r-head">
          <div class="r-brand">Exception Desk</div>
          <h2 id="closed-title">Batch closed</h2>
          <div class="r-meta">${s.total} exceptions${startAt ? ` · triaged ${esc(timeShort(startAt))}` : ''}</div>${s.lastAt ? `<div class="r-meta">last decision ${esc(timeShort(s.lastAt))}</div>` : ''}${mins ? `<div class="r-meta">${mins} min on desk</div>` : ''}
        </div>
        <div class="r-rule"></div>
        ${receiptLine('Decisions made', `${s.decided}`)}
        <div class="r-sub">${s.approved} approved · ${s.escalated} escalated · ${s.rejected} rejected</div>
        ${receiptLine('Wrong refunds caught', formatMoney(s.caughtAmount, { blankZero: false }), 'good')}
        ${caughtSub || '<div class="r-sub">None in this batch</div>'}
        ${receiptLine('Deadlines met', s.deadlines.length ? `${s.deadlinesMet} of ${s.deadlines.length}` : '—')}
        ${dlSub || '<div class="r-sub">No response deadlines in this batch</div>'}
        ${receiptLine('Refunds to issue', formatMoney(s.approvedRefunds, { blankZero: false }))}
        <div class="r-sub">approved by you, to issue in your processor</div>
        <div class="r-rule"></div>
        <p class="r-foot">Records only. Nothing was sent and no money moved.</p>
        <p class="r-label-note">${esc(label)}</p>
      </div>
      <div class="closed-actions">
        <button type="button" class="btn primary" data-action="export">Export decisions (CSV)</button>
        <button type="button" class="btn ghost" data-action="hide-closed">Back to queue</button>
        <button type="button" class="btn ghost" data-action="new-batch">New batch</button>
      </div>
    </div>`;
}

function showClosed(on) {
  state.showClosed = on;
  if (on) renderClosed();
  $('#closed-view').classList.toggle('hidden', !on);
  $('#workspace').classList.toggle('hidden', on);
  $('#checks').classList.toggle('closed-mode', on);
}

/* ---------------- paste a new one ---------------- */

let pasteSamples = null;

function pasteEngineHint() {
  const m = state.mode;
  if (m?.mode === 'ai') return `${m.label} reads it · quotes checked against your paste`;
  if (m?.pasteMock) return 'Mock AI: canned reply, no API call · quotes checked against your paste';
  return 'Rules engine (no API key) · add a key for AI reading';
}

async function openPaste() {
  $('#paste-engine').textContent = pasteEngineHint();
  $('#paste-dialog').showModal();
  $('#paste-text').focus();
  if (!pasteSamples) {
    try {
      pasteSamples = (await (await fetch('/api/paste-samples')).json()).samples || {};
    } catch {
      pasteSamples = {};
    }
  }
}

const FACT_LABELS = [
  ['customer', 'Customer'],
  ['email', 'Email'],
  ['amount', 'Amount'],
  ['ref', 'Order / ref'],
  ['whatHappened', 'What happened'],
  ['wants', 'What they want'],
];

const SUPPORT_LABELS = { customer: 'customer', email: 'email', amount: 'amount', ref: 'ref', whatHappened: 'what happened', wants: 'what they want', link: 'link' };
const supLabel = (k) => String(k).split(/,\s*/).map((x) => SUPPORT_LABELS[x] || x).join(', ');

function renderPasteResult(r) {
  const el = $('#paste-result');
  const engine = r.source === 'ai' ? esc(r.engine) : r.source === 'mock-ai' ? 'Mock AI · canned reply' : r.source === 'rules-fallback' ? 'Rules fallback' : 'Rules engine';
  const lang = r.language && r.language !== 'en' ? `<span class="tag">Language: ${esc(r.language.toUpperCase())}</span>` : '';
  const facts = FACT_LABELS.filter(([k]) => r.facts[k] !== undefined && r.facts[k] !== '')
    .map(([k, label]) => {
      const v = k === 'amount' ? formatMoney(r.facts[k]) : r.facts[k];
      const sup = r.support?.[k];
      const badge = sup === 'in source' ? '<span class="vbadge" title="Found in the pasted message">✓ in source</span>' : sup === 'summary' ? '<span class="vbadge summary" title="Written by the model in English; check the quotes">summary</span>' : '';
      return `<div class="fact ${k === 'whatHappened' || k === 'wants' ? 'wide' : ''}"><dt>${label} ${badge}</dt><dd>${esc(v)}</dd></div>`;
    })
    .join('');

  let linkHtml;
  if (r.link) {
    const it = state.items.find((x) => x.id === r.link.id);
    const verdict = it ? it.batchCheck?.verdict || it.suggestedAction : '';
    const others = r.link.otherIds?.length ? `<span class="muted small">Also related: ${r.link.otherIds.map((x) => `<button type="button" class="link-btn" data-paste-goto="${esc(x)}">${esc(x)}</button>`).join(', ')}</span>` : '';
    linkHtml = `<div class="pr-link">
      <div class="pr-link-top"><span class="pr-kicker">Belongs to</span><button type="button" class="link-btn strong" data-paste-goto="${esc(r.link.id)}">${esc(r.link.id)}</button><span class="pr-link-subj">${esc(it?.displaySubject || '')}</span></div>
      <div class="pr-reasons">${r.link.reasons.map((x) => `<span class="tag rel">${esc(x)}</span>`).join('')}${r.link.basis === 'ai+check' ? '<span class="tag">model link, confirmed by the check</span>' : ''}</div>
      ${verdict ? `<div class="pr-verdict"><span class="muted small">Desk already says</span> ${esc(verdict)}</div>` : ''}
      ${others}
      <div class="pr-link-actions"><button type="button" class="btn primary sm" data-paste-goto="${esc(r.link.id)}">Open ${esc(r.link.id)}</button><button type="button" class="btn ghost sm" data-paste-note="${esc(r.link.id)}">Add to ${esc(r.link.id)} note</button></div>
    </div>`;
  } else {
    linkHtml = `<div class="pr-link none"><div class="pr-link-top"><span class="pr-kicker">No matching case in this batch</span></div><span class="muted small">Nothing in the queue shares its reference, or its email and amount. Treat it as a new case.</span></div>`;
  }
  const linkNote = r.linkNote ? `<div class="pr-drop-note">${esc(r.linkNote)}</div>` : '';

  const quotes = r.quotes.length
    ? r.quotes.map((q) => `<li><span class="vbadge">✓ Verified in source</span><q>${esc(q.text)}</q>${q.supports ? `<span class="q-sup">${esc(supLabel(q.supports))}</span>` : ''}</li>`).join('')
    : '<li class="muted small">No quotes.</li>';
  const droppedN = r.dropped.length + (r.droppedFacts?.length || 0);
  const dropped = droppedN
    ? `<div class="pr-section dropped"><h3>Dropped · ${droppedN} not found in your paste</h3><ul class="pr-quotes">${r.dropped
        .map((d) => `<li><span class="vbadge drop">✕ Not in source</span><q><s>${esc(d.text)}</s></q>${d.supports ? `<span class="q-sup">${esc(supLabel(d.supports))}</span>` : ''}</li>`)
        .join('')}${(r.droppedFacts || []).map((d) => `<li><span class="vbadge drop">✕ Not in source</span><span><s>${esc(supLabel(d.field))}: ${esc(String(d.value))}</s></span></li>`).join('')}</ul></div>`
    : '';
  const fallback = r.fallbackReason ? `<div class="pr-drop-note">${esc(r.fallbackReason)}</div>` : '';

  el.innerHTML = `
    <div class="pr-head"><span class="pill pill-mode ${r.source === 'ai' ? 'ai' : ''}"><span class="dot"></span>${engine}</span>${lang}</div>
    ${fallback}
    ${linkHtml}${linkNote}
    <div class="pr-section"><h3>Facts</h3><dl class="facts">${facts || '<div class="facts-empty">No facts found.</div>'}</dl></div>
    <div class="pr-section"><h3>Evidence · ${r.quotes.length} verified in source</h3><ul class="pr-quotes">${quotes}</ul></div>
    ${dropped}`;
  state.lastPaste = r;
}

async function runPasteExtract() {
  const text = $('#paste-text').value;
  if (!text.trim()) {
    toast('Paste a message first', true);
    $('#paste-text').focus();
    return;
  }
  const btn = $('#paste-run');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await fetch('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, cases: state.items.map((i) => ({ id: i.id, rawText: i.rawText, category: i.category })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('#paste-result').innerHTML = `<div class="alert error"><div class="alert-body"><strong>Couldn't read this message</strong><span>${esc(data.error || `The server answered ${res.status}.`)}</span></div></div>`;
      return;
    }
    renderPasteResult(data);
  } catch {
    $('#paste-result').innerHTML = '<div class="alert error"><div class="alert-body"><strong>Server not reachable</strong><span>Check that npm start is still running, then try again.</span></div></div>';
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

$('#paste-open').addEventListener('click', openPaste);
$('#paste-close').addEventListener('click', () => $('#paste-dialog').close());
$('#paste-run').addEventListener('click', runPasteExtract);
$('#paste-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runPasteExtract();
});
$('#paste-dialog').addEventListener('click', (e) => {
  const sample = e.target.closest('[data-paste-sample]');
  if (sample) {
    $('#paste-text').value = pasteSamples?.[sample.dataset.pasteSample] || '';
    $('#paste-text').focus();
    return;
  }
  const go = e.target.closest('[data-paste-goto]');
  if (go) {
    $('#paste-dialog').close();
    showClosed(false);
    state.filters.status = '';
    selectItem(go.dataset.pasteGoto);
    return;
  }
  const note = e.target.closest('[data-paste-note]');
  if (note && state.lastPaste) {
    const id = note.dataset.pasteNote;
    const f = state.lastPaste.facts;
    const line = `Follow-up message pasted ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}: ${[f.whatHappened, f.wants && `Wants: ${f.wants}`].filter(Boolean).join('. ')}.`;
    const d = decisionFor(decisions, id);
    decisions[id] = { ...d, status: d.status, note: d.note ? `${d.note}\n${line}` : line };
    saveDecisions();
    if (state.selectedId === id) renderDetail();
    toast(`Added to ${id} note`);
  }
});

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

$('#edit-batch').addEventListener('click', () => {
  showView('intake');
  $('#batch-input').focus();
});
$('#new-batch').addEventListener('click', () => {
  $('#batch-input').value = '';
  updateInputStats();
  setComposerError('');
  showView('intake');
  $('#batch-input').focus();
});
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
$('#checks').addEventListener('click', (e) => {
  const c = e.target.closest('[data-goto]');
  if (c) {
    state.filters.status = '';
    selectItem(c.dataset.goto);
  }
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
  else if (t.dataset.action === 'show-closed') showClosed(true);
  else if (t.dataset.action === 'hide-closed') showClosed(false);
  else if (t.dataset.action === 'new-batch') $('#new-batch').click();
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
      toast('Copied. Paste it into your email, helpdesk or processor portal.');
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
  if ($('#export-dialog').open || $('#paste-dialog').open) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if ($('#review-view').classList.contains('hidden') || !state.items.length || state.showClosed) return;
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

$('#clear-desk').addEventListener('click', () => {
  if (!confirm('Clear the stored queue and every decision in this browser? Export first if you need them.')) return;
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    delete all[state.triageId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  localStorage.removeItem(SESSION_KEY);
  state = { ...state, items: [], triageId: null, insights: null, selectedId: null };
  decisions = {};
  showClosed(false);
  $('#batch-input').value = '';
  updateInputStats();
  showView('intake');
  toast('Desk cleared');
});

loadMode();
updateInputStats();
if (restoreSession()) {
  showView('review');
  selectItem(state.selectedId);
  if (computeKpis(state.items, decisions).pending === 0) showClosed(true);
} else {
  showView('intake');
}
