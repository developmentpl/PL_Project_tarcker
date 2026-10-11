// Shared UI helpers: DOM, escaping, toast, modal, live timers, formatting
const UI = {
  el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  },

  esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  },

  toast(msg, type = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type === 'err' ? 'err' : 'ok'}`;
    setTimeout(() => (t.className = 'toast hidden'), 2800);
  },

  statusBadge(name, isCompleted, isReopen) {
    const cls = isCompleted ? 'completed' : isReopen ? 'reopen' : '';
    return `<span class="badge ${cls}"><span class="dot"></span>${UI.esc(name)}</span>`;
  },

  // Parse a server timestamp. Date-only -> local midnight; datetime -> UTC.
  parseTime(s) {
    if (!s) return null;
    if (s.length <= 10) return new Date(s + 'T00:00:00');
    return new Date(s.replace(' ', 'T') + 'Z');
  },

  fmtDate(iso) {
    const d = UI.parseTime(iso);
    if (!d || isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  },
  fmtDateTime(iso) {
    const d = UI.parseTime(iso);
    if (!d || isNaN(d)) return '—';
    return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  // Elapsed string from a start time to now: "5d 03h 12m 45s"
  elapsed(startISO) {
    const start = UI.parseTime(startISO);
    if (!start || isNaN(start)) return '—';
    let s = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d}<span class="u">d</span> ${p2(h)}<span class="u">h</span> ${p2(m)}<span class="u">m</span> ${p2(s)}<span class="u">s</span>`;
  },

  // Compact duration for finished intervals (seconds -> "3d 4h")
  humanDuration(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },

  liveTimer(startISO) {
    return `<span class="live-timer" data-start="${UI.esc(startISO)}">${UI.elapsed(startISO)}</span>`;
  },

  startTicker() {
    if (UI._ticker) return;
    UI._ticker = setInterval(() => {
      document.querySelectorAll('.live-timer').forEach((n) => {
        n.innerHTML = UI.elapsed(n.dataset.start);
      });
    }, 1000);
  },

  // Value for <input type="datetime-local"> representing "now" (local)
  nowLocalInput() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  },
  // Convert a datetime-local value (local) -> server UTC "YYYY-MM-DD HH:MM:SS"
  localInputToServer(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d)) return null;
    return d.toISOString().replace('T', ' ').slice(0, 19);
  },

  // ---- Modal ----
  openModal({ title, body, footer, wide = false, narrow = false }) {
    UI.closeModal();
    const overlay = UI.el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) UI.closeModal(); } });
    const modal = UI.el('div', { class: 'modal' + (wide ? ' wide' : '') + (narrow ? ' narrow' : '') });
    modal.appendChild(UI.el('div', { class: 'modal-head' }, [
      UI.el('h3', {}, title),
      UI.el('button', { class: 'close-x', onclick: UI.closeModal, html: '&times;' }),
    ]));
    const bodyNode = UI.el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyNode.innerHTML = body; else bodyNode.appendChild(body);
    modal.appendChild(bodyNode);
    if (footer) {
      const foot = UI.el('div', { class: 'modal-foot' });
      (Array.isArray(footer) ? footer : [footer]).forEach((f) => foot.appendChild(f));
      modal.appendChild(foot);
    }
    overlay.appendChild(modal);
    document.getElementById('modal-root').appendChild(overlay);
    document.addEventListener('keydown', UI._escHandler);
    return { overlay, modal, bodyNode };
  },
  closeModal() {
    const cb = UI._onClose; UI._onClose = null;
    document.getElementById('modal-root').innerHTML = '';
    document.removeEventListener('keydown', UI._escHandler);
    if (typeof cb === 'function') cb();
  },
  _escHandler(e) { if (e.key === 'Escape') UI.closeModal(); },

  confirm(message, onYes, { danger = true, yesLabel = 'Delete' } = {}) {
    const yes = UI.el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { UI.closeModal(); onYes(); } }, yesLabel);
    const no = UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel');
    UI.openModal({ title: 'Please confirm', narrow: true, body: `<p style="margin:0;line-height:1.5">${UI.esc(message)}</p>`, footer: [no, yes] });
  },
};
