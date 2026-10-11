// Analytics view — category-wise + sub-owner charts (Chart.js), theme-aware
const Analytics = {
  charts: [],
  palette: ['#4361ee', '#10b981', '#f59e0b', '#ec4899', '#7c3aed', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#3b82f6'],

  themeColors() {
    const dark = Theme.isDark();
    return { text: dark ? '#c7cfdd' : '#4a5266', grid: dark ? 'rgba(255,255,255,.07)' : '#eef1f7' };
  },

  async render(container) {
    container.innerHTML = '';
    container.appendChild(UI.el('div', { class: 'page-head' }, [
      UI.el('div', {}, [UI.el('h2', {}, 'Analytics'), UI.el('p', { class: 'muted' }, 'Category-wise and sub-owner breakdowns.')]),
    ]));
    this.destroyCharts();

    let stats;
    try { stats = await API.getStats(); } catch (e) { container.appendChild(UI.el('div', { class: 'empty' }, 'Error: ' + e.message)); return; }

    const totals = stats.byCategory.reduce((a, c) => { a.total += c.total; a.active += c.active; a.completed += c.completed; return a; }, { total: 0, active: 0, completed: 0 });
    const statRow = UI.el('div', { class: 'stat-row' });
    [['Total projects', totals.total, true], ['Active', totals.active, false], ['Completed', totals.completed, false], ['Categories', stats.byCategory.length, false]]
      .forEach(([l, v, a]) => statRow.appendChild(UI.el('div', { class: 'stat-card' }, [UI.el('div', { class: 'label' }, l), UI.el('div', { class: 'value' + (a ? ' accent' : '') }, String(v))])));
    container.appendChild(statRow);

    if (!totals.total) { container.appendChild(UI.el('div', { class: 'table-wrap' }, [UI.el('div', { class: 'empty' }, 'No project data to chart yet.')])); return; }

    const grid = UI.el('div', { class: 'charts-grid' });
    container.appendChild(grid);
    const mkCard = (title, full) => {
      const canvas = UI.el('canvas');
      grid.appendChild(UI.el('div', { class: 'chart-card' + (full ? ' full' : '') }, [UI.el('h3', {}, title), UI.el('div', { class: 'canvas-wrap' }, [canvas])]));
      return canvas;
    };

    await new Promise((r) => (window.Chart ? r() : setTimeout(function w() { window.Chart ? r() : setTimeout(w, 60); }, 60)));
    const tc = this.themeColors();
    Chart.defaults.color = tc.text;
    Chart.defaults.font.family = 'Inter, Segoe UI, system-ui, sans-serif';

    // Projects per category (stacked)
    this.charts.push(new Chart(mkCard('Projects per category'), {
      type: 'bar',
      data: { labels: stats.byCategory.map((c) => c.category_name), datasets: [
        { label: 'Active', data: stats.byCategory.map((c) => c.active), backgroundColor: '#4361ee', borderRadius: 6 },
        { label: 'Completed', data: stats.byCategory.map((c) => c.completed), backgroundColor: '#10b981', borderRadius: 6 }] },
      options: this.baseOpts({ stacked: true, tc }),
    }));

    // Category share (doughnut)
    this.charts.push(new Chart(mkCard('Category share'), {
      type: 'doughnut',
      data: { labels: stats.byCategory.map((c) => c.category_name), datasets: [{ data: stats.byCategory.map((c) => c.total), backgroundColor: this.palette, borderWidth: 2, borderColor: Theme.isDark() ? '#171b26' : '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    }));

    // Avg age of active projects
    if (stats.avgDays.length) {
      this.charts.push(new Chart(mkCard('Avg. age of active projects (days)'), {
        type: 'bar',
        data: { labels: stats.avgDays.map((d) => d.category_name), datasets: [{ label: 'Avg days', data: stats.avgDays.map((d) => d.avg_days), backgroundColor: '#f59e0b', borderRadius: 6 }] },
        options: this.baseOpts({ tc }),
      }));
    }

    // Projects per sub-owner
    if (stats.bySubOwner && stats.bySubOwner.length) {
      this.charts.push(new Chart(mkCard('Projects per sub-owner'), {
        type: 'bar',
        data: { labels: stats.bySubOwner.map((d) => d.person_name), datasets: [
          { label: 'Active', data: stats.bySubOwner.map((d) => d.active), backgroundColor: '#7c3aed', borderRadius: 6 },
          { label: 'Total', data: stats.bySubOwner.map((d) => d.total), backgroundColor: '#06b6d4', borderRadius: 6 }] },
        options: this.baseOpts({ tc }),
      }));
    }

    // Status distribution by category (stacked, full width)
    const statusNames = [...new Set(stats.byStatus.map((r) => r.status_name))];
    const catNames = [...new Set(stats.byStatus.map((r) => r.category_name))];
    const datasets = statusNames.map((sn, i) => ({
      label: sn, backgroundColor: this.palette[i % this.palette.length], borderRadius: 4,
      data: catNames.map((cn) => { const row = stats.byStatus.find((r) => r.category_name === cn && r.status_name === sn); return row ? row.total : 0; }),
    }));
    this.charts.push(new Chart(mkCard('Status distribution by category', true), {
      type: 'bar', data: { labels: catNames, datasets }, options: this.baseOpts({ stacked: true, tc }),
    }));
  },

  baseOpts({ stacked = false, tc }) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: {
        x: { stacked, grid: { display: false }, ticks: { color: tc.text } },
        y: { stacked, beginAtZero: true, ticks: { precision: 0, color: tc.text }, grid: { color: tc.grid } },
      },
    };
  },
  destroyCharts() { this.charts.forEach((c) => c.destroy()); this.charts = []; },
};
