// Dashboard + Completed views
const Dashboard = {
  state: { category_id: '', status_id: '', sub_owner_id: '', search: '', search_in: 'all', sort: 'age_desc', completed: '0', page: 1, pageSize: 25 },

  async render(container, mode) {
    this.mode = mode;
    this.state.completed = mode === 'completed' ? '1' : '0';
    this.state.page = 1;
    this.container = container;
    container.innerHTML = '';

    container.appendChild(UI.el('div', { class: 'page-head' }, [
      UI.el('div', {}, [
        UI.el('h2', {}, mode === 'completed' ? 'Completed Projects' : 'Project Dashboard'),
        UI.el('p', { class: 'muted' }, mode === 'completed'
          ? 'Finished projects — pull one back to reopen for corrections or updates.'
          : 'Active projects, longest-running at the top. Timers update live.'),
      ]),
    ]));

    if (mode === 'active') { this.statRow = UI.el('div', { class: 'stat-row' }); container.appendChild(this.statRow); }
    container.appendChild(await this.buildFilters());
    this.tableHost = UI.el('div', {});
    container.appendChild(this.tableHost);
    this.pagerHost = UI.el('div', {});
    container.appendChild(this.pagerHost);
    await this.loadData();
  },

  async buildFilters() {
    const [cats, people] = [await Store.categories(), await Store.people()];

    const catSel = UI.el('select', { onchange: async (e) => {
      this.state.category_id = e.target.value; this.state.status_id = '';
      await this.refreshStatusFilter(); this.reload();
    }});
    catSel.appendChild(UI.el('option', { value: '' }, 'All categories'));
    cats.forEach((c) => catSel.appendChild(UI.el('option', { value: c.id }, c.name)));
    catSel.value = this.state.category_id;

    this.statusSel = UI.el('select', { onchange: (e) => { this.state.status_id = e.target.value; this.reload(); } });
    await this.refreshStatusFilter();

    const subSel = UI.el('select', { onchange: (e) => { this.state.sub_owner_id = e.target.value; this.reload(); } });
    subSel.appendChild(UI.el('option', { value: '' }, 'All sub-owners'));
    people.forEach((p) => subSel.appendChild(UI.el('option', { value: p.id }, p.name)));
    subSel.value = this.state.sub_owner_id;

    const sortSel = UI.el('select', { onchange: (e) => { this.state.sort = e.target.value; this.reload(); } });
    [['age_desc', 'Longest running'], ['age_asc', 'Newest first'], ['name', 'Name A–Z'],
     ['status_days_desc', 'Longest in status'], ['recent', 'Recently added'], ['complete_days_desc', 'Days to complete']]
      .forEach(([v, l]) => sortSel.appendChild(UI.el('option', { value: v }, l)));
    sortSel.value = this.state.sort;

    const searchInSel = UI.el('select', { onchange: (e) => { this.state.search_in = e.target.value; if (this.state.search) this.reload(); } });
    [['all', 'All fields'], ['name', 'Name'], ['number', 'Number'], ['company', 'Company'], ['client', 'Client']]
      .forEach(([v, l]) => searchInSel.appendChild(UI.el('option', { value: v }, l)));
    searchInSel.value = this.state.search_in;

    const searchInput = UI.el('input', { type: 'search', placeholder: 'Search…', value: this.state.search,
      oninput: this.debounce((e) => { this.state.search = e.target.value.trim(); this.reload(); }, 250) });

    const clearBtn = UI.el('button', { class: 'btn subtle', onclick: () => {
      this.state = { ...this.state, category_id: '', status_id: '', sub_owner_id: '', search: '', search_in: 'all', sort: 'age_desc', page: 1 };
      this.render(this.container, this.mode);
    }}, 'Reset');

    return UI.el('div', { class: 'filters' }, [
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Category'), catSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Status'), this.statusSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Sub-owner'), subSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Sort by'), sortSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Search in'), searchInSel]),
      UI.el('div', { class: 'field grow' }, [UI.el('label', {}, 'Search'), searchInput]),
      UI.el('div', { class: 'field' }, [UI.el('label', { html: '&nbsp;' }), clearBtn]),
    ]);
  },

  async refreshStatusFilter() {
    if (!this.statusSel) return;
    this.statusSel.innerHTML = '';
    this.statusSel.appendChild(UI.el('option', { value: '' }, 'All statuses'));
    let statuses;
    if (this.state.category_id) statuses = await Store.statuses(this.state.category_id);
    else {
      const all = await Store.allStatuses(); const seen = new Set(); statuses = [];
      all.forEach((s) => { if (!seen.has(s.name)) { seen.add(s.name); statuses.push(s); } });
    }
    statuses.forEach((s) => this.statusSel.appendChild(UI.el('option', { value: s.id }, s.name)));
    this.statusSel.value = this.state.status_id;
  },

  reload() { this.state.page = 1; this.loadData(); },

  async loadData() {
    this.tableHost.innerHTML = '<div class="empty">Loading…</div>';
    this.pagerHost.innerHTML = '';
    try {
      const res = await API.getProjects({
        category_id: this.state.category_id, status_id: this.state.status_id, sub_owner_id: this.state.sub_owner_id,
        search: this.state.search, search_in: this.state.search_in, sort: this.state.sort,
        completed: this.state.completed, limit: 'all',
      });
      this.rows = res.items || [];
      if (this.mode === 'active') this.renderStats(this.rows);
      this.renderPage();
    } catch (e) {
      this.tableHost.innerHTML = `<div class="empty">Error: ${UI.esc(e.message)}</div>`;
    }
  },

  renderPage() {
    const total = this.rows.length;
    const size = this.state.pageSize === 'all' ? total || 1 : this.state.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    if (this.state.page > pages) this.state.page = pages;
    const start = (this.state.page - 1) * size;
    const pageRows = this.state.pageSize === 'all' ? this.rows : this.rows.slice(start, start + size);

    this.tableHost.innerHTML = '';
    this.tableHost.appendChild(this.buildTable(pageRows));
    this.renderPager(total, size, pages, start, pageRows.length);
  },

  renderPager(total, size, pages, start, shown) {
    this.pagerHost.innerHTML = '';
    if (!total) return;
    const sizeSel = UI.el('select', { onchange: (e) => { this.state.pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value); this.state.page = 1; this.renderPage(); } });
    [10, 25, 50, 100, 'all'].forEach((n) => sizeSel.appendChild(UI.el('option', { value: n }, n === 'all' ? 'All' : String(n))));
    sizeSel.value = String(this.state.pageSize);

    const prev = UI.el('button', { class: 'btn sm', disabled: this.state.page <= 1 ? 'true' : null, onclick: () => { this.state.page--; this.renderPage(); } }, '‹ Prev');
    const next = UI.el('button', { class: 'btn sm', disabled: this.state.page >= pages ? 'true' : null, onclick: () => { this.state.page++; this.renderPage(); } }, 'Next ›');
    const info = UI.el('span', { class: 'muted', style: 'font-size:13px' },
      `Showing ${total ? start + 1 : 0}–${start + shown} of ${total}`);

    this.pagerHost.appendChild(UI.el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;flex-wrap:wrap' }, [
      UI.el('div', { style: 'display:flex;align-items:center;gap:8px' }, [UI.el('span', { class: 'muted', style: 'font-size:13px' }, 'Per page'), sizeSel, info]),
      UI.el('div', { style: 'display:flex;align-items:center;gap:8px' }, [prev, UI.el('span', { class: 'muted', style: 'font-size:13px' }, `Page ${this.state.page} / ${pages}`), next]),
    ]));
  },

  renderStats(rows) {
    if (!this.statRow) return;
    const total = rows.length;
    const longest = rows.reduce((m, p) => Math.max(m, p.days_from_start), 0);
    const paused = rows.filter((p) => /paus/i.test(p.status_name)).length;
    const avg = total ? Math.round(rows.reduce((a, p) => a + p.days_from_start, 0) / total) : 0;
    this.statRow.innerHTML = '';
    [['Active projects', total, true], ['Longest running', `${longest} d`, false], ['Avg. age', `${avg} d`, false], ['Paused', paused, false]]
      .forEach(([label, value, accent]) => this.statRow.appendChild(UI.el('div', { class: 'stat-card' }, [
        UI.el('div', { class: 'label' }, label), UI.el('div', { class: 'value' + (accent ? ' accent' : '') }, String(value)),
      ])));
  },

  buildTable(projects) {
    if (!projects.length) {
      return UI.el('div', { class: 'table-wrap' }, [UI.el('div', { class: 'empty' },
        this.mode === 'completed' ? 'No completed projects yet.' : 'No projects match these filters.')]);
    }
    const cols = ['#', 'Project', 'Category', 'Sub-owner', 'Status', 'Time from start', 'Time in status', 'Days to complete', ''];
    const thead = UI.el('thead', {}, [UI.el('tr', {}, cols.map((h) => UI.el('th', {}, h)))]);
    const tbody = UI.el('tbody');
    const base = this.state.pageSize === 'all' ? 0 : (this.state.page - 1) * this.state.pageSize;

    projects.forEach((p, i) => {
      const sub = [p.project_number ? `#${p.project_number}` : null, p.company_name, p.client_name].filter(Boolean).join(' · ') || '—';
      tbody.appendChild(UI.el('tr', {}, [
        UI.el('td', { class: 'rank' }, String(base + i + 1)),
        UI.el('td', {}, [UI.el('div', { class: 'proj-name' }, p.project_name), UI.el('div', { class: 'proj-sub' }, sub)]),
        UI.el('td', {}, [UI.el('span', { class: 'badge cat' }, p.category_name)]),
        UI.el('td', { html: p.sub_owner_name ? `<span class="badge person">${UI.esc(p.sub_owner_name)}</span>` : '<span class="dash">—</span>' }),
        UI.el('td', { html: UI.statusBadge(p.status_name, p.is_completed, p.is_reopen) }),
        UI.el('td', { class: 'num-cell', html: UI.liveTimer(p.project_date) }),
        UI.el('td', { class: 'num-cell', html: p.is_completed ? `<span class="dash">—</span>` : UI.liveTimer(p.status_since) }),
        UI.el('td', { class: 'num-cell', html: p.days_to_complete != null ? `<span class="days-pill">${p.days_to_complete} <small>days</small></span>` : '<span class="dash">—</span>' }),
        UI.el('td', {}, [this.rowActions(p)]),
      ]));
    });
    return UI.el('div', { class: 'table-wrap' }, [UI.el('table', {}, [thead, tbody])]);
  },

  rowActions(p) {
    const wrap = UI.el('div', { class: 'row-actions' });
    wrap.appendChild(UI.el('button', { class: 'btn subtle sm', onclick: () => this.viewDetails(p.id) }, 'View'));
    if (this.mode === 'completed') {
      wrap.appendChild(UI.el('button', { class: 'btn sm', title: 'Reopen', onclick: () => Auth.require(() => this.pullBack(p)) }, '↩ Pull back'));
    } else {
      wrap.appendChild(UI.el('button', { class: 'btn subtle sm', onclick: () => Auth.require(() => this.quickStatus(p)) }, 'Status'));
      wrap.appendChild(UI.el('button', { class: 'btn subtle sm', title: 'Transfer sub-owner', onclick: () => Auth.require(() => this.transfer(p)) }, 'Transfer'));
    }
    return wrap;
  },

  async viewDetails(id) {
    try {
      const p = await API.getProject(id);
      const rows = [
        ['Unique ID', p.id], ['Category', p.category_name], ['Project number', p.project_number || '—'],
        ['Project name', p.project_name], ['Start date', UI.fmtDate(p.project_date)],
        ['Company', p.company_name || '—'], ['Client', p.client_name || '—'],
        ['Owner', p.owner_name || '—'], ['Sub-owner', p.sub_owner_name || '—'],
        ['Current status', p.status_name], ['In status since', UI.fmtDateTime(p.status_since)],
        ['Days to complete', p.days_to_complete != null ? String(p.days_to_complete) : 'In progress'],
      ];
      const dl = rows.map(([k, v]) =>
        `<div style="display:flex;padding:8px 0;border-bottom:1px solid var(--border)">
           <div style="width:190px;color:var(--text-muted);font-weight:600">${UI.esc(k)}</div>
           <div style="flex:1">${UI.esc(v)}</div></div>`).join('');
      const hist = (p.statusHistory || []).map((h) =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border)">
           <span>${UI.statusBadge(h.status_name)}</span>
           <span style="color:var(--text-muted)">${UI.fmtDateTime(h.changed_at)}</span></div>`).join('');
      const tl = (p.subOwnerTimeline || []).map((t, i, arr) => {
        const dur = t.to ? UI.humanDuration(t.seconds) : UI.humanDuration(t.seconds) + ' (ongoing)';
        const chips = (t.statuses || []).map((s) => `<span class="badge person">${UI.esc(s)}</span>`).join('');
        return `<div class="tl-item">
            <div class="tl-rail"><div class="tl-dot"></div>${i < arr.length - 1 ? '<div class="tl-line"></div>' : ''}</div>
            <div class="tl-body">
              <div class="tl-title">${UI.esc(t.person_name)}</div>
              <div class="tl-meta">${UI.fmtDateTime(t.from)} → ${t.to ? UI.fmtDateTime(t.to) : 'now'} · <b>${dur}</b></div>
              ${chips ? `<div class="tl-chips">${chips}</div>` : ''}
            </div></div>`;
      }).join('');
      const body =
        `<div>${dl}</div>
         ${p.description ? `<div style="margin-top:14px"><div style="color:var(--text-muted);font-weight:600;margin-bottom:4px">Description</div><div style="line-height:1.5">${UI.esc(p.description)}</div></div>` : ''}
         <div style="margin-top:18px"><div style="color:var(--text-muted);font-weight:700;margin-bottom:8px;text-transform:uppercase;font-size:11px;letter-spacing:.5px">Sub-owner timeline</div>
           <div class="timeline">${tl || '<div class="muted">No sub-owner assigned yet.</div>'}</div></div>
         <div style="margin-top:18px"><div style="color:var(--text-muted);font-weight:700;margin-bottom:6px;text-transform:uppercase;font-size:11px;letter-spacing:.5px">Status history</div>${hist || '<div class="muted">No history</div>'}</div>`;
      UI.openModal({ title: p.project_name, wide: true, body, footer: UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Close') });
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  // Status change with date/time (defaults to now, editable)
  async quickStatus(p) {
    const statuses = await Store.statuses(p.category_id);
    const sel = UI.el('select', {}); statuses.forEach((s) => sel.appendChild(UI.el('option', { value: s.id }, s.name))); sel.value = p.status_id;
    const when = UI.el('input', { type: 'datetime-local', value: UI.nowLocalInput() });
    const nowBtn = UI.el('button', { class: 'btn sm', type: 'button', onclick: () => { when.value = UI.nowLocalInput(); } }, 'Now');
    const save = UI.el('button', { class: 'btn primary', onclick: async () => {
      try { await API.setStatus(p.id, sel.value, UI.localInputToServer(when.value)); UI.closeModal(); UI.toast('Status updated'); this.loadData(); Store.invalidate(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, 'Update status');
    UI.openModal({
      title: `Change status — ${p.project_name}`,
      body: UI.el('div', {}, [
        UI.el('div', { class: 'field', style: 'margin-bottom:14px' }, [UI.el('label', {}, 'New status'), sel]),
        UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Changed on'), UI.el('div', { style: 'display:flex;gap:8px' }, [when, nowBtn])]),
        UI.el('p', { class: 'hint' }, 'Defaults to the current date & time — adjust it to back-date the change if needed.'),
      ]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'), save],
    });
  },

  async pullBack(p) {
    const statuses = await Store.statuses(p.category_id);
    const reopen = statuses.filter((s) => s.is_reopen);
    if (!reopen.length) return UI.toast('No pull-back statuses configured for this category. Add one in Admin.', 'err');
    const sel = UI.el('select', {}); reopen.forEach((s) => sel.appendChild(UI.el('option', { value: s.id }, s.name)));
    const when = UI.el('input', { type: 'datetime-local', value: UI.nowLocalInput() });
    const nowBtn = UI.el('button', { class: 'btn sm', type: 'button', onclick: () => { when.value = UI.nowLocalInput(); } }, 'Now');
    const save = UI.el('button', { class: 'btn primary', onclick: async () => {
      try { await API.setStatus(p.id, sel.value, UI.localInputToServer(when.value)); UI.closeModal(); UI.toast('Project pulled back'); this.loadData(); Store.invalidate(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, 'Pull back');
    UI.openModal({
      title: `Pull back — ${p.project_name}`,
      body: UI.el('div', {}, [
        UI.el('p', { class: 'hint', style: 'margin-top:0' }, 'Reopen this completed project into a correction / updates status.'),
        UI.el('div', { class: 'field', style: 'margin-bottom:14px' }, [UI.el('label', {}, 'Reopen as'), sel]),
        UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Effective from'), UI.el('div', { style: 'display:flex;gap:8px' }, [when, nowBtn])]),
      ]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'), save],
    });
  },

  async transfer(p) {
    const people = await Store.people();
    const sel = UI.el('select', {});
    sel.appendChild(UI.el('option', { value: '' }, '— Unassigned —'));
    people.forEach((pe) => sel.appendChild(UI.el('option', { value: pe.id }, pe.name)));
    sel.value = p.sub_owner_id || '';
    const when = UI.el('input', { type: 'datetime-local', value: UI.nowLocalInput() });
    const nowBtn = UI.el('button', { class: 'btn sm', type: 'button', onclick: () => { when.value = UI.nowLocalInput(); } }, 'Now');
    const save = UI.el('button', { class: 'btn primary', onclick: async () => {
      try { await API.transferSubOwner(p.id, sel.value || null, UI.localInputToServer(when.value)); UI.closeModal(); UI.toast('Sub-owner transferred'); this.loadData(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, 'Transfer');
    UI.openModal({
      title: `Transfer sub-owner — ${p.project_name}`,
      body: UI.el('div', {}, [
        UI.el('p', { class: 'hint', style: 'margin-top:0' }, `Current: ${UI.esc(p.sub_owner_name || 'Unassigned')}. Time is tracked per sub-owner from the handover moment.`),
        UI.el('div', { class: 'field', style: 'margin-bottom:14px' }, [UI.el('label', {}, 'New sub-owner'), sel]),
        UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Handover on'), UI.el('div', { style: 'display:flex;gap:8px' }, [when, nowBtn])]),
      ]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'), save],
    });
  },

  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
};
