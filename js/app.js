/* =========================================================
 * app.js — GIAO DIỆN & SỰ KIỆN
 * Chỉ đọc dữ liệu qua Store / Ledger và gọi các hàm của chúng
 * để thay đổi dữ liệu. Store.commit() sẽ tự gọi render() lại.
 * ========================================================= */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const VIEW_KEY = 'qlct_view';
  const THEME_KEY = 'qlct_theme';
  const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  const EMOJIS = ['🍜', '🍔', '☕', '🧋', '🛒', '🛍️', '👕', '💄', '🏠', '💡', '💧', '📶', '📱', '🛵', '🚗', '⛽',
    '🚌', '✈️', '🎮', '🎬', '🎵', '📚', '🎓', '💊', '🏥', '🏋️', '🐶', '👶', '🎁', '💝', '🧾', '🔧',
    '💰', '💵', '💼', '🧑‍🏫', '📈', '🏆', '🪙', '🏦', '💳', '🐷', '📦', '✨', '❤️', '🎉', '🍺', '🚬'];
  const STACK_EMOJIS = ['🏦', '💳', '💰', '🐷', '💵', '📱', '🪙', '👛', '💼', '🏧', '💎', '🧧'];
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#16a34a', '#14b8a6', '#0ea5e9', '#2563eb',
    '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b', '#0f766e'];

  /* =====================================================
   * VIEW STATE (trạng thái giao diện, không phải dữ liệu)
   * ===================================================== */
  const view = { scope: 'all', month: U.currentMonth(), search: '', sort: 'newest', type: 'all' };
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    if (saved.scope) view.scope = saved.scope;
    if (saved.sort) view.sort = saved.sort;
  } catch (_) { /* bỏ qua */ }

  const scopeId = () => (view.scope === 'all' ? null : view.scope);
  const saveView = () => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ scope: view.scope, sort: view.sort })); } catch (_) {}
  };
  const stackName = (id) => Store.getStack(id)?.name || '(đã xóa)';

  /* =====================================================
   * TOAST
   * ===================================================== */
  let toastTimer;
  function toast(msg, { error = false, actionLabel, onAction, duration = 3200 } = {}) {
    const el = $('toast');
    el.className = 'toast' + (error ? ' error' : '');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.onclick = () => { el.classList.remove('show'); onAction?.(); };
      el.appendChild(b);
      duration = Math.max(duration, 6000);
    }
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* =====================================================
   * MODAL
   * ===================================================== */
  const Modal = {
    open(id) {
      const m = $(id);
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      setTimeout(() => m.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select')?.focus(), 60);
    },
    close(id) {
      const m = $(id);
      m.classList.remove('open');
      m.setAttribute('aria-hidden', 'true');
      if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
    },
    isOpen: (id) => $(id).classList.contains('open'),
    top() {
      const all = [...document.querySelectorAll('.modal.open')];
      return all[all.length - 1];
    },
  };

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) Modal.close(closeBtn.closest('.modal').id);
    else if (e.target.classList.contains('modal') && e.target.id !== 'confirmModal') Modal.close(e.target.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = Modal.top();
      if (m && m.id !== 'confirmModal') Modal.close(m.id);
      $('menu').classList.remove('open');
    }
  });

  /** Hộp xác nhận thay cho confirm() — trả về Promise<boolean> */
  function confirmDialog(message, { title = 'Xác nhận', yes = 'Đồng ý', danger = true } = {}) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title;
      $('confirmMsg').textContent = message;
      const yesBtn = $('confirmYes');
      yesBtn.textContent = yes;
      yesBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      const done = (v) => { Modal.close('confirmModal'); resolve(v); };
      yesBtn.onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
      Modal.open('confirmModal');
    });
  }

  /** Ô nhập tiền: cho gõ tự do (50k, 1tr5, 2tr300k…), hiện số quy đổi bên dưới,
   *  rời ô thì tự đổi về dạng 1.500.000 */
  function bindAmountInput(input) {
    const preview = document.createElement('small');
    preview.className = 'amount-preview';
    input.closest('.amount-input').insertAdjacentElement('afterend', preview);

    const update = () => {
      const raw = input.value.trim();
      const isShorthand = /[^\d.,\s]/.test(raw);   // có chữ / dấu + -> cần quy đổi
      const v = U.parseMoney(raw);
      input.classList.toggle('invalid', raw !== '' && isNaN(v));
      if (!raw || !isShorthand) { preview.textContent = ''; preview.className = 'amount-preview'; return; }
      if (isNaN(v)) {
        preview.className = 'amount-preview error';
        preview.textContent = 'Chưa hiểu số tiền — thử: 50k, 1tr, 1tr5, 2tr300k';
      } else {
        preview.className = 'amount-preview ok';
        preview.textContent = '= ' + U.fmt(v);
      }
    };
    input.addEventListener('input', update);
    input.addEventListener('blur', () => {
      const v = U.parseMoney(input.value);
      if (!isNaN(v)) input.value = U.fmtPlain(v);
      update();
    });
    // Khi giá trị được đặt từ code (mở modal) thì xóa preview cũ
    input.addEventListener('amount:set', update);
  }
  const amountOf = (id) => U.parseAmount($(id).value);
  const setAmount = (id, v) => { $(id).value = U.fmtPlain(v); $(id).dispatchEvent(new Event('amount:set')); };

  /* =====================================================
   * RENDER CHÍNH
   * ===================================================== */
  function render() {
    // Stack đang xem có thể đã bị xóa
    if (view.scope !== 'all' && !Store.getStack(view.scope)) { view.scope = 'all'; saveView(); }

    const stack = Store.getStack(view.scope);
    document.documentElement.style.setProperty('--accent', stack ? stack.color : '');
    $('brandSub').textContent = stack ? `${stack.icon} ${stack.name}` : 'Tổng quan tất cả';
    $('monthLabel').textContent = U.monthLabel(view.month);
    $('monthPicker').value = view.month;

    renderTabs();
    renderBanners();
    renderStats();
    renderScopePanel();
    renderTxList();
    Charts.render(view.month, scopeId());
  }

  /* ---------- Tabs Stack ---------- */
  function renderTabs() {
    const debts = Ledger.allDebts();
    const tabs = [`<button class="stack-tab ${view.scope === 'all' ? 'active' : ''}" data-scope="all" style="--c:var(--brand)">
        <span class="tab-ico">🌐</span>Tổng quan tất cả</button>`];
    Store.get().stacks.forEach((s) => {
      const owes = debts.some((d) => d.debtor === s.id);
      tabs.push(`<button class="stack-tab ${view.scope === s.id ? 'active' : ''}" data-scope="${s.id}" style="--c:${s.color}">
        <span class="tab-ico">${esc(s.icon)}</span>${esc(s.name)}
        ${owes ? '<span class="tab-debt" title="Đang nợ nội bộ"></span>' : ''}</button>`);
    });
    tabs.push(`<button class="stack-tab add" data-scope="__add">+ Thêm Stack</button>`);
    $('stackTabs').innerHTML = tabs.join('');
  }

  $('stackTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    if (b.dataset.scope === '__add') return openStackModal();
    view.scope = b.dataset.scope;
    saveView();
    render();
    b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  });

  /* ---------- Banners ---------- */
  function banner(kind, icon, html, actions = '') {
    return `<div class="banner ${kind}"><span class="b-ico">${icon}</span><div class="b-text">${html}</div>
      ${actions ? `<div class="b-actions">${actions}</div>` : ''}</div>`;
  }

  function renderBanners() {
    const out = [];
    const sid = scopeId();
    if (sid) {
      const s = Ledger.stackMonth(sid, view.month);
      if (!s.plan.empty && s.remaining < 0) {
        out.push(banner('danger', '⚠️',
          `<b>${esc(stackName(sid))}</b> đã vượt hạn mức <b>${U.fmt(-s.remaining)}</b>. Ứng trước từ Stack khác để bù?`,
          `<button class="btn btn-primary btn-sm" data-act="advance" data-to="${sid}" data-amount="${-s.remaining}">Ứng trước</button>`));
      } else if (!s.plan.empty && s.remaining === 0 && s.expense > 0) {
        out.push(banner('warn', '🔒', `<b>${esc(stackName(sid))}</b> đã dùng hết hạn mức chi tiêu tháng này.`,
          `<button class="btn btn-primary btn-sm" data-act="advance" data-to="${sid}">Ứng trước</button>`));
      }
    } else {
      const o = Ledger.overviewMonth(view.month);
      const over = o.perStack.filter((x) => !x.plan.empty && x.remaining < 0);
      if (over.length) {
        out.push(banner('danger', '⚠️', 'Vượt hạn mức: ' + over.map((x) =>
          `<b>${esc(x.stack.name)}</b> (${U.fmt(-x.remaining)})`).join(', ')));
      }
    }

    const pending = Store.pendingRecurring(view.month, sid);
    if (pending.length && !Store.isRecurringDismissed(view.month, sid)) {
      const total = pending.reduce((a, t) => a + t.amount, 0);
      out.push(banner('info', '🔁',
        `Có <b>${pending.length} khoản cố định</b> từ ${U.monthLabel(U.shiftMonth(view.month, -1))} chưa tạo cho tháng này (${U.fmt(total)}).`,
        `<button class="btn btn-ghost btn-sm" data-act="dismiss-recurring">Bỏ qua</button>
         <button class="btn btn-primary btn-sm" data-act="copy-recurring">Sao chép ngay</button>`));
    }
    $('banners').innerHTML = out.join('');
  }

  /* ---------- 4 thẻ thống kê ---------- */
  function statCard(cls, label, value, sub, extra = '') {
    return `<div class="stat ${cls}">
      <div class="stat-label"><span class="dot"></span>${label}</div>
      <div class="stat-value num" title="${esc(value)}">${value}</div>
      <div class="stat-sub">${sub}</div>${extra}</div>`;
  }
  const progress = (pct, over) => `<div class="progress ${over ? 'over' : ''}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  function countTx(type) {
    const sid = scopeId();
    return Store.get().transactions.filter((t) => t.type === type && U.monthOf(t.date) === view.month && (!sid || t.stackId === sid)).length;
  }

  function renderStats() {
    const sid = scopeId();
    const nInc = countTx('income'), nExp = countTx('expense');
    let html;
    if (!sid) {
      const o = Ledger.overviewMonth(view.month);
      const over = o.remaining < 0;
      html = statCard('income', 'Tổng thu nhập', U.fmt(o.income),
          o.plannedIncome ? `Dự kiến ${U.fmt(o.plannedIncome)}` : `${nInc} khoản thu`)
        + statCard('expense', 'Tổng chi tiêu', U.fmt(o.expense), `${nExp} khoản chi`)
        + statCard('balance', 'Số dư', U.fmt(o.balance), 'Thu − Chi (không tính chuyển nội bộ)')
        + (o.hasPlan
          ? statCard('budget' + (over ? ' over' : ''), 'Ngân sách còn lại', U.fmt(o.remaining),
              `Đã chi ${o.usedPct.toFixed(0)}% / ${U.fmt(o.limit)} · Tiết kiệm ${U.fmt(o.saving)}`, progress(o.usedPct, over))
          : statCard('budget', 'Ngân sách', 'Chưa đặt', 'Mở từng Stack để đặt kế hoạch tháng'));
    } else {
      const s = Ledger.stackMonth(sid, view.month);
      const over = s.remaining < 0;
      const transferNote = s.netTransfer
        ? `Gồm ${s.netTransfer > 0 ? '+' : '−'}${U.fmt(Math.abs(s.netTransfer))} chuyển nội bộ`
        : 'Thu − Chi trong tháng';
      const limitNote = s.netTransfer
        ? `<span class="hide-sm"> (${U.fmt(s.plan.limit)} ${s.netTransfer > 0 ? '+' : '−'} ${U.fmt(Math.abs(s.netTransfer))} nội bộ)</span>` : '';
      html = statCard('income', 'Tổng thu nhập', U.fmt(s.income),
          s.plan.income ? `Dự kiến ${U.fmt(s.plan.income)}` : `${nInc} khoản thu`)
        + statCard('expense', 'Tổng chi tiêu', U.fmt(s.expense), `${nExp} khoản chi`)
        + statCard('balance', 'Số dư khả dụng', U.fmt(s.balance), transferNote)
        + (s.plan.empty && !s.netTransfer
          ? statCard('budget', 'Hạn mức còn lại', 'Chưa đặt', 'Bấm "Đặt kế hoạch" bên dưới')
          : statCard('budget' + (over ? ' over' : ''), over ? 'Vượt hạn mức' : 'Hạn mức còn lại', U.fmt(s.remaining),
              `Đã chi ${U.fmt(s.expense)} / ${U.fmt(s.spendLimit)}${limitNote}`, progress(s.usedPct, over)));
    }
    $('stats').innerHTML = html;
  }

  /* ---------- Panel kế hoạch / công nợ ---------- */
  function debtItemsHtml(list, mode) {
    // mode: 'owe' | 'lend' | 'all'
    if (!list.length) return mode === 'all' ? '<li class="empty-mini">Không có công nợ nội bộ 🎉</li>' : '';
    return list.map((d) => {
      const text = mode === 'all'
        ? `<b>${esc(stackName(d.debtor))}</b> nợ <b>${esc(stackName(d.creditor))}</b>`
        : mode === 'owe' ? `Đang nợ <b>${esc(stackName(d.creditor))}</b>` : `Cho <b>${esc(stackName(d.debtor))}</b> ứng`;
      const btn = `<button class="btn btn-ghost btn-sm" data-act="repay" data-debtor="${d.debtor}" data-creditor="${d.creditor}">${mode === 'lend' ? 'Thu hồi' : 'Hoàn trả'}</button>`;
      return `<li class="debt-item ${mode === 'lend' ? 'lend' : 'owe'}">
        <span>${mode === 'lend' ? '📥' : '📤'}</span>
        <span class="d-text">${text}</span>
        <span class="d-amt num">${U.fmt(d.amount)}</span>${btn}</li>`;
    }).join('');
  }

  function renderScopePanel() {
    const sid = scopeId();
    const debts = Ledger.allDebts();
    if (!sid) {
      const o = Ledger.overviewMonth(view.month);
      const cards = o.perStack.map((x) => {
        const owes = debts.filter((d) => d.debtor === x.stack.id);
        const lends = debts.filter((d) => d.creditor === x.stack.id);
        const over = x.remaining < 0;
        return `<button class="mini-stack" data-scope="${x.stack.id}" style="--c:${x.stack.color}">
          <div class="ms-head"><span class="ms-ico">${esc(x.stack.icon)}</span>${esc(x.stack.name)}</div>
          <div class="ms-row"><span>Thu <b class="num">${U.fmt(x.income)}</b></span><span>Chi <b class="num">${U.fmt(x.expense)}</b></span></div>
          ${x.plan.empty && !x.netTransfer
            ? '<div class="ms-row"><span>Chưa đặt kế hoạch</span></div>'
            : `${progress(x.usedPct, over)}<div class="ms-row"><span>${over ? 'Vượt' : 'Còn'} <b class="num">${U.fmt(Math.abs(x.remaining))}</b></span><span>/ ${U.fmt(x.spendLimit)}</span></div>`}
          ${owes.length || lends.length ? `<div class="ms-badges">
            ${owes.map((d) => `<span class="badge">Nợ ${esc(stackName(d.creditor))}: ${U.fmt(d.amount)}</span>`).join('')}
            ${lends.map((d) => `<span class="badge lend">Cho ${esc(stackName(d.debtor))} ứng: ${U.fmt(d.amount)}</span>`).join('')}
          </div>` : ''}
        </button>`;
      }).join('');
      $('scopePanel').innerHTML = `<div class="overview-panel">
        <div class="card"><div class="card-head"><h2>Các Stack (Ngân hàng)</h2>
          <button class="btn btn-ghost btn-sm" data-act="manage-stacks">Quản lý</button></div>
          <div class="stack-grid">${cards}</div></div>
        <div class="card debt-card"><div class="card-head"><h2>Công nợ nội bộ</h2>
          <button class="btn btn-ghost btn-sm" data-act="advance" ${Store.get().stacks.length < 2 ? 'disabled' : ''}>⇄ Ứng trước</button></div>
          <ul class="debt-list">${debtItemsHtml(debts, 'all')}</ul></div>
      </div>`;
      return;
    }

    const st = Store.getStack(sid);
    const s = Ledger.stackMonth(sid, view.month);
    const { owes, lends } = Ledger.debtsOf(sid);
    const over = s.remaining < 0;
    const planTag = s.plan.empty ? 'Chưa đặt kế hoạch'
      : s.plan.inherited ? `Kế hoạch kế thừa từ ${U.monthLabel(s.plan.from)}` : `Kế hoạch ${U.monthLabel(view.month)}`;
    const transferBits = [];
    if (s.flow.advIn) transferBits.push(`+${U.fmt(s.flow.advIn)} được ứng`);
    if (s.flow.repIn) transferBits.push(`+${U.fmt(s.flow.repIn)} được trả`);
    if (s.flow.advOut) transferBits.push(`−${U.fmt(s.flow.advOut)} cho ứng`);
    if (s.flow.repOut) transferBits.push(`−${U.fmt(s.flow.repOut)} đã trả nợ`);

    $('scopePanel').innerHTML = `<div class="stack-panel">
      <div class="stack-hero" style="--c:${st.color}">
        <div class="hero-top">
          <div class="hero-name"><span class="h-ico">${esc(st.icon)}</span>${esc(st.name)}</div>
          <span class="hero-tag">${planTag}</span>
        </div>
        <div class="alloc">
          <div><small>Thu nhập dự kiến</small><b class="num">${U.fmt(s.plan.income)}</b></div>
          <div><small>🔒 Tiết kiệm</small><b class="num">${U.fmt(s.plan.saving)}</b></div>
          <div><small>Hạn mức chi</small><b class="num">${U.fmt(s.plan.limit)}</b></div>
        </div>
        ${owes.length || lends.length ? `<div class="hero-badges">
          ${owes.map((d) => `<span class="badge on-hero">⚠️ Đang nợ ${esc(stackName(d.stackId))}: ${U.fmt(d.amount)}</span>`).join('')}
          ${lends.map((d) => `<span class="badge on-hero lend">📥 Cho ${esc(stackName(d.stackId))} ứng: ${U.fmt(d.amount)}</span>`).join('')}
        </div>` : ''}
        <div class="hero-bar">
          ${progress(s.usedPct, over)}
          <div class="hero-bar-label">
            <span>Đã chi ${U.fmt(s.expense)} / ${U.fmt(s.spendLimit)}</span>
            <span>${transferBits.join(' · ')}</span>
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn btn-white btn-sm" data-act="plan">${s.plan.empty ? '＋ Đặt kế hoạch' : '✎ Sửa kế hoạch'}</button>
          <button class="btn btn-glass btn-sm" data-act="advance" data-to="${sid}" ${Store.get().stacks.length < 2 ? 'disabled' : ''}>⇄ Ứng trước</button>
          ${owes.length ? `<button class="btn btn-glass btn-sm" data-act="repay" data-debtor="${sid}">↩ Hoàn trả nợ nội bộ</button>` : ''}
        </div>
      </div>
      <div class="card debt-card">
        <div class="card-head"><h2>Công nợ nội bộ của ${esc(st.name)}</h2></div>
        <ul class="debt-list">
          ${owes.length || lends.length
            ? debtItemsHtml(owes.map((d) => ({ debtor: sid, creditor: d.stackId, amount: d.amount })), 'owe')
              + debtItemsHtml(lends.map((d) => ({ debtor: d.stackId, creditor: sid, amount: d.amount })), 'lend')
            : '<li class="empty-mini">Không nợ ai, không ai nợ 🎉</li>'}
        </ul>
      </div>
    </div>`;
  }

  /* ---------- Danh sách giao dịch ---------- */
  function buildItems() {
    const sid = scopeId();
    const st = Store.get();
    const items = [];

    st.transactions.forEach((t) => {
      if (U.monthOf(t.date) !== view.month || (sid && t.stackId !== sid)) return;
      const cat = Store.getCategory(t.categoryId) || { name: 'Không rõ', icon: '❓', color: '#64748b' };
      items.push({
        kind: 'tx', id: t.id, date: t.date, createdAt: t.createdAt, amount: t.amount, type: t.type, t, cat,
        search: U.normalizeText([t.title, t.note, cat.name, stackName(t.stackId)].join(' ')),
      });
    });

    st.transfers.forEach((tr) => {
      if (U.monthOf(tr.date) !== view.month) return;
      if (sid && tr.fromStackId !== sid && tr.toStackId !== sid) return;
      const label = tr.kind === 'advance' ? 'Ứng trước' : 'Hoàn trả nợ';
      items.push({
        kind: 'transfer', id: tr.id, date: tr.date, createdAt: tr.createdAt, amount: tr.amount, type: 'transfer', tr,
        search: U.normalizeText([label, 'chuyen noi bo', tr.note, stackName(tr.fromStackId), stackName(tr.toStackId)].join(' ')),
      });
    });

    const q = U.normalizeText(view.search);
    let list = items.filter((x) => (view.type === 'all' || x.type === view.type) && (!q || x.search.includes(q)));

    const byDate = (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;
    const sorters = {
      newest: (a, b) => -byDate(a, b),
      oldest: byDate,
      high: (a, b) => b.amount - a.amount || -byDate(a, b),
      low: (a, b) => a.amount - b.amount || -byDate(a, b),
    };
    return list.sort(sorters[view.sort] || sorters.newest);
  }

  function txRowHtml(x) {
    const sid = scopeId();
    if (x.kind === 'tx') {
      const t = x.t;
      const st = Store.getStack(t.stackId);
      const sign = t.type === 'income' ? '+' : '−';
      return `<li class="tx" data-kind="tx" data-id="${t.id}">
        <span class="tx-ico" style="--c:${x.cat.color}">${esc(x.cat.icon)}</span>
        <div class="tx-main">
          <div class="tx-title">${esc(t.title || x.cat.name)}${t.recurring ? '<span class="tag-rec" title="Lặp lại hàng tháng">🔁<span class="tag-txt"> Cố định</span></span>' : ''}</div>
          <div class="tx-meta">
            <span>${esc(x.cat.name)}</span>
            ${!sid && st ? `<span class="sep">•</span><span class="chip-stack" style="--c:${st.color}">${esc(st.name)}</span>` : ''}
            ${view.sort === 'high' || view.sort === 'low' ? `<span class="sep">•</span><span>${U.dateLabel(t.date)}</span>` : ''}
            ${t.note ? `<span class="sep">•</span><span class="tx-note">${esc(t.note)}</span>` : ''}
          </div>
        </div>
        <span class="tx-amt num ${t.type}">${sign}${U.fmt(t.amount)}</span>
        <button class="tx-del" data-del aria-label="Xóa"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
      </li>`;
    }
    const tr = x.tr;
    const isAdv = tr.kind === 'advance';
    let sign = '⇄ ';
    if (sid) sign = tr.toStackId === sid ? '+' : '−';
    return `<li class="tx transfer" data-kind="transfer" data-id="${tr.id}">
      <span class="tx-ico">${isAdv ? '🔄' : '↩️'}</span>
      <div class="tx-main">
        <div class="tx-title">${isAdv ? 'Ứng trước' : 'Hoàn trả nợ'}: ${esc(stackName(tr.fromStackId))} → ${esc(stackName(tr.toStackId))}</div>
        <div class="tx-meta"><span>Chuyển nội bộ · không tính thu/chi</span>
          ${view.sort === 'high' || view.sort === 'low' ? `<span class="sep">•</span><span>${U.dateLabel(tr.date)}</span>` : ''}
          ${tr.note ? `<span class="sep">•</span><span class="tx-note">${esc(tr.note)}</span>` : ''}</div>
      </div>
      <span class="tx-amt num transfer">${sign}${U.fmt(tr.amount)}</span>
      <button class="tx-del" data-del aria-label="Xóa"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </li>`;
  }

  function renderTxList() {
    const list = buildItems();
    $('txCount').textContent = list.length ? `(${list.length})` : '';
    if (!list.length) {
      const filtered = view.search || view.type !== 'all';
      $('txList').innerHTML = `<li class="empty"><span class="e-ico">${filtered ? '🔍' : '🧾'}</span>
        ${filtered ? 'Không tìm thấy giao dịch phù hợp' : `Chưa có giao dịch trong ${U.monthLabel(view.month)}`}</li>`;
      return;
    }
    const grouped = view.sort === 'newest' || view.sort === 'oldest';
    if (!grouped) { $('txList').innerHTML = list.map(txRowHtml).join(''); return; }

    let html = '', lastDate = null;
    list.forEach((x) => {
      if (x.date !== lastDate) {
        lastDate = x.date;
        const [y, m, d] = x.date.split('-').map(Number);
        const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
        const dayNet = list.filter((i) => i.date === x.date && i.kind === 'tx')
          .reduce((a, i) => a + (i.type === 'income' ? i.amount : -i.amount), 0);
        html += `<li class="tx-day"><span>${wd}, ${U.dateLabel(x.date)}${x.date === U.todayStr() ? ' · Hôm nay' : ''}</span>
          <span class="num">${dayNet ? (dayNet > 0 ? '+' : '−') + U.fmt(Math.abs(dayNet)) : ''}</span></li>`;
      }
      html += txRowHtml(x);
    });
    $('txList').innerHTML = html;
  }

  $('txList').addEventListener('click', async (e) => {
    const row = e.target.closest('.tx');
    if (!row) return;
    const { kind, id } = row.dataset;
    if (e.target.closest('[data-del]')) {
      if (kind === 'tx') {
        const t = Store.get().transactions.find((x) => x.id === id);
        if (await confirmDialog(`Xóa giao dịch "${t.title || 'không tên'}" (${U.fmt(t.amount)})?`, { yes: 'Xóa' })) {
          Store.deleteTransaction(id);
          toast('Đã xóa giao dịch');
        }
      } else {
        const tr = Store.get().transfers.find((x) => x.id === id);
        const msg = tr.kind === 'advance'
          ? `Xóa khoản ứng trước ${U.fmt(tr.amount)}? Công nợ giữa ${stackName(tr.fromStackId)} và ${stackName(tr.toStackId)} sẽ được tính lại.`
          : `Xóa khoản hoàn trả ${U.fmt(tr.amount)}? Số nợ sẽ tăng lại tương ứng.`;
        if (await confirmDialog(msg, { yes: 'Xóa' })) {
          try { Ledger.removeTransfer(id); toast('Đã xóa'); } catch (err) { toast(err.message, { error: true }); }
        }
      }
      return;
    }
    if (kind === 'tx') openTxModal(Store.get().transactions.find((x) => x.id === id));
  });

  $('txSearch').addEventListener('input', U.debounce((e) => { view.search = e.target.value; renderTxList(); }, 150));
  $('txType').addEventListener('change', (e) => { view.type = e.target.value; renderTxList(); });
  $('txSort').value = view.sort;
  $('txSort').addEventListener('change', (e) => { view.sort = e.target.value; saveView(); renderTxList(); });

  /* ---------- Hành động chung (data-act) ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) {
      const ms = e.target.closest('.mini-stack[data-scope]');
      if (ms) { view.scope = ms.dataset.scope; saveView(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      return;
    }
    const d = b.dataset;
    switch (d.act) {
      case 'advance': return openAdvanceModal({ to: d.to, amount: Number(d.amount) || 0 });
      case 'repay': return openRepayModal({ debtorId: d.debtor, creditorId: d.creditor });
      case 'plan': return openPlanModal(scopeId());
      case 'manage-stacks': return openStackModal();
      case 'copy-recurring': return copyRecurring();
      case 'dismiss-recurring': Store.dismissRecurring(view.month, scopeId()); return;
    }
  });

  function copyRecurring() {
    const n = Store.copyRecurring(view.month, scopeId());
    if (n) toast(`Đã tạo ${n} khoản cố định cho ${U.monthLabel(view.month)}`);
    else toast(`Không có khoản cố định nào từ ${U.monthLabel(U.shiftMonth(view.month, -1))} cần sao chép`);
  }
  $('btnCopyRecurring').addEventListener('click', copyRecurring);

  /* =====================================================
   * MODAL GIAO DỊCH
   * ===================================================== */
  const txForm = { editingId: null, type: 'expense', categoryId: null };
  bindAmountInput($('txAmount'));

  function renderCatPicker() {
    const cats = Store.categoriesOf(txForm.type);
    if (!cats.some((c) => c.id === txForm.categoryId)) txForm.categoryId = cats[0]?.id || null;
    $('txCatPicker').innerHTML = cats.map((c) => `
      <button type="button" class="cat-opt ${c.id === txForm.categoryId ? 'active' : ''}" data-id="${c.id}" style="--c:${c.color}">
        <span class="co-ico">${esc(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('');
  }

  function setTxType(type) {
    txForm.type = type;
    $('txTypeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    renderCatPicker();
  }

  function openTxModal(tx) {
    txForm.editingId = tx?.id || null;
    $('txModalTitle').textContent = tx ? 'Sửa giao dịch' : 'Thêm giao dịch';
    $('txDelete').hidden = !tx;
    $('txStack').innerHTML = Store.get().stacks.map((s) => `<option value="${s.id}">${esc(s.icon)} ${esc(s.name)}</option>`).join('');

    txForm.categoryId = tx?.categoryId || null;
    setTxType(tx?.type || 'expense');
    setAmount('txAmount', tx?.amount || 0);
    $('txTitle').value = tx?.title || '';
    $('txNote').value = tx?.note || '';
    $('txRecurring').checked = !!tx?.recurring;
    $('txStack').value = tx?.stackId || scopeId() || Store.get().stacks[0].id;
    $('txDate').value = tx?.date || (view.month === U.currentMonth() ? U.todayStr() : `${view.month}-01`);
    Modal.open('txModal');
  }

  $('txTypeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) setTxType(b.dataset.type);
  });
  $('txCatPicker').addEventListener('click', (e) => {
    const b = e.target.closest('.cat-opt');
    if (!b) return;
    txForm.categoryId = b.dataset.id;
    renderCatPicker();
  });
  $('txManageCats').addEventListener('click', () => openCatModal(txForm.type));

  $('txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = amountOf('txAmount');
    if (amount <= 0) return toast('Số tiền chưa hợp lệ (VD: 50k, 1tr5, 2tr300k)', { error: true });
    if (!txForm.categoryId) return toast('Chọn danh mục', { error: true });
    const data = {
      type: txForm.type,
      amount,
      categoryId: txForm.categoryId,
      title: $('txTitle').value.trim() || Store.getCategory(txForm.categoryId)?.name || '',
      note: $('txNote').value.trim(),
      stackId: $('txStack').value,
      date: $('txDate').value || U.todayStr(),
      recurring: $('txRecurring').checked,
    };
    if (txForm.editingId) {
      const old = Store.get().transactions.find((t) => t.id === txForm.editingId);
      if (!data.recurring && old?.recurring) data.seriesId = old.seriesId; // giữ chuỗi để không bị gợi ý lại
      Store.updateTransaction(txForm.editingId, data);
      toast('Đã cập nhật giao dịch');
    } else {
      Store.addTransaction(data);
      toast(`Đã thêm ${data.type === 'income' ? 'khoản thu' : 'khoản chi'} ${U.fmt(amount)}`);
    }
    Modal.close('txModal');

    // Nếu chi vượt hạn mức -> gợi ý ứng trước từ Stack khác
    if (data.type === 'expense') {
      const m = U.monthOf(data.date);
      const s = Ledger.stackMonth(data.stackId, m);
      if (!s.plan.empty && s.remaining < 0 && Store.get().stacks.length > 1) {
        toast(`${stackName(data.stackId)} vượt hạn mức ${U.fmt(-s.remaining)}`, {
          actionLabel: 'Ứng trước',
          onAction: () => openAdvanceModal({ to: data.stackId, amount: -s.remaining, date: data.date }),
        });
      }
    }
  });

  $('txDelete').addEventListener('click', async () => {
    if (!txForm.editingId) return;
    if (await confirmDialog('Xóa giao dịch này?', { yes: 'Xóa' })) {
      Store.deleteTransaction(txForm.editingId);
      Modal.close('txModal');
      toast('Đã xóa giao dịch');
    }
  });

  $('btnAddTx').addEventListener('click', () => openTxModal());
  $('fabAdd').addEventListener('click', () => openTxModal());

  /* =====================================================
   * MODAL KẾ HOẠCH THÁNG
   * ===================================================== */
  let planStackId = null, planAuto = true;
  ['planIncome', 'planSaving', 'planLimit'].forEach((id) => bindAmountInput($(id)));

  function updatePlanPreview() {
    const inc = amountOf('planIncome'), sav = amountOf('planSaving');
    if (planAuto) setAmount('planLimit', Math.max(0, inc - sav));
    const lim = amountOf('planLimit');
    const total = Math.max(inc, sav + lim, 1);
    const free = Math.max(0, inc - sav - lim);
    $('planPreview').innerHTML = `
      <i style="width:${(sav / total) * 100}%;background:var(--green)"></i>
      <i style="width:${(lim / total) * 100}%;background:var(--purple)"></i>
      <i style="width:${(free / total) * 100}%;background:var(--text-3);opacity:.35"></i>`;
    const legend = `<div class="alloc-legend">
      <span style="--c:var(--green)">Tiết kiệm ${U.fmt(sav)}</span>
      <span style="--c:var(--purple)">Được chi ${U.fmt(lim)}</span>
      ${free ? `<span style="--c:var(--text-3)">Chưa phân bổ ${U.fmt(free)}</span>` : ''}</div>`;
    $('planPreview').nextElementSibling?.classList?.contains('alloc-legend') && $('planPreview').nextElementSibling.remove();
    $('planPreview').insertAdjacentHTML('afterend', legend);
    const hint = $('planHint');
    if (inc && sav + lim > inc) {
      hint.className = 'hint warn';
      hint.innerHTML = `⚠️ Tiết kiệm + Hạn mức (${U.fmt(sav + lim)}) đang lớn hơn thu nhập dự kiến.`;
    } else {
      hint.className = 'hint';
      hint.innerHTML = planHintText;
    }
  }
  let planHintText = '';

  function openPlanModal(stackId) {
    if (!stackId) return;
    planStackId = stackId;
    const st = Store.getStack(stackId);
    const p = Store.getPlan(stackId, view.month);
    $('planModalTitle').textContent = `Kế hoạch ${U.monthLabel(view.month)} · ${st.name}`;
    planHintText = `Áp dụng cho <b>${U.monthLabel(view.month)}</b>. Các tháng sau chưa đặt riêng sẽ tự kế thừa kế hoạch này.`;
    setAmount('planIncome', p.income);
    setAmount('planSaving', p.saving);
    setAmount('planLimit', p.limit);
    planAuto = p.empty || p.limit === Math.max(0, p.income - p.saving);
    updatePlanPreview();
    Modal.open('planModal');
  }

  $('planIncome').addEventListener('input', updatePlanPreview);
  $('planSaving').addEventListener('input', updatePlanPreview);
  $('planLimit').addEventListener('input', () => { planAuto = false; updatePlanPreview(); });
  $('planAuto').addEventListener('click', () => { planAuto = true; updatePlanPreview(); });

  $('planForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Store.setPlan(planStackId, view.month, {
      income: amountOf('planIncome'), saving: amountOf('planSaving'), limit: amountOf('planLimit'),
    });
    Modal.close('planModal');
    toast('Đã lưu kế hoạch tháng');
  });

  /* =====================================================
   * MODAL ỨNG TRƯỚC
   * ===================================================== */
  bindAmountInput($('advAmount'));

  function updateAdvanceInfo() {
    const from = $('advFrom').value, to = $('advTo').value;
    const info = $('advInfo');
    if (from === to) {
      info.className = 'hint warn';
      info.innerHTML = 'Hãy chọn 2 Stack khác nhau.';
      return;
    }
    const m = U.monthOf($('advDate').value || `${view.month}-01`);
    const sf = Ledger.stackMonth(from, m);
    const st = Ledger.stackMonth(to, m);
    const existing = Ledger.pairDebt(to, from);
    const amt = amountOf('advAmount');
    const bits = [];
    bits.push(`<b>${esc(stackName(from))}</b> ${sf.plan.empty ? `số dư tháng ${U.fmt(sf.balance)}` : `còn hạn mức ${U.fmt(sf.remaining)}`}`);
    if (!st.plan.empty) bits.push(`<b>${esc(stackName(to))}</b> ${st.remaining < 0 ? 'đang vượt' : 'còn'} ${U.fmt(Math.abs(st.remaining))}`);
    if (existing) bits.push(`${esc(stackName(to))} đang nợ ${esc(stackName(from))} ${U.fmt(existing)}`);
    const exceed = !sf.plan.empty && amt > sf.remaining;
    info.className = 'hint' + (exceed ? ' warn' : '');
    info.innerHTML = bits.join(' · ') + (exceed ? `<br>⚠️ Số tiền ứng lớn hơn hạn mức còn lại của ${esc(stackName(from))}.` : '');
  }

  function openAdvanceModal({ from, to, amount = 0, date } = {}) {
    const stacks = Store.get().stacks;
    if (stacks.length < 2) return toast('Cần ít nhất 2 Stack để ứng trước', { error: true });
    const opts = stacks.map((s) => `<option value="${s.id}">${esc(s.icon)} ${esc(s.name)}</option>`).join('');
    $('advFrom').innerHTML = opts;
    $('advTo').innerHTML = opts;
    const toId = to || scopeId() || stacks[0].id;
    // Mặc định nguồn = Stack khác còn nhiều hạn mức nhất
    const m = U.monthOf(date || `${view.month}-01`);
    const fromId = from || stacks.filter((s) => s.id !== toId)
      .map((s) => ({ id: s.id, r: Ledger.stackMonth(s.id, m).remaining }))
      .sort((a, b) => b.r - a.r)[0].id;
    $('advTo').value = toId;
    $('advFrom').value = fromId;
    setAmount('advAmount', amount);
    $('advDate').value = date || (view.month === U.currentMonth() ? U.todayStr() : `${view.month}-01`);
    $('advNote').value = '';
    updateAdvanceInfo();
    Modal.open('advanceModal');
    setTimeout(() => $('advAmount').focus(), 80);
  }

  ['advFrom', 'advTo', 'advDate'].forEach((id) => $(id).addEventListener('change', updateAdvanceInfo));
  $('advAmount').addEventListener('input', updateAdvanceInfo);

  $('advanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fromId = $('advFrom').value, toId = $('advTo').value, amount = amountOf('advAmount');
    const date = $('advDate').value || U.todayStr();
    const sf = Ledger.stackMonth(fromId, U.monthOf(date));
    if (fromId !== toId && amount > 0 && !sf.plan.empty && amount > sf.remaining) {
      const ok = await confirmDialog(
        `${stackName(fromId)} chỉ còn ${U.fmt(Math.max(0, sf.remaining))} hạn mức. Vẫn cho ứng ${U.fmt(amount)}?`,
        { title: 'Vượt hạn mức nguồn', yes: 'Vẫn ứng', danger: false });
      if (!ok) return;
    }
    try {
      Ledger.advance({ fromId, toId, amount, date, note: $('advNote').value.trim() });
      Modal.close('advanceModal');
      toast(`${stackName(fromId)} đã cho ${stackName(toId)} ứng ${U.fmt(amount)}`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  /* =====================================================
   * MODAL HOÀN TRẢ NỢ
   * ===================================================== */
  bindAmountInput($('repayAmount'));
  let repayDebts = [];

  function selectedDebt() {
    const i = Number(document.querySelector('input[name="repayPick"]:checked')?.value);
    return repayDebts[i];
  }

  function openRepayModal({ debtorId, creditorId } = {}) {
    const sid = scopeId();
    repayDebts = Ledger.allDebts().filter((d) => !sid || d.debtor === sid || d.creditor === sid);
    if (!repayDebts.length) return toast('Không có khoản nợ nội bộ nào cần trả');
    let pick = repayDebts.findIndex((d) => (!debtorId || d.debtor === debtorId) && (!creditorId || d.creditor === creditorId));
    if (pick < 0) pick = 0;
    $('repayOptions').innerHTML = repayDebts.map((d, i) => `
      <label class="debt-opt"><input type="radio" name="repayPick" value="${i}" ${i === pick ? 'checked' : ''}>
        <span class="do-text"><b style="color:inherit">${esc(stackName(d.debtor))}</b> trả cho <b style="color:inherit">${esc(stackName(d.creditor))}</b></span>
        <b class="num">${U.fmt(d.amount)}</b></label>`).join('');
    setAmount('repayAmount', repayDebts[pick].amount);
    $('repayDate').value = view.month === U.currentMonth() ? U.todayStr() : `${view.month}-01`;
    $('repayNote').value = '';
    Modal.open('repayModal');
  }

  $('repayOptions').addEventListener('change', () => setAmount('repayAmount', selectedDebt()?.amount || 0));
  $('repayFull').addEventListener('click', () => setAmount('repayAmount', selectedDebt()?.amount || 0));

  $('repayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = selectedDebt();
    if (!d) return;
    const amount = amountOf('repayAmount');
    try {
      Ledger.repay({ debtorId: d.debtor, creditorId: d.creditor, amount, date: $('repayDate').value || U.todayStr(), note: $('repayNote').value.trim() });
      Modal.close('repayModal');
      const left = Ledger.pairDebt(d.debtor, d.creditor);
      toast(left ? `Đã trả ${U.fmt(amount)} · còn nợ ${U.fmt(left)}` : `Đã tất toán nợ giữa ${stackName(d.debtor)} và ${stackName(d.creditor)} ✓`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  /* =====================================================
   * MODAL DANH MỤC
   * ===================================================== */
  const catForm = { type: 'expense', editingId: null, icon: '🍜', color: COLORS[1] };

  function renderEmojiGrid(gridId, list, selected) {
    $(gridId).innerHTML = list.map((e) => `<button type="button" class="${e === selected ? 'active' : ''}" data-emoji="${e}">${e}</button>`).join('');
  }
  function renderSwatches(boxId, selected) {
    const isCustom = !COLORS.includes(selected);
    $(boxId).innerHTML = COLORS.map((c) => `<button type="button" style="background:${c}" class="${c === selected ? 'active' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('')
      + `<input type="color" value="${selected}" title="Màu tùy chỉnh" ${isCustom ? 'style="box-shadow:0 0 0 2.5px var(--text)"' : ''}>`;
  }

  function renderCatModal() {
    $('catTypeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.type === catForm.type));
    $('catList').innerHTML = Store.categoriesOf(catForm.type).map((c) => {
      const n = Store.countCategoryUsage(c.id);
      return `<li class="cat-row" data-id="${c.id}">
        <span class="cr-ico" style="--c:${c.color}">${esc(c.icon)}</span>
        <span class="cr-name">${esc(c.name)}<small>${n} giao dịch</small></span>
        <button class="icon-btn" data-cat-edit aria-label="Sửa"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="icon-btn del" data-cat-del aria-label="Xóa"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
      </li>`;
    }).join('');
    renderCatFormState();
  }

  function renderCatFormState() {
    const editing = !!catForm.editingId;
    $('catFormTitle').textContent = editing ? 'Sửa danh mục' : `Thêm danh mục ${catForm.type === 'expense' ? 'chi' : 'thu'} mới`;
    $('catSubmit').textContent = editing ? 'Lưu thay đổi' : 'Thêm danh mục';
    $('catCancelEdit').hidden = !editing;
    $('catPreview').textContent = catForm.icon;
    $('catPreview').style.setProperty('--c', catForm.color);
    renderEmojiGrid('catEmojiGrid', EMOJIS, catForm.icon);
    renderSwatches('catSwatches', catForm.color);
  }

  function resetCatForm() {
    catForm.editingId = null;
    catForm.icon = catForm.type === 'expense' ? '🍜' : '💰';
    catForm.color = COLORS[(Store.categoriesOf(catForm.type).length * 3) % COLORS.length];
    $('catName').value = '';
    $('catEmojiCustom').value = '';
  }

  function openCatModal(type = 'expense') {
    catForm.type = type;
    resetCatForm();
    renderCatModal();
    Modal.open('catModal');
  }

  $('catTypeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    catForm.type = b.dataset.type;
    resetCatForm();
    renderCatModal();
  });
  $('catEmojiGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    catForm.icon = b.dataset.emoji;
    $('catEmojiCustom').value = '';
    renderCatFormState();
  });
  $('catEmojiCustom').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (v) { catForm.icon = [...v].slice(0, 2).join(''); $('catPreview').textContent = catForm.icon; }
  });
  $('catSwatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    catForm.color = b.dataset.color;
    renderCatFormState();
  });
  $('catSwatches').addEventListener('input', (e) => {
    if (e.target.type !== 'color') return;
    catForm.color = e.target.value;
    $('catPreview').style.setProperty('--c', catForm.color);
  });
  $('catSwatches').addEventListener('change', (e) => { if (e.target.type === 'color') renderCatFormState(); });

  $('catList').addEventListener('click', async (e) => {
    const row = e.target.closest('.cat-row');
    if (!row) return;
    const cat = Store.getCategory(row.dataset.id);
    if (e.target.closest('[data-cat-edit]')) {
      catForm.editingId = cat.id;
      catForm.icon = cat.icon;
      catForm.color = cat.color;
      $('catName').value = cat.name;
      renderCatFormState();
      $('catName').focus();
    } else if (e.target.closest('[data-cat-del]')) {
      const n = Store.countCategoryUsage(cat.id);
      const ok = await confirmDialog(
        `Xóa danh mục "${cat.name}"?` + (n ? `\n${n} giao dịch đang dùng sẽ được chuyển sang danh mục "Khác".` : ''), { yes: 'Xóa' });
      if (!ok) return;
      try { Store.deleteCategory(cat.id); toast('Đã xóa danh mục'); } catch (err) { toast(err.message, { error: true }); }
    }
  });

  $('catCancelEdit').addEventListener('click', () => { resetCatForm(); renderCatFormState(); });

  $('catForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('catName').value.trim();
    if (!name) return;
    const dup = Store.categoriesOf(catForm.type).find((c) => c.id !== catForm.editingId && U.normalizeText(c.name) === U.normalizeText(name));
    if (dup) return toast('Danh mục này đã tồn tại', { error: true });
    if (catForm.editingId) {
      Store.updateCategory(catForm.editingId, { name, icon: catForm.icon, color: catForm.color });
      toast('Đã cập nhật danh mục');
    } else {
      const c = Store.addCategory({ type: catForm.type, name, icon: catForm.icon, color: catForm.color });
      if (Modal.isOpen('txModal') && txForm.type === c.type) txForm.categoryId = c.id;
      toast('Đã thêm danh mục');
    }
    resetCatForm();
    renderCatModal();
  });

  /* =====================================================
   * MODAL STACK
   * ===================================================== */
  const stackForm = { editingId: null, icon: '🏦', color: COLORS[7] };

  function renderStackModal() {
    const debts = Ledger.allDebts();
    $('stackList').innerHTML = Store.get().stacks.map((s) => {
      const n = Store.get().transactions.filter((t) => t.stackId === s.id).length;
      const owe = debts.filter((d) => d.debtor === s.id).reduce((a, d) => a + d.amount, 0);
      return `<li class="cat-row" data-id="${s.id}">
        <span class="cr-ico" style="--c:${s.color}">${esc(s.icon)}</span>
        <span class="cr-name">${esc(s.name)}<small>${n} giao dịch${owe ? ` · đang nợ ${U.fmt(owe)}` : ''}</small></span>
        <button class="icon-btn" data-stack-edit aria-label="Sửa"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="icon-btn del" data-stack-del aria-label="Xóa"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
      </li>`;
    }).join('');
    const editing = !!stackForm.editingId;
    $('stackFormTitle').textContent = editing ? 'Sửa Stack' : 'Thêm Stack mới';
    $('stackSubmit').textContent = editing ? 'Lưu thay đổi' : 'Thêm Stack';
    $('stackCancelEdit').hidden = !editing;
    $('stackPreview').textContent = stackForm.icon;
    $('stackPreview').style.setProperty('--c', stackForm.color);
    renderEmojiGrid('stackEmojiGrid', STACK_EMOJIS, stackForm.icon);
    renderSwatches('stackSwatches', stackForm.color);
  }

  function resetStackForm() {
    stackForm.editingId = null;
    stackForm.icon = '🏦';
    const used = Store.get().stacks.map((s) => s.color);
    stackForm.color = COLORS.find((c) => !used.includes(c)) || COLORS[7];
    $('stackName').value = '';
  }

  function openStackModal() {
    resetStackForm();
    renderStackModal();
    Modal.open('stackModal');
  }

  $('stackEmojiGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (b) { stackForm.icon = b.dataset.emoji; renderStackModal(); }
  });
  $('stackSwatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (b) { stackForm.color = b.dataset.color; renderStackModal(); }
  });
  $('stackSwatches').addEventListener('input', (e) => {
    if (e.target.type === 'color') { stackForm.color = e.target.value; $('stackPreview').style.setProperty('--c', stackForm.color); }
  });
  $('stackCancelEdit').addEventListener('click', () => { resetStackForm(); renderStackModal(); });

  $('stackList').addEventListener('click', async (e) => {
    const row = e.target.closest('.cat-row');
    if (!row) return;
    const s = Store.getStack(row.dataset.id);
    if (e.target.closest('[data-stack-edit]')) {
      stackForm.editingId = s.id;
      stackForm.icon = s.icon;
      stackForm.color = s.color;
      $('stackName').value = s.name;
      renderStackModal();
      $('stackName').focus();
    } else if (e.target.closest('[data-stack-del]')) {
      const n = Store.get().transactions.filter((t) => t.stackId === s.id).length;
      const hasDebt = Ledger.allDebts().some((d) => d.debtor === s.id || d.creditor === s.id);
      const ok = await confirmDialog(
        `Xóa Stack "${s.name}"?\nToàn bộ ${n} giao dịch, kế hoạch` + (hasDebt ? ' và công nợ nội bộ' : '') + ' của Stack này sẽ bị xóa vĩnh viễn.',
        { yes: 'Xóa Stack' });
      if (!ok) return;
      try { Store.deleteStack(s.id); resetStackForm(); renderStackModal(); toast('Đã xóa Stack'); } catch (err) { toast(err.message, { error: true }); }
    }
  });

  $('stackForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('stackName').value.trim();
    if (!name) return;
    if (stackForm.editingId) {
      Store.updateStack(stackForm.editingId, { name, icon: stackForm.icon, color: stackForm.color });
      toast('Đã cập nhật Stack');
      resetStackForm();
      renderStackModal();
    } else {
      const s = Store.addStack({ name, icon: stackForm.icon, color: stackForm.color });
      Modal.close('stackModal');
      view.scope = s.id;
      saveView();
      render();
      toast(`Đã tạo Stack "${s.name}" — đặt kế hoạch tháng cho nó nhé`, { actionLabel: 'Đặt kế hoạch', onAction: () => openPlanModal(s.id) });
    }
  });

  /* =====================================================
   * MENU DỮ LIỆU: Sao lưu / Khôi phục / Excel
   * ===================================================== */
  $('btnMenu').addEventListener('click', (e) => { e.stopPropagation(); $('menu').classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) $('menu').classList.remove('open'); });

  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    $('menu').classList.remove('open');
    ({ backup, restore: () => $('fileRestore').click(), excel: exportExcel, categories: () => openCatModal(), stacks: openStackModal })[b.dataset.action]?.();
  });

  function backup() {
    const json = JSON.stringify(Store.exportData(), null, 2);
    U.download(`quan-ly-chi-tieu-sao-luu-${U.todayStr()}.json`, new Blob([json], { type: 'application/json' }));
    toast('Đã tải file sao lưu');
  }

  $('fileRestore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const ok = await confirmDialog(`Khôi phục từ "${file.name}"?\nDữ liệu hiện tại sẽ bị THAY THẾ. Nên bấm "Sao lưu" trước nếu chưa.`,
        { title: 'Khôi phục dữ liệu', yes: 'Khôi phục' });
      if (!ok) return;
      const n = Store.importData(obj);
      toast(`Khôi phục thành công · ${n} giao dịch`);
    } catch (err) {
      toast('Không đọc được file: ' + err.message, { error: true });
    }
  });

  function exportRows() {
    const st = Store.get();
    const tx = [...st.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).map((t) => {
      const c = Store.getCategory(t.categoryId);
      return {
        'Ngày': U.dateLabel(t.date),
        'Tháng': U.monthLabel(U.monthOf(t.date)),
        'Stack / Ngân hàng': stackName(t.stackId),
        'Loại': t.type === 'income' ? 'Thu' : 'Chi',
        'Danh mục': c ? c.name : 'Không rõ',
        'Tên giao dịch': t.title,
        'Ghi chú': t.note,
        'Số tiền': t.amount,
        'Thu/Chi (+/−)': t.type === 'income' ? t.amount : -t.amount,
        'Lặp lại hàng tháng': t.recurring ? 'Có' : '',
      };
    });
    const transfers = [...st.transfers].sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({
      'Ngày': U.dateLabel(t.date),
      'Loại': t.kind === 'advance' ? 'Ứng trước' : 'Hoàn trả nợ',
      'Từ Stack': stackName(t.fromStackId),
      'Sang Stack': stackName(t.toStackId),
      'Số tiền': t.amount,
      'Ghi chú': t.note || '',
    }));
    const debts = Ledger.allDebts().map((d) => ({
      'Stack đang nợ': stackName(d.debtor), 'Chủ nợ': stackName(d.creditor), 'Số tiền nợ': d.amount,
    }));
    return { tx, transfers, debts };
  }

  async function exportExcel() {
    const { tx, transfers, debts } = exportRows();
    if (!tx.length && !transfers.length) return toast('Chưa có giao dịch nào để xuất');
    try {
      await U.loadScript(SHEETJS_URL);
      const wb = XLSX.utils.book_new();
      const addSheet = (rows, name, widths, moneyCols) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'Không có dữ liệu' }]);
        ws['!cols'] = widths.map((w) => ({ wch: w }));
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let r = 1; r <= range.e.r; r++) {
          moneyCols.forEach((c) => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = '#,##0'; });
        }
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      addSheet(tx, 'Giao dịch', [12, 14, 18, 7, 16, 26, 26, 14, 14, 10], [7, 8]);
      addSheet(transfers, 'Chuyển nội bộ', [12, 14, 18, 18, 14, 26], [4]);
      addSheet(debts, 'Công nợ hiện tại', [18, 18, 14], [2]);
      XLSX.writeFile(wb, `chi-tieu-${U.todayStr()}.xlsx`);
      toast('Đã xuất file Excel');
    } catch (err) {
      // Không tải được thư viện -> xuất CSV (mở được bằng Excel)
      const headers = Object.keys(tx[0] || { 'Ngày': '' });
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [headers.map(q).join(','), ...tx.map((r) => headers.map((h) => q(r[h])).join(','))].join('\r\n');
      U.download(`chi-tieu-${U.todayStr()}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      toast('Không tải được thư viện Excel, đã xuất file .csv thay thế');
    }
  }

  /* =====================================================
   * THEME & THÁNG
   * ===================================================== */
  function applyThemeMeta() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0c0f16' : '#f4f6fb';
  }
  $('btnTheme').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    applyThemeMeta();
    Charts.render(view.month, scopeId()); // vẽ lại biểu đồ với màu mới
  });

  const goMonth = (m) => { if (m) { view.month = m; render(); } };
  $('prevMonth').addEventListener('click', () => goMonth(U.shiftMonth(view.month, -1)));
  $('nextMonth').addEventListener('click', () => goMonth(U.shiftMonth(view.month, 1)));
  $('monthPicker').addEventListener('change', (e) => goMonth(e.target.value));
  $('monthPicker').addEventListener('click', (e) => {
    try { e.target.showPicker?.(); } catch (_) {}
  });
  document.addEventListener('keydown', (e) => {
    if (Modal.top() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowLeft' && e.altKey) goMonth(U.shiftMonth(view.month, -1));
    if (e.key === 'ArrowRight' && e.altKey) goMonth(U.shiftMonth(view.month, 1));
  });

  /* =====================================================
   * KHỞI ĐỘNG
   * ===================================================== */
  Store.load();
  Store.subscribe(() => {
    render();
    if (Modal.isOpen('txModal')) renderCatPicker();
    if (Modal.isOpen('catModal')) renderCatModal();
    if (Modal.isOpen('stackModal')) renderStackModal();
  });
  applyThemeMeta();
  render();
  if (Store.migratedCount) toast(`Đã chuyển ${Store.migratedCount} giao dịch từ bản cũ vào ${Store.get().stacks[0].name}`, { duration: 6000 });
})();
