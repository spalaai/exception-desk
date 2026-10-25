const $ = (sel) => document.querySelector(sel);

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

loadMode();
