// Logs view — full activity log with search, action filter and pagination
const Logs = {
  state: { search: '', action: '', page: 1, pageSize: 50 },

  async render(container) {
    this.container = container;
    container.innerHTML = '';
    container.appendChild(UI.el('div', { class: 'page-head' }, [
      UI.el('div', {}, [UI.el('h2', {}, 'Activity Logs'), UI.el('p', { class: 'muted' }, 'Every change made in the tracker, most recent first.')]),
    ]));

    const actionSel = UI.el('select', { onchange: (e) => { this.state.action = e.target.value; this.state.page = 1; this.load(); } });
    [['', 'All actions'], ['created', 'Created'], ['updated', 'Updated'], ['deleted', 'Deleted'],
     ['status', 'Status change'], ['transfer', 'Sub-owner transfer'], ['reorder', 'Reorder'], ['login', 'Login']]
      .forEach(([v, l]) => actionSel.appendChild(UI.el('option', { value: v }, l)));
    actionSel.value = this.state.action;

    const searchInput = UI.el('input', { type: 'search', placeholder: 'Search name, detail, entity…', value: this.state.search,
      oninput: this.debounce((e) => { this.state.search = e.target.value.trim(); this.state.page = 1; this.load(); }, 250) });

    const sizeSel = UI.el('select', { onchange: (e) => { this.state.pageSize = Number(e.target.value); this.state.page = 1; this.load(); } });
    [25, 50, 100, 200].forEach((n) => sizeSel.appendChild(UI.el('option', { value: n }, String(n))));
    sizeSel.value = String(this.state.pageSize);

    container.appendChild(UI.el('div', { class: 'filters' }, [
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Action'), actionSel]),
      UI.el('div', { class: 'field grow' }, [UI.el('label', {}, 'Search'), searchInput]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Per page'), sizeSel]),
    ]));

    this.tableHost = UI.el('div', {});
    container.appendChild(this.tableHost);
    this.pagerHost = UI.el('div', {});
    container.appendChild(this.pagerHost);
    await this.load();
  },

  async load() {
    this.tableHost.innerHTML = '<div class="empty">Loading…</div>';
    this.pagerHost.innerHTML = '';
    try {
      const offset = (this.state.page - 1) * this.state.pageSize;
      const res = await API.getLogs({ search: this.state.search, action: this.state.action, limit: this.state.pageSize, offset });
      this.render_table(res.items || [], res.total || 0);
    } catch (e) {
      this.tableHost.innerHTML = `<div class="empty">Error: ${UI.esc(e.message)}</div>`;
    }
  },

  actionBadge(a) {
    const map = { created: 'completed', updated: 'cat', deleted: 'reopen', status: '', transfer: 'person', reorder: 'person', login: 'cat' };
    const cls = map[a] != null ? map[a] : '';
    return `<span class="badge ${cls}">${UI.esc(a)}</span>`;
  },

  render_table(items, total) {
    this.tableHost.innerHTML = '';
    if (!total) { this.tableHost.appendChild(UI.el('div', { class: 'table-wrap' }, [UI.el('div', { class: 'empty' }, 'No log entries.')])); return; }
    const thead = UI.el('thead', {}, [UI.el('tr', {}, ['When', 'Action', 'Type', 'Item', 'Detail'].map((h) => UI.el('th', {}, h)))]);
    const tbody = UI.el('tbody');
    items.forEach((l) => tbody.appendChild(UI.el('tr', {}, [
      UI.el('td', { class: 'muted', style: 'white-space:nowrap' }, UI.fmtDateTime(l.ts)),
      UI.el('td', { html: this.actionBadge(l.action) }),
      UI.el('td', { style: 'text-transform:capitalize' }, l.entity),
      UI.el('td', {}, [UI.el('span', { class: 'proj-name' }, l.name || '—')]),
      UI.el('td', { class: 'muted' }, l.detail || ''),
    ])));
    this.tableHost.appendChild(UI.el('div', { class: 'table-wrap' }, [UI.el('table', {}, [thead, tbody])]));

    const pages = Math.max(1, Math.ceil(total / this.state.pageSize));
    const start = (this.state.page - 1) * this.state.pageSize;
    const prev = UI.el('button', { class: 'btn sm', disabled: this.state.page <= 1 ? 'true' : null, onclick: () => { this.state.page--; this.load(); } }, '‹ Prev');
    const next = UI.el('button', { class: 'btn sm', disabled: this.state.page >= pages ? 'true' : null, onclick: () => { this.state.page++; this.load(); } }, 'Next ›');
    this.pagerHost.innerHTML = '';
    this.pagerHost.appendChild(UI.el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;flex-wrap:wrap' }, [
      UI.el('span', { class: 'muted', style: 'font-size:13px' }, `Showing ${start + 1}–${start + items.length} of ${total}`),
      UI.el('div', { style: 'display:flex;align-items:center;gap:8px' }, [prev, UI.el('span', { class: 'muted', style: 'font-size:13px' }, `Page ${this.state.page} / ${pages}`), next]),
    ]));
  },

  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
};
