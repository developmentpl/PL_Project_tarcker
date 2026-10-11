// Fetch wrapper + auth token handling
const API = {
  tokenKey: 'dpt_token',
  userKey: 'dpt_user',
  getToken() { return sessionStorage.getItem(this.tokenKey); },
  getUser() { return sessionStorage.getItem(this.userKey); },
  setAuth(token, user) { sessionStorage.setItem(this.tokenKey, token); sessionStorage.setItem(this.userKey, user); },
  clearAuth() { sessionStorage.removeItem(this.tokenKey); sessionStorage.removeItem(this.userKey); },
  isAdmin() { return !!this.getToken(); },

  onAuthRequired: null, // set by app: returns Promise<boolean> after showing login

  async req(method, url, body, _retried) {
    const opts = { method, headers: {} };
    const token = this.getToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && url !== '/api/login') {
      this.clearAuth();
      // Try to recover: prompt login once, then retry the original request
      if (!_retried && typeof this.onAuthRequired === 'function') {
        const ok = await this.onAuthRequired();
        if (ok) return this.req(method, url, body, true);
      }
      const err = new Error((data && data.error) || 'Admin login required');
      err.needAuth = true;
      throw err;
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },

  // Auth
  login: (username, password) => API.req('POST', '/api/login', { username, password }),
  logout: () => API.req('POST', '/api/logout', {}),
  session: () => API.req('GET', '/api/session'),

  // Logs
  getLogs: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return API.req('GET', `/api/logs${q ? '?' + q : ''}`);
  },

  // People
  getPeople: () => API.req('GET', '/api/people'),
  addPerson: (name) => API.req('POST', '/api/people', { name }),
  updatePerson: (id, name) => API.req('PUT', `/api/people/${id}`, { name }),
  deletePerson: (id) => API.req('DELETE', `/api/people/${id}`),

  // Categories
  getCategories: () => API.req('GET', '/api/categories'),
  addCategory: (name) => API.req('POST', '/api/categories', { name }),
  updateCategory: (id, name) => API.req('PUT', `/api/categories/${id}`, { name }),
  deleteCategory: (id) => API.req('DELETE', `/api/categories/${id}`),

  // Statuses
  getStatuses: (categoryId) => API.req('GET', categoryId ? `/api/statuses?category_id=${categoryId}` : '/api/statuses'),
  addStatus: (payload) => API.req('POST', '/api/statuses', payload),
  updateStatus: (id, payload) => API.req('PUT', `/api/statuses/${id}`, payload),
  reorderStatuses: (order) => API.req('POST', '/api/statuses/reorder', { order }),
  deleteStatus: (id) => API.req('DELETE', `/api/statuses/${id}`),

  // Projects
  getProjects: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return API.req('GET', `/api/projects${q ? '?' + q : ''}`);
  },
  getProject: (id) => API.req('GET', `/api/projects/${id}`),
  addProject: (payload) => API.req('POST', '/api/projects', payload),
  updateProject: (id, payload) => API.req('PUT', `/api/projects/${id}`, payload),
  setStatus: (id, status_id, changed_at) => API.req('PATCH', `/api/projects/${id}/status`, { status_id, changed_at }),
  transferSubOwner: (id, sub_owner_id, changed_at) => API.req('PATCH', `/api/projects/${id}/subowner`, { sub_owner_id, changed_at }),
  deleteProject: (id) => API.req('DELETE', `/api/projects/${id}`),

  // Stats
  getStats: () => API.req('GET', '/api/stats'),
};
