// Admin view: projects, categories, statuses (ordered), people
const Admin = {
  async render(container) {
    this.container = container;
    container.innerHTML = '';
    container.appendChild(UI.el('div', { class: 'page-head' }, [
      UI.el('div', {}, [UI.el('h2', {}, 'Admin'), UI.el('p', { class: 'muted' }, 'Manage projects, categories, statuses and people.')]),
      UI.el('button', { class: 'btn primary', onclick: () => this.projectForm(null) }, '+ New Project'),
    ]));
    this.grid = UI.el('div', { class: 'admin-grid' });
    container.appendChild(this.grid);
    await this.renderProjectsPanel();
    await this.renderCategoriesPanel();
    await this.renderStatusesPanel();
    await this.renderPeoplePanel();
  },

  // -------------------------------------------------- Projects
  async renderProjectsPanel() {
    const panel = UI.el('div', { class: 'panel span2' });
    panel.appendChild(UI.el('div', { class: 'panel-head' }, [UI.el('h3', {}, 'All Projects')]));
    this.projectsHost = UI.el('div', { style: 'padding:0' });
    panel.appendChild(this.projectsHost);
    this.grid.appendChild(panel);
    await this.loadProjects();
  },

  async loadProjects() {
    this.projectsHost.innerHTML = '<div class="empty">Loading…</div>';
    this.adminPage = this.adminPage || 1;
    this.adminSize = this.adminSize || 25;
    try {
      const res = await API.getProjects({ completed: 'all', sort: 'recent', limit: 'all' });
      this.adminRows = res.items || [];
      this.renderProjectsTable();
    } catch (e) { this.projectsHost.innerHTML = `<div class="empty">Error: ${UI.esc(e.message)}</div>`; }
  },

  renderProjectsTable() {
    const all = this.adminRows;
    if (!all.length) { this.projectsHost.innerHTML = '<div class="empty">No projects yet. Click “New Project”.</div>'; return; }
    const size = this.adminSize;
    const pages = Math.max(1, Math.ceil(all.length / size));
    if (this.adminPage > pages) this.adminPage = pages;
    const start = (this.adminPage - 1) * size;
    const projects = all.slice(start, start + size);
    {
      const thead = UI.el('thead', {}, [UI.el('tr', {}, ['Project', 'Category', 'Sub-owner', 'Status', 'Age', ''].map((h) => UI.el('th', {}, h)))]);
      const tbody = UI.el('tbody');
      projects.forEach((p) => {
        tbody.appendChild(UI.el('tr', {}, [
          UI.el('td', {}, [UI.el('div', { class: 'proj-name' }, p.project_name), UI.el('div', { class: 'proj-sub' }, p.project_number ? `#${p.project_number}` : p.id.slice(0, 8))]),
          UI.el('td', {}, [UI.el('span', { class: 'badge cat' }, p.category_name)]),
          UI.el('td', { html: p.sub_owner_name ? `<span class="badge person">${UI.esc(p.sub_owner_name)}</span>` : '<span class="dash">—</span>' }),
          UI.el('td', { html: UI.statusBadge(p.status_name, p.is_completed, p.is_reopen) }),
          UI.el('td', { class: 'num-cell', html: `<span class="days-pill">${p.days_from_start} <small>d</small></span>` }),
          UI.el('td', {}, [UI.el('div', { class: 'row-actions' }, [
            UI.el('button', { class: 'btn subtle sm', onclick: () => this.projectForm(p.id) }, 'Edit'),
            UI.el('button', { class: 'btn subtle sm', onclick: () => this.deleteProject(p) }, '🗑'),
          ])]),
        ]));
      });
      this.projectsHost.innerHTML = '';
      this.projectsHost.appendChild(UI.el('div', { class: 'table-wrap', style: 'border:none;box-shadow:none;border-radius:0' }, [UI.el('table', {}, [thead, tbody])]));

      // Pager
      const sizeSel = UI.el('select', { onchange: (e) => { this.adminSize = Number(e.target.value); this.adminPage = 1; this.renderProjectsTable(); } });
      [25, 50, 100].forEach((n) => sizeSel.appendChild(UI.el('option', { value: n }, String(n))));
      sizeSel.value = String(size);
      const prev = UI.el('button', { class: 'btn sm', disabled: this.adminPage <= 1 ? 'true' : null, onclick: () => { this.adminPage--; this.renderProjectsTable(); } }, '‹ Prev');
      const next = UI.el('button', { class: 'btn sm', disabled: this.adminPage >= pages ? 'true' : null, onclick: () => { this.adminPage++; this.renderProjectsTable(); } }, 'Next ›');
      this.projectsHost.appendChild(UI.el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;flex-wrap:wrap' }, [
        UI.el('div', { style: 'display:flex;align-items:center;gap:8px' }, [UI.el('span', { class: 'muted', style: 'font-size:13px' }, 'Per page'), sizeSel,
          UI.el('span', { class: 'muted', style: 'font-size:13px' }, `Showing ${start + 1}–${start + projects.length} of ${all.length}`)]),
        UI.el('div', { style: 'display:flex;align-items:center;gap:8px' }, [prev, UI.el('span', { class: 'muted', style: 'font-size:13px' }, `Page ${this.adminPage} / ${pages}`), next]),
      ]));
    }
  },

  deleteProject(p) {
    UI.confirm(`Delete project "${p.project_name}"? This cannot be undone.`, async () => {
      try { await API.deleteProject(p.id); UI.toast('Project deleted'); this.loadProjects(); } catch (e) { UI.toast(e.message, 'err'); }
    });
  },

  async projectForm(id) {
    const [cats, people] = [await Store.categories(), await Store.people()];
    if (!cats.length) return UI.toast('Add a category first.', 'err');
    let project = null;
    if (id) project = await API.getProject(id);
    const curCat = project ? project.category_id : cats[0].id;

    const catSel = UI.el('select', { onchange: async (e) => { await fillStatuses(e.target.value); } });
    cats.forEach((c) => catSel.appendChild(UI.el('option', { value: c.id }, c.name)));
    catSel.value = curCat;

    const statusSel = UI.el('select', {});
    async function fillStatuses(catId, selectId) {
      const statuses = await Store.statuses(catId);
      statusSel.innerHTML = '';
      statuses.forEach((s) => statusSel.appendChild(UI.el('option', { value: s.id }, s.name)));
      if (selectId) statusSel.value = selectId;
    }
    await fillStatuses(curCat, project ? project.status_id : null);

    const peopleSelect = (selectedId) => {
      const sel = UI.el('select', {});
      sel.appendChild(UI.el('option', { value: '' }, '— None —'));
      people.forEach((pe) => sel.appendChild(UI.el('option', { value: pe.id }, pe.name)));
      if (selectedId) sel.value = selectedId;
      return sel;
    };

    const f = {};
    f.owner = peopleSelect(project ? project.owner_id : '');
    f.sub = peopleSelect(project ? project.sub_owner_id : '');
    f.number = UI.el('input', { type: 'text', value: project ? (project.project_number || '') : '', placeholder: 'e.g. PRJ-104' });
    f.name = UI.el('input', { type: 'text', value: project ? project.project_name : '', placeholder: 'Project name' });
    f.date = UI.el('input', { type: 'date', value: project ? (project.project_date || '').slice(0, 10) : new Date().toISOString().slice(0, 10) });
    f.company = UI.el('input', { type: 'text', value: project ? (project.company_name || '') : '', placeholder: 'Company name' });
    f.client = UI.el('input', { type: 'text', value: project ? (project.client_name || '') : '', placeholder: 'Client name' });
    f.desc = UI.el('textarea', { placeholder: 'Description' }, project ? (project.description || '') : '');

    const errBox = UI.el('div', { class: 'form-error hidden' });
    const grid = UI.el('div', { class: 'form-grid' }, [
      UI.el('div', { class: 'field' }, [UI.el('label', { class: 'req' }, 'Project category'), catSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Project number'), f.number]),
      UI.el('div', { class: 'field full' }, [UI.el('label', { class: 'req' }, 'Project name'), f.name]),
      UI.el('div', { class: 'field' }, [UI.el('label', { class: 'req' }, 'Project date'), f.date]),
      UI.el('div', { class: 'field' }, [UI.el('label', { class: 'req' }, 'Status'), statusSel]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Project owner'), f.owner]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Sub-owner'), f.sub]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Company name'), f.company]),
      UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Client name'), f.client]),
      UI.el('div', { class: 'field full' }, [UI.el('label', {}, 'Description'), f.desc]),
    ]);

    const save = UI.el('button', { class: 'btn primary', onclick: async () => {
      const payload = {
        category_id: catSel.value, status_id: statusSel.value,
        owner_id: f.owner.value || null, sub_owner_id: f.sub.value || null,
        project_number: f.number.value.trim(), project_name: f.name.value.trim(), project_date: f.date.value,
        company_name: f.company.value.trim(), client_name: f.client.value.trim(), description: f.desc.value.trim(),
      };
      const missing = [];
      if (!payload.category_id) missing.push('category');
      if (!payload.project_name) missing.push('name');
      if (!payload.project_date) missing.push('date');
      if (!payload.status_id) missing.push('status');
      if (missing.length) { errBox.textContent = 'Please fill required fields: ' + missing.join(', '); errBox.classList.remove('hidden'); return; }
      try {
        if (id) { await API.updateProject(id, payload); UI.toast('Project updated'); }
        else { await API.addProject(payload); UI.toast('Project added'); }
        UI.closeModal(); this.loadProjects(); Store.invalidate();
      } catch (e) { errBox.textContent = e.message; errBox.classList.remove('hidden'); }
    }}, id ? 'Save changes' : 'Add project');

    UI.openModal({ title: id ? 'Edit Project' : 'New Project', wide: true,
      body: UI.el('div', {}, [errBox, grid]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'), save] });
  },

  // -------------------------------------------------- Categories
  async renderCategoriesPanel() {
    const addInput = UI.el('input', { type: 'text', placeholder: 'New category', style: 'min-width:150px' });
    const addBtn = UI.el('button', { class: 'btn primary sm', onclick: async () => {
      const name = addInput.value.trim(); if (!name) return;
      try { await API.addCategory(name); addInput.value = ''; UI.toast('Category added'); Store.invalidate(); this.render(this.container); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, '+ Add');
    const panel = UI.el('div', { class: 'panel' }, [
      UI.el('div', { class: 'panel-head' }, [UI.el('h3', {}, 'Categories'), UI.el('div', { class: 'inline-add', style: 'margin:0' }, [addInput, addBtn])]),
    ]);
    this.categoriesHost = UI.el('div', { class: 'panel-body' });
    panel.appendChild(this.categoriesHost);
    this.grid.appendChild(panel);

    const cats = await Store.categories(true);
    this.categoriesHost.innerHTML = '';
    const chips = UI.el('div', { class: 'chips' });
    cats.forEach((c) => chips.appendChild(UI.el('div', { class: 'chip' }, [
      UI.el('span', { style: 'cursor:pointer', title: 'Rename', onclick: () => this.renameCategory(c) }, c.name),
      UI.el('button', { class: 'chip-x', title: 'Remove', onclick: () => this.deleteCategory(c), html: '&times;' }),
    ])));
    this.categoriesHost.appendChild(chips);
    this.categoriesHost.appendChild(UI.el('p', { class: 'hint' }, 'New categories start with the default status set. Removing is blocked while projects use it.'));
  },

  renameCategory(c) {
    const input = UI.el('input', { type: 'text', value: c.name, style: 'width:100%' });
    UI.openModal({ title: 'Rename category', narrow: true, body: UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Name'), input]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'),
        UI.el('button', { class: 'btn primary', onclick: async () => {
          try { await API.updateCategory(c.id, input.value.trim()); UI.closeModal(); UI.toast('Renamed'); Store.invalidate(); this.render(this.container); } catch (e) { UI.toast(e.message, 'err'); }
        }}, 'Save')] });
  },
  deleteCategory(c) {
    UI.confirm(`Remove category "${c.name}"? Its statuses will be removed too.`, async () => {
      try { await API.deleteCategory(c.id); UI.toast('Category removed'); Store.invalidate(); this.render(this.container); } catch (e) { UI.toast(e.message, 'err'); }
    });
  },

  // -------------------------------------------------- Statuses (ordered)
  async renderStatusesPanel() {
    const cats = await Store.categories();
    const catSel = UI.el('select', { onchange: (e) => this.loadStatusesFor(e.target.value) });
    cats.forEach((c) => catSel.appendChild(UI.el('option', { value: c.id }, c.name)));
    const panel = UI.el('div', { class: 'panel' }, [
      UI.el('div', { class: 'panel-head' }, [UI.el('h3', {}, 'Statuses & sequence'),
        UI.el('div', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, [UI.el('label', { style: 'margin:0' }, 'Category'), catSel])]),
    ]);
    this.statusesHost = UI.el('div', { class: 'panel-body' });
    panel.appendChild(this.statusesHost);
    this.grid.appendChild(panel);
    if (cats.length) await this.loadStatusesFor(cats[0].id);
    else this.statusesHost.innerHTML = '<div class="muted">Add a category to manage statuses.</div>';
  },

  async loadStatusesFor(catId) {
    const statuses = await Store.statuses(catId, true);
    this.statusesHost.innerHTML = '';
    const list = UI.el('div', { class: 'status-list' });
    statuses.forEach((s, idx) => {
      const move = UI.el('div', { class: 'move-btns' }, [
        UI.el('button', { title: 'Move up', disabled: idx === 0 ? 'true' : null, onclick: () => this.moveStatus(catId, statuses, idx, -1) }, '▲'),
        UI.el('button', { title: 'Move down', disabled: idx === statuses.length - 1 ? 'true' : null, onclick: () => this.moveStatus(catId, statuses, idx, 1) }, '▼'),
      ]);
      const flags = UI.el('div', { class: 'flags' }, [
        s.is_completed ? UI.el('span', { class: 'flag-tag done', title: 'Marks project completed' }, 'COMPLETED') : null,
        s.is_reopen ? UI.el('span', { class: 'flag-tag reopen', title: 'Valid pull-back target' }, 'PULL-BACK') : null,
      ]);
      list.appendChild(UI.el('div', { class: 'status-item' }, [
        UI.el('span', { class: 'seq' }, String(idx + 1)), move,
        UI.el('span', { class: 'st-name' }, s.name), flags,
        UI.el('button', { class: 'btn subtle sm', onclick: () => this.statusForm(catId, s) }, 'Edit'),
        UI.el('button', { class: 'btn subtle sm', onclick: () => this.deleteStatus(catId, s) }, '🗑'),
      ]));
    });
    this.statusesHost.appendChild(list);
    this.statusesHost.appendChild(UI.el('div', { class: 'inline-add' }, [UI.el('button', { class: 'btn primary sm', onclick: () => this.statusForm(catId, null) }, '+ Add status')]));
    this.statusesHost.appendChild(UI.el('p', { class: 'hint' }, 'Use ▲ ▼ to set the sequence (first = start, last = completed). “Completed” moves projects to the Completed tab; “Pull-back” allows reopening.'));
  },

  async moveStatus(catId, statuses, idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= statuses.length) return;
    const order = statuses.map((s) => s.id);
    [order[idx], order[target]] = [order[target], order[idx]];
    try { await API.reorderStatuses(order); Store.invalidate(); this.loadStatusesFor(catId); } catch (e) { UI.toast(e.message, 'err'); }
  },

  statusForm(catId, s) {
    const name = UI.el('input', { type: 'text', value: s ? s.name : '', placeholder: 'Status name', style: 'width:100%' });
    const completed = UI.el('input', { type: 'checkbox' }); completed.checked = s ? !!s.is_completed : false;
    const reopen = UI.el('input', { type: 'checkbox' }); reopen.checked = s ? !!s.is_reopen : false;
    const cbRow = (label, cb, hint) => UI.el('label', { style: 'display:flex;align-items:flex-start;gap:10px;margin-top:12px;cursor:pointer' }, [
      cb, UI.el('div', {}, [UI.el('div', { style: 'font-weight:600' }, label), UI.el('div', { class: 'hint', style: 'margin:0' }, hint)])]);
    const save = UI.el('button', { class: 'btn primary', onclick: async () => {
      const payload = { category_id: catId, name: name.value.trim(), is_completed: completed.checked, is_reopen: reopen.checked };
      if (!payload.name) return UI.toast('Name required', 'err');
      try { if (s) await API.updateStatus(s.id, payload); else await API.addStatus(payload); UI.closeModal(); UI.toast('Status saved'); Store.invalidate(); this.loadStatusesFor(catId); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, s ? 'Save' : 'Add status');
    UI.openModal({ title: s ? 'Edit status' : 'Add status', narrow: true,
      body: UI.el('div', {}, [
        UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Name'), name]),
        cbRow('Completed status', completed, 'Projects with this status appear in the Completed tab.'),
        cbRow('Pull-back status', reopen, 'Admins can reopen completed projects into this status.'),
      ]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'), save] });
  },
  deleteStatus(catId, s) {
    UI.confirm(`Delete status "${s.name}"?`, async () => {
      try { await API.deleteStatus(s.id); UI.toast('Status deleted'); Store.invalidate(); this.loadStatusesFor(catId); } catch (e) { UI.toast(e.message, 'err'); }
    });
  },

  // -------------------------------------------------- People
  async renderPeoplePanel() {
    const addInput = UI.el('input', { type: 'text', placeholder: 'New person', style: 'min-width:150px' });
    const addBtn = UI.el('button', { class: 'btn primary sm', onclick: async () => {
      const name = addInput.value.trim(); if (!name) return;
      try { await API.addPerson(name); addInput.value = ''; UI.toast('Person added'); Store.invalidate(); this.refreshPeople(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }}, '+ Add');
    const panel = UI.el('div', { class: 'panel' }, [
      UI.el('div', { class: 'panel-head' }, [UI.el('h3', {}, 'Owners & Sub-owners'), UI.el('div', { class: 'inline-add', style: 'margin:0' }, [addInput, addBtn])]),
    ]);
    this.peopleHost = UI.el('div', { class: 'panel-body' });
    panel.appendChild(this.peopleHost);
    this.grid.appendChild(panel);
    await this.refreshPeople();
  },
  async refreshPeople() {
    const people = await Store.people(true);
    this.peopleHost.innerHTML = '';
    if (!people.length) { this.peopleHost.innerHTML = '<div class="muted">No people yet. Add owners / sub-owners here.</div>'; return; }
    const chips = UI.el('div', { class: 'chips' });
    people.forEach((pe) => chips.appendChild(UI.el('div', { class: 'chip' }, [
      UI.el('span', { style: 'cursor:pointer', title: 'Rename', onclick: () => this.renamePerson(pe) }, pe.name),
      UI.el('button', { class: 'chip-x', title: 'Remove', onclick: () => this.deletePerson(pe), html: '&times;' }),
    ])));
    this.peopleHost.appendChild(chips);
    this.peopleHost.appendChild(UI.el('p', { class: 'hint' }, 'These names populate the Owner and Sub-owner dropdowns. Removal is blocked while assigned.'));
  },
  renamePerson(pe) {
    const input = UI.el('input', { type: 'text', value: pe.name, style: 'width:100%' });
    UI.openModal({ title: 'Rename person', narrow: true, body: UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Name'), input]),
      footer: [UI.el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'),
        UI.el('button', { class: 'btn primary', onclick: async () => {
          try { await API.updatePerson(pe.id, input.value.trim()); UI.closeModal(); UI.toast('Renamed'); Store.invalidate(); this.refreshPeople(); } catch (e) { UI.toast(e.message, 'err'); }
        }}, 'Save')] });
  },
  deletePerson(pe) {
    UI.confirm(`Remove "${pe.name}"?`, async () => {
      try { await API.deletePerson(pe.id); UI.toast('Removed'); Store.invalidate(); this.refreshPeople(); } catch (e) { UI.toast(e.message, 'err'); }
    });
  },
};
