// Shared cache
const Store = {
  _cats: null, _statuses: {}, _all: null, _people: null,
  async categories(force) { if (force) this._cats = null; if (!this._cats) this._cats = await API.getCategories(); return this._cats; },
  async statuses(categoryId, force) { if (force) delete this._statuses[categoryId]; if (!this._statuses[categoryId]) this._statuses[categoryId] = await API.getStatuses(categoryId); return this._statuses[categoryId]; },
  async allStatuses(force) { if (force) this._all = null; if (!this._all) this._all = await API.getStatuses(); return this._all; },
  async people(force) { if (force) this._people = null; if (!this._people) this._people = await API.getPeople(); return this._people; },
  invalidate() { this._cats = null; this._statuses = {}; this._all = null; this._people = null; },
};

// Theme
const Theme = {
  init() {
    const saved = localStorage.getItem('dpt_theme') || 'light';
    this.apply(saved);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      this.apply(next);
      localStorage.setItem('dpt_theme', next);
      if (App.view === 'analytics') Analytics.render(document.getElementById('view-analytics'));
    });
  },
  apply(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.getElementById('theme-toggle').textContent = mode === 'dark' ? '☀️' : '🌙';
  },
  isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; },
};

// Auth
const Auth = {
  init() {
    this.refreshPill();
    // Auto-recover: any 401 prompts a login + retry
    API.onAuthRequired = () => new Promise((resolve) => {
      this.showLogin(() => resolve(true), () => resolve(false));
    });
    // Validate any stored token against the server (handles server restarts)
    if (API.getToken()) {
      API.session().then((s) => { if (!s.admin) { API.clearAuth(); this.refreshPill(); } }).catch(() => {});
    }
    document.getElementById('login-pill').addEventListener('click', () => {
      if (API.isAdmin()) {
        UI.confirm('Log out of admin?', async () => {
          try { await API.logout(); } catch (_) {}
          API.clearAuth(); this.refreshPill(); UI.toast('Logged out');
          if (App.view === 'admin' || App.view === 'logs') App.switch('dashboard');
        }, { danger: false, yesLabel: 'Log out' });
      } else {
        this.showLogin();
      }
    });
  },
  refreshPill() {
    const pill = document.getElementById('login-pill');
    if (API.isAdmin()) pill.innerHTML = `<span class="who">● ${UI.esc(API.getUser() || 'admin')}</span> · Log out`;
    else pill.textContent = 'Admin login';
  },
  showLogin(onSuccess, onCancel) {
    const user = UI.el('input', { type: 'text', placeholder: 'Username', value: 'admin', style: 'width:100%' });
    const pass = UI.el('input', { type: 'password', placeholder: 'Password', style: 'width:100%' });
    const err = UI.el('div', { class: 'form-error hidden' });

    // Show / hide password toggle
    const showChk = UI.el('input', { type: 'checkbox', id: 'show-pass' });
    showChk.addEventListener('change', () => { pass.type = showChk.checked ? 'text' : 'password'; });
    const showRow = UI.el('label', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--text-muted)' }, [showChk, 'Show password']);

    let done = false;
    const finish = (ok, r) => {
      if (done) return; done = true;
      UI._onClose = null;           // prevent close hook from re-firing cancel
      UI.closeModal();
      if (ok) { this.refreshPill(); UI.toast('Welcome, ' + r.username); if (onSuccess) onSuccess(); }
      else if (onCancel) onCancel();
    };
    const submit = async () => {
      err.classList.add('hidden');
      try {
        const r = await API.login(user.value.trim(), pass.value);
        API.setAuth(r.token, r.username);
        finish(true, r);
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    };
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const cancelBtn = UI.el('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel');
    UI.openModal({
      title: 'Admin login', narrow: true,
      body: UI.el('div', {}, [
        err,
        UI.el('div', { class: 'field', style: 'margin-bottom:14px' }, [UI.el('label', {}, 'Username'), user]),
        UI.el('div', { class: 'field' }, [UI.el('label', {}, 'Password'), pass]),
        showRow,
      ]),
      footer: [cancelBtn, UI.el('button', { class: 'btn primary', onclick: submit }, 'Log in')],
    });
    // If dismissed via backdrop click or Esc, treat as cancel
    UI._onClose = () => finish(false);
    setTimeout(() => pass.focus(), 50);
  },
  // Ensure admin before running an action; prompts login if needed
  require(action) {
    if (API.isAdmin()) return action();
    this.showLogin(action);
  },
};

const App = {
  view: 'dashboard',
  init() {
    Theme.init();
    Auth.init();
    UI.startTicker();
    document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => this.switch(btn.dataset.view)));
    this.switch('dashboard');
  },
  async switch(view) {
    if ((view === 'admin' || view === 'logs') && !API.isAdmin()) { Auth.showLogin(() => this.switch(view)); return; }
    this.view = view;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    const el = document.getElementById('view-' + view);
    el.classList.remove('hidden');
    try {
      if (view === 'dashboard') await Dashboard.render(el, 'active');
      else if (view === 'completed') await Dashboard.render(el, 'completed');
      else if (view === 'analytics') await Analytics.render(el);
      else if (view === 'admin') await Admin.render(el);
      else if (view === 'logs') await Logs.render(el);
    } catch (e) {
      if (e.needAuth) { Auth.showLogin(() => this.switch(view)); return; }
      el.innerHTML = `<div class="empty">Something went wrong: ${UI.esc(e.message)}</div>`;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
