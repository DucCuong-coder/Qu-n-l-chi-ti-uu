/* =========================================================
 * charts.js — Biểu đồ (Chart.js). Tự đổi màu theo Sáng / Tối.
 * Nếu Chart.js không tải được (offline) thì chỉ ẩn biểu đồ.
 * ========================================================= */
const Charts = (() => {
  let donut = null;
  let bar = null;
  const hasChart = () => typeof window.Chart !== 'undefined';

  function themeColors() {
    return {
      text: U.cssVar('--text-2'),
      grid: U.cssVar('--border'),
      surface: U.cssVar('--surface'),
      green: U.cssVar('--green'),
      red: U.cssVar('--red'),
      font: U.cssVar('--font') || 'system-ui',
    };
  }

  /** Gom chi tiêu theo danh mục trong phạm vi (stackId = null -> tất cả) */
  function expenseByCategory(month, stackId) {
    const map = new Map();
    Store.get().transactions.forEach((t) => {
      if (t.type !== 'expense' || U.monthOf(t.date) !== month || !Store.isCounted(t)) return;
      if (stackId && t.stackId !== stackId) return;
      map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
    });
    return [...map.entries()]
      .map(([id, value]) => {
        const c = Store.getCategory(id) || { name: 'Không rõ', icon: '❓', color: '#64748b' };
        return { name: c.name, icon: c.icon, color: c.color, value };
      })
      .sort((a, b) => b.value - a.value);
  }

  function monthlyTotals(month, stackId, n = 6) {
    const months = [];
    for (let i = n - 1; i >= 0; i--) months.push(U.shiftMonth(month, -i));
    const income = months.map(() => 0);
    const expense = months.map(() => 0);
    Store.get().transactions.forEach((t) => {
      if (stackId && t.stackId !== stackId) return;
      if (!Store.isCounted(t)) return;
      const idx = months.indexOf(U.monthOf(t.date));
      if (idx < 0) return;
      if (t.type === 'income') income[idx] += t.amount; else expense[idx] += t.amount;
    });
    return { labels: months.map(U.monthShort), income, expense };
  }

  const shortMoney = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
    if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'tr';
    if (a >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
    return String(v);
  };

  function renderDonut(month, stackId) {
    const canvas = document.getElementById('donutChart');
    const center = document.getElementById('donutCenter');
    const legend = document.getElementById('donutLegend');
    const data = expenseByCategory(month, stackId);
    const total = data.reduce((a, x) => a + x.value, 0);

    center.innerHTML = `<div><small>Tổng chi</small><b class="num">${U.fmt(total)}</b></div>`;
    legend.innerHTML = data.length
      ? data.map((d) => {
          const pct = total ? (d.value / total) * 100 : 0;
          return `<li style="--c:${d.color}">
            <span class="l-ico">${U.escapeHtml(d.icon)}</span>
            <span class="l-name">${U.escapeHtml(d.name)} <span class="muted">· ${pct.toFixed(0)}%</span></span>
            <span class="l-bar"><i style="width:${pct}%"></i></span>
            <span class="l-val num">${U.fmt(d.value)}</span>
          </li>`;
        }).join('')
      : `<li class="empty-mini" style="justify-content:center">Chưa có khoản chi nào trong tháng</li>`;

    if (!hasChart()) { canvas.parentElement.classList.add('hidden'); return; }
    const c = themeColors();
    const values = data.length ? data.map((d) => d.value) : [1];
    const colors = data.length ? data.map((d) => d.color) : [U.cssVar('--surface-3')];

    if (!donut) {
      donut = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 3, hoverOffset: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '70%',
          animation: { duration: 400 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${U.fmt(ctx.raw)}` } },
          },
        },
      });
    }
    donut.data.labels = data.length ? data.map((d) => d.name) : ['Trống'];
    donut.data.datasets[0].data = values;
    donut.data.datasets[0].backgroundColor = colors;
    donut.data.datasets[0].borderColor = c.surface;
    donut.options.plugins.tooltip.enabled = data.length > 0;
    donut.update();
  }

  function renderBar(month, stackId) {
    const canvas = document.getElementById('barChart');
    if (!canvas) return;
    if (!hasChart()) {
      canvas.parentElement.innerHTML = '<p class="chart-fallback">Không tải được thư viện biểu đồ (đang offline?)</p>';
      return;
    }
    const c = themeColors();
    const d = monthlyTotals(month, stackId);
    if (!bar) {
      bar = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            { label: 'Thu', data: [], borderRadius: 6, maxBarThickness: 22 },
            { label: 'Chi', data: [], borderRadius: 6, maxBarThickness: 22 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10 } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${U.fmt(ctx.raw)}` } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: (v) => shortMoney(v), maxTicksLimit: 5 } },
          },
        },
      });
    }
    bar.data.labels = d.labels;
    bar.data.datasets[0].data = d.income;
    bar.data.datasets[0].backgroundColor = c.green;
    bar.data.datasets[1].data = d.expense;
    bar.data.datasets[1].backgroundColor = c.red;
    // Màu chữ / lưới theo theme
    bar.options.plugins.legend.labels.color = c.text;
    bar.options.scales.x.ticks = { ...(bar.options.scales.x.ticks || {}), color: c.text };
    bar.options.scales.y.ticks.color = c.text;
    bar.options.scales.y.grid = { color: c.grid };
    bar.options.scales.y.border = { display: false };
    bar.options.scales.x.border = { color: c.grid };
    bar.update();
  }

  function render(month, stackId) {
    if (hasChart()) {
      Chart.defaults.font.family = themeColors().font;
      Chart.defaults.color = themeColors().text;
    }
    renderDonut(month, stackId);
    renderBar(month, stackId);
  }

  return { render };
})();
