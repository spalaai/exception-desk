const $ = (sel) => document.querySelector(sel);

const STORAGE_KEY = 'exception-desk-decisions';

/** @type {{ triageId?: string, items: any[], selectedId?: string }} */
let state = { items: [] };

/** @type {Record<string, { status: string, finalReply: string, updatedAt: string }>} */
let decisions = {};

function loadDecisionsForSession(triageId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw);
    return all[triageId] || {};
  } catch {
    return {};
  }
}

function saveDecisions() {
  if (!state.triageId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[state.triageId] = decisions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

function getDecision(itemId) {
  return decisions[itemId] || { status: 'pending', finalReply: '' };
}

function showBanner(text, isError = false) {
  const el = $('#banner');
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
}

async function loadMode() {
  const el = $('#mode-badge');
  try {
    const res = await fetch('/api/mode');
    const data = await res.json();
    el.textContent = data.label || 'Demo mode (rules)';
    el.classList.toggle('ai', data.mode === 'ai');
  } catch {
    el.textContent = 'Demo mode (rules)';
  }
}

function priorityClass(p) {
  return `priority-${p}`;
}

function filteredItems() {
  const cat = $('#filter-category').value;
  const status = $('#filter-status').value;
  return state.items.filter((item) => {
    if (cat && item.category !== cat) return false;
    const d = getDecision(item.id);
    if (status && d.status !== status) return false;
    return true;
  });
}

function updateSummary() {
  const bar = $('#summary-bar');
  if (!state.items.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const counts = { total: state.items.length, p1: 0, approved: 0, rejected: 0, pending: 0 };
  for (const item of state.items) {
    if (item.priority === 'P1') counts.p1++;
    const d = getDecision(item.id);
    counts[d.status]++;
  }
  bar.querySelector('[data-summary="total"]').textContent = `${counts.total} total`;
  bar.querySelector('[data-summary="p1"]').textContent = `${counts.p1} P1`;
  bar.querySelector('[data-summary="approved"]').textContent = `${counts.approved} approved`;
  bar.querySelector('[data-summary="rejected"]').textContent = `${counts.rejected} rejected`;
  bar.querySelector('[data-summary="pending"]').textContent = `${counts.pending} pending`;
}

function renderQueue() {
  const list = $('#queue-list');
  const empty = $('#queue-empty');
  const items = filteredItems();
  list.innerHTML = '';

  if (!state.items.length) {
    empty.textContent = 'Run triage to populate the queue.';
    empty.classList.remove('hidden');
    $('#export-csv').disabled = true;
    updateSummary();
    return;
  }

  empty.classList.add('hidden');
  $('#export-csv').disabled = false;

  if (!items.length) {
    empty.textContent = 'No items match the current filters.';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    if (item.id === state.selectedId) li.classList.add('selected');
    li.dataset.id = item.id;

    const d = getDecision(item.id);
    const statusChip =
      d.status !== 'pending'
        ? `<span class="chip status-${d.status}">${d.status}</span>`
        : `<span class="chip status-pending">pending</span>`;

    const related =
      item.relatedIds?.length
        ? `<span class="related-flag" title="Related items in batch">↔ ${item.relatedIds.length} related</span>`
        : '';

    li.innerHTML = `
      <div class="queue-item-top">
        <span class="chip ${priorityClass(item.priority)}">${item.priority}</span>
        <span class="chip category">${escapeHtml(item.category)}</span>
        ${statusChip}
        ${related}
      </div>
      <p class="queue-preview">${escapeHtml(item.suggestedAction)}</p>
    `;
    li.addEventListener('click', () => selectItem(item.id));
    list.appendChild(li);
  }

  updateSummary();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRawWithEvidence(item) {
  const lines = item.rawText.split(/\r?\n/);
  const evidence = new Set(item.evidenceLines || []);
  const parts = lines.map((line, i) => {
    const content = escapeHtml(line || ' ');
    if (evidence.has(i)) {
      return `<span class="evidence-line">${content}</span>`;
    }
    return content;
  });
  return parts.join('\n');
}

function selectItem(id) {
  state.selectedId = id;
  const item = state.items.find((x) => x.id === id);
  if (!item) return;

  $('#detail-empty').classList.add('hidden');
  const panel = $('#detail-content');
  panel.classList.remove('hidden');

  $('#detail-category').textContent = item.category;
  $('#detail-priority').textContent = item.priority;
  $('#detail-priority').className = `chip ${priorityClass(item.priority)}`;
  $('#detail-confidence').textContent = `Confidence: ${Math.round((item.confidence || 0) * 100)}%`;
  $('#detail-action').textContent = item.suggestedAction;
  $('#detail-why').textContent = item.why;

  const fb = $('#detail-fallback');
  if (item.fallback === 'rules') {
    fb.textContent = 'AI unavailable — rules fallback';
    fb.classList.remove('hidden');
  } else {
    fb.classList.add('hidden');
  }

  $('#detail-raw').innerHTML = renderRawWithEvidence(item);

  const d = getDecision(item.id);
  const draft = d.finalReply || item.draftReply || '';
  $('#detail-draft').value = draft;

  renderQueue();
}

function setDecision(status) {
  const id = state.selectedId;
  if (!id) return;
  const item = state.items.find((x) => x.id === id);
  const finalReply = $('#detail-draft').value.trim() || item?.draftReply || '';
  decisions[id] = {
    status,
    finalReply,
    updatedAt: new Date().toISOString(),
  };
  saveDecisions();
  renderQueue();
}

async function runTriage() {
  const text = $('#batch-input').value;
  showBanner('');
  $('#triage-btn').disabled = true;
  try {
    const res = await fetch('/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.error || 'Triage failed', true);
      return;
    }
    state.triageId = data.triageId;
    state.items = data.items || [];
    state.selectedId = state.items[0]?.id;
    decisions = {};
    saveDecisions();

    if (data.message) showBanner(data.message, false);

    renderQueue();
    if (state.selectedId) selectItem(state.selectedId);
    else {
      $('#detail-content').classList.add('hidden');
      $('#detail-empty').classList.remove('hidden');
    }
  } catch {
    showBanner('Could not reach the server. Is it running?', true);
  } finally {
    $('#triage-btn').disabled = false;
  }
}

function exportCsv() {
  const rows = [
    [
      'id',
      'priority',
      'category',
      'status',
      'suggested_action',
      'final_reply',
      'confidence',
      'why',
      'related_ids',
      'fallback',
    ],
  ];
  for (const item of state.items) {
    const d = getDecision(item.id);
    rows.push([
      item.id,
      item.priority,
      item.category,
      d.status,
      item.suggestedAction,
      d.finalReply || item.draftReply || '',
      String(item.confidence ?? ''),
      item.why,
      (item.relatedIds || []).join(';'),
      item.fallback || '',
    ]);
  }
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(',')
    )
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `exception-desk-decisions-${state.triageId || 'export'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadSample() {
  const res = await fetch('/api/sample');
  const data = await res.json();
  if (data.text) $('#batch-input').value = data.text;
}

$('#triage-btn').addEventListener('click', runTriage);
$('#load-sample').addEventListener('click', loadSample);
$('#filter-category').addEventListener('change', renderQueue);
$('#filter-status').addEventListener('change', renderQueue);
$('#approve-btn').addEventListener('click', () => setDecision('approved'));
$('#reject-btn').addEventListener('click', () => setDecision('rejected'));
$('#reset-btn').addEventListener('click', () => {
  const id = state.selectedId;
  if (id && decisions[id]) {
    delete decisions[id];
    saveDecisions();
    const item = state.items.find((x) => x.id === id);
    $('#detail-draft').value = item?.draftReply || '';
    renderQueue();
  }
});
$('#export-csv').addEventListener('click', exportCsv);
$('#copy-reply').addEventListener('click', async () => {
  const text = $('#detail-draft').value;
  try {
    await navigator.clipboard.writeText(text);
    showBanner('Draft copied to clipboard.');
    setTimeout(() => showBanner(''), 2000);
  } catch {
    showBanner('Could not copy — select the draft and copy manually.', true);
  }
});

$('#file-upload').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  $('#batch-input').value = text;
  e.target.value = '';
});

$('#detail-draft').addEventListener('input', () => {
  const id = state.selectedId;
  if (!id) return;
  const d = getDecision(id);
  if (d.status === 'pending') {
    decisions[id] = { ...d, finalReply: $('#detail-draft').value, updatedAt: new Date().toISOString() };
    saveDecisions();
  }
});

loadMode();
renderQueue();
