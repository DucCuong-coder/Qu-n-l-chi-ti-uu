/* =========================================================
 * store.js — STATE & LƯU TRỮ
 * Nguồn dữ liệu duy nhất của app. Mọi thay đổi đều đi qua
 * các hàm ở đây -> commit() -> lưu localStorage -> báo UI vẽ lại.
 *
 * Cấu trúc state (version 2):
 * {
 *   version: 2,
 *   stacks:       [{ id, name, color, icon }],
 *   plans:        { [stackId]: { ["YYYY-MM"]: { income, saving, limit } } },
 *   transactions: [{ id, stackId, type:'income'|'expense', amount, categoryId,
 *                    title, note, date:'YYYY-MM-DD', recurring, paid, seriesId, createdAt }],
 *      (paid: chỉ có ý nghĩa với khoản CHI — chưa tick thì KHÔNG tính vào tổng chi)
 *   transfers:    [{ id, kind:'advance'|'repay', fromStackId, toStackId,
 *                    amount, date, note, createdAt }],
 *   categories:   [{ id, type, name, icon, color }],
 *   dismissedRecurring: { ["YYYY-MM|scope"]: true }
 * }
 * ========================================================= */
const STORAGE_KEY = 'qlct_v2';

const Store = (() => {
  let state = null;
  const listeners = new Set();

  /* ---------- Dữ liệu mặc định ---------- */
  function defaultCategories() {
    const c = (type, name, icon, color) => ({ id: U.uid(), type, name, icon, color });
    return [
      c('expense', 'Ăn uống', '🍜', '#f97316'),
      c('expense', 'Di chuyển', '🛵', '#0ea5e9'),
      c('expense', 'Mua sắm', '🛍️', '#ec4899'),
      c('expense', 'Nhà ở', '🏠', '#8b5cf6'),
      c('expense', 'Điện nước', '💡', '#eab308'),
      c('expense', 'Giải trí', '🎮', '#14b8a6'),
      c('expense', 'Sức khỏe', '💊', '#ef4444'),
      c('expense', 'Học tập', '📚', '#6366f1'),
      c('expense', 'Khác', '📦', '#64748b'),
      c('income', 'Lương', '💰', '#16a34a'),
      c('income', 'Làm thêm', '💼', '#0d9488'),
      c('income', 'Thưởng', '🎁', '#d946ef'),
      c('income', 'Khác', '💵', '#64748b'),
    ];
  }

  function defaultState() {
    return {
      version: 2,
      stacks: [
        { id: U.uid(), name: 'MB Bank', color: '#2563eb', icon: '🏦' },
        { id: U.uid(), name: 'Techcombank', color: '#dc2626', icon: '💳' },
      ],
      plans: {},
      transactions: [],
      transfers: [],
      categories: defaultCategories(),
      dismissedRecurring: {},
    };
  }

  /** Bổ sung trường thiếu, loại bản ghi hỏng — dùng khi load và khi import */
  function normalize(s) {
    const out = {
      version: 2,
      stacks: Array.isArray(s.stacks) ? s.stacks.filter((x) => x && x.id) : [],
      plans: s.plans && typeof s.plans === 'object' ? s.plans : {},
      transactions: Array.isArray(s.transactions) ? s.transactions : [],
      transfers: Array.isArray(s.transfers) ? s.transfers : [],
      categories: Array.isArray(s.categories) ? s.categories : [],
      dismissedRecurring: s.dismissedRecurring || {},
    };
    if (!out.stacks.length) out.stacks = defaultState().stacks;
    if (!out.categories.length) out.categories = defaultCategories();

    const stackIds = new Set(out.stacks.map((x) => x.id));
    out.transactions = out.transactions
      .filter((t) => t && stackIds.has(t.stackId) && Number(t.amount) > 0 && t.date)
      .map((t) => ({
        id: t.id || U.uid(),
        stackId: t.stackId,
        type: t.type === 'income' ? 'income' : 'expense',
        amount: Math.round(Number(t.amount)),
        categoryId: t.categoryId || null,
        title: t.title || '',
        note: t.note || '',
        date: t.date,
        recurring: !!t.recurring,
        paid: t.paid === undefined ? true : !!t.paid, // dữ liệu cũ: coi như đã chi
        seriesId: t.seriesId || null,
        createdAt: t.createdAt || Date.now(),
      }));
    out.transfers = out.transfers.filter(
      (t) => t && stackIds.has(t.fromStackId) && stackIds.has(t.toStackId) && Number(t.amount) > 0
    );
    return out;
  }

  /* ---------- Chuyển dữ liệu từ phiên bản cũ (1 nguồn tiền) ---------- */
  function looksLikeTx(o) {
    if (!o || typeof o !== 'object') return false;
    const amt = o.amount ?? o.soTien ?? o.money ?? o.value;
    return amt !== undefined && !isNaN(parseFloat(String(amt).replace(/[^\d.-]/g, '')));
  }

  function findTxArray(obj, depth = 0) {
    if (depth > 3 || !obj) return null;
    if (Array.isArray(obj)) return obj.length && obj.every(looksLikeTx) ? obj : null;
    if (typeof obj === 'object') {
      for (const k of ['transactions', 'giaoDich', 'items', 'data', 'records', 'expenses']) {
        const r = findTxArray(obj[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  /** Nhận một object bất kỳ (backup cũ / localStorage cũ), trả về state v2 hoặc null */
  function migrateLegacy(obj, base) {
    const arr = findTxArray(obj);
    if (!arr) return null;
    const s = base || defaultState();
    const stackId = s.stacks[0].id;
    let imported = 0;

    const findOrCreateCat = (name, type) => {
      const n = U.normalizeText(name || 'Khác');
      let cat = s.categories.find((c) => c.type === type && U.normalizeText(c.name) === n);
      if (!cat) {
        cat = { id: U.uid(), type, name: name || 'Khác', icon: '🏷️', color: '#64748b' };
        s.categories.push(cat);
      }
      return cat.id;
    };

    arr.forEach((o) => {
      let amount = parseFloat(String(o.amount ?? o.soTien ?? o.money ?? o.value).replace(/[^\d.-]/g, ''));
      const typeRaw = U.normalizeText(o.type ?? o.loai ?? o.kind ?? '');
      let type = /income|thu|in\b|nhap/.test(typeRaw) ? 'income' : 'expense';
      if (amount < 0) { type = 'expense'; amount = -amount; }
      if (!amount) return;
      let date = String(o.date ?? o.ngay ?? o.createdAt ?? '');
      if (/^\d{13}$/.test(date)) date = new Date(Number(date)).toISOString();
      date = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : U.todayStr();
      const catName = typeof o.category === 'object' ? o.category?.name : (o.category ?? o.categoryName ?? o.danhMuc);
      s.transactions.push({
        id: U.uid(), stackId, type, amount: Math.round(amount),
        categoryId: findOrCreateCat(catName, type),
        title: String(o.title ?? o.name ?? o.description ?? o.ten ?? catName ?? ''),
        note: String(o.note ?? o.ghiChu ?? ''),
        date, recurring: false, paid: true, seriesId: null, createdAt: Date.now(),
      });
      imported++;
    });
    s._migratedCount = imported;
    return s;
  }

  /** Lần đầu chạy bản mới: thử tìm dữ liệu của bản cũ trong localStorage */
  function tryAutoMigrate() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.startsWith('qlct_')) continue;
      try {
        const migrated = migrateLegacy(JSON.parse(localStorage.getItem(key)));
        if (migrated && migrated._migratedCount) return migrated;
      } catch (_) { /* bỏ qua key không phải JSON */ }
    }
    return null;
  }

  /* ---------- Load / Save ---------- */
  let migratedCount = 0;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = normalize(JSON.parse(raw));
        return;
      }
    } catch (e) {
      console.warn('Dữ liệu hỏng, khởi tạo lại', e);
    }
    const migrated = tryAutoMigrate();
    if (migrated) {
      migratedCount = migrated._migratedCount;
      delete migrated._migratedCount;
      state = normalize(migrated);
    } else {
      state = defaultState();
    }
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Không lưu được dữ liệu', e);
    }
  }

  function commit() {
    save();
    listeners.forEach((fn) => fn(state));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ---------- Getters ---------- */
  const get = () => state;
  const getStack = (id) => state.stacks.find((s) => s.id === id) || null;
  const getCategory = (id) => state.categories.find((c) => c.id === id) || null;
  const categoriesOf = (type) => state.categories.filter((c) => c.type === type);

  /* ---------- Stacks ---------- */
  function addStack({ name, color, icon }) {
    const stack = { id: U.uid(), name: name.trim(), color, icon: icon || '🏦' };
    state.stacks.push(stack);
    commit();
    return stack;
  }

  function updateStack(id, patch) {
    const s = getStack(id);
    if (!s) return;
    Object.assign(s, patch);
    commit();
  }

  /** Xóa stack + toàn bộ giao dịch, kế hoạch, chuyển khoản liên quan */
  function deleteStack(id) {
    if (state.stacks.length <= 1) throw new Error('Cần giữ lại ít nhất 1 Stack');
    state.stacks = state.stacks.filter((s) => s.id !== id);
    state.transactions = state.transactions.filter((t) => t.stackId !== id);
    state.transfers = state.transfers.filter((t) => t.fromStackId !== id && t.toStackId !== id);
    delete state.plans[id];
    commit();
  }

  /* ---------- Kế hoạch phân bổ tháng ----------
   * Nếu tháng đang xem chưa đặt kế hoạch riêng -> kế thừa kế hoạch
   * gần nhất của các tháng trước (không phải nhập lại mỗi tháng). */
  function getPlan(stackId, month) {
    const plans = state.plans[stackId] || {};
    if (plans[month]) return { ...plans[month], inherited: false, from: month };
    const earlier = Object.keys(plans).filter((m) => m < month).sort();
    if (earlier.length) {
      const from = earlier[earlier.length - 1];
      return { ...plans[from], inherited: true, from };
    }
    return { income: 0, saving: 0, limit: 0, inherited: false, from: null, empty: true };
  }

  function setPlan(stackId, month, { income, saving, limit }) {
    if (!state.plans[stackId]) state.plans[stackId] = {};
    state.plans[stackId][month] = {
      income: Math.max(0, Math.round(income)),
      saving: Math.max(0, Math.round(saving)),
      limit: Math.max(0, Math.round(limit)),
    };
    commit();
  }

  /* ---------- Giao dịch thu / chi ---------- */
  function addTransaction(tx) {
    const t = {
      id: U.uid(),
      stackId: tx.stackId,
      type: tx.type,
      amount: Math.round(tx.amount),
      categoryId: tx.categoryId,
      title: (tx.title || '').trim(),
      note: (tx.note || '').trim(),
      date: tx.date,
      recurring: !!tx.recurring,
      paid: tx.paid === undefined ? true : !!tx.paid,
      seriesId: tx.seriesId || null,
      createdAt: Date.now(),
    };
    if (t.recurring && !t.seriesId) t.seriesId = t.id;
    state.transactions.push(t);
    commit();
    return t;
  }

  function updateTransaction(id, patch) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if (t.recurring && !t.seriesId) t.seriesId = t.id;
    commit();
  }

  function deleteTransaction(id) {
    state.transactions = state.transactions.filter((t) => t.id !== id);
    commit();
  }

  /** Mọi khoản CHI (cố định hay không) đều có ô tick "đã chi trả" */
  const isPayable = (t) => t.type === 'expense';

  /** Giao dịch có được tính vào Tổng chi / biểu đồ / số dư không?
   *  Khoản chi chỉ được tính khi đã tick "đã chi trả". */
  const isCounted = (t) => !isPayable(t) || t.paid !== false;

  function setPaid(id, paid) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t || !isPayable(t)) return;
    t.paid = !!paid;
    commit();
  }

  /* ---------- Danh mục ---------- */
  function addCategory({ type, name, icon, color }) {
    const c = { id: U.uid(), type, name: name.trim(), icon, color };
    state.categories.push(c);
    commit();
    return c;
  }

  function updateCategory(id, patch) {
    const c = getCategory(id);
    if (!c) return;
    Object.assign(c, patch);
    commit();
  }

  function countCategoryUsage(id) {
    return state.transactions.filter((t) => t.categoryId === id).length;
  }

  /** Xóa danh mục; giao dịch đang dùng sẽ chuyển sang "Khác" cùng loại */
  function deleteCategory(id) {
    const cat = getCategory(id);
    if (!cat) return;
    if (categoriesOf(cat.type).length <= 1) throw new Error('Cần giữ lại ít nhất 1 danh mục cho mỗi loại');
    let fallback = state.categories.find(
      (c) => c.id !== id && c.type === cat.type && U.normalizeText(c.name) === 'khac'
    );
    if (!fallback) fallback = state.categories.find((c) => c.id !== id && c.type === cat.type);
    state.transactions.forEach((t) => {
      if (t.categoryId === id) t.categoryId = fallback.id;
    });
    state.categories = state.categories.filter((c) => c.id !== id);
    commit();
  }

  /* ---------- Chuyển tiền nội bộ (bản ghi thô — logic nợ nằm ở ledger.js) ---------- */
  function addTransfer(tr) {
    const t = { id: U.uid(), createdAt: Date.now(), note: '', ...tr, amount: Math.round(tr.amount) };
    state.transfers.push(t);
    commit();
    return t;
  }

  function removeTransfer(id) {
    state.transfers = state.transfers.filter((t) => t.id !== id);
    commit();
  }

  /* ---------- Khoản cố định hàng tháng ---------- */
  const inScope = (t, stackId) => !stackId || t.stackId === stackId;

  /** Các khoản "lặp lại" của tháng trước chưa được tạo trong tháng này */
  function pendingRecurring(month, stackId) {
    const prev = U.shiftMonth(month, -1);
    const thisMonth = state.transactions.filter((t) => U.monthOf(t.date) === month);
    const existing = new Set(thisMonth.map((t) => t.seriesId).filter(Boolean));
    return state.transactions.filter(
      (t) => t.recurring && U.monthOf(t.date) === prev && inScope(t, stackId) &&
        !existing.has(t.seriesId || t.id)
    );
  }

  function copyRecurring(month, stackId) {
    const list = pendingRecurring(month, stackId);
    list.forEach((src) => {
      state.transactions.push({
        ...src,
        id: U.uid(),
        date: U.sameDayInMonth(src.date, month),
        seriesId: src.seriesId || src.id,
        paid: false, // tháng mới: chưa chi trả
        createdAt: Date.now(),
      });
    });
    if (list.length) commit();
    return list.length;
  }

  const recurringKey = (month, stackId) => `${month}|${stackId || 'all'}`;
  const isRecurringDismissed = (month, stackId) => !!state.dismissedRecurring[recurringKey(month, stackId)];
  function dismissRecurring(month, stackId) {
    state.dismissedRecurring[recurringKey(month, stackId)] = true;
    commit();
  }

  /* ---------- Sao lưu / Khôi phục ---------- */
  function exportData() {
    return { app: 'quan-ly-chi-tieu', version: 2, exportedAt: new Date().toISOString(), data: state };
  }

  /** Trả về số giao dịch đã nạp. Ném lỗi nếu file không hợp lệ. */
  function importData(obj) {
    const payload = obj && obj.data && obj.data.stacks ? obj.data : obj;
    if (payload && Array.isArray(payload.stacks)) {
      state = normalize(payload);
      commit();
      return state.transactions.length;
    }
    const migrated = migrateLegacy(payload);
    if (migrated) {
      const n = migrated._migratedCount;
      delete migrated._migratedCount;
      state = normalize(migrated);
      commit();
      return n;
    }
    throw new Error('File không đúng định dạng sao lưu');
  }

  return {
    load, subscribe, get, getStack, getCategory, categoriesOf,
    addStack, updateStack, deleteStack,
    getPlan, setPlan,
    addTransaction, updateTransaction, deleteTransaction, setPaid, isPayable, isCounted,
    addCategory, updateCategory, deleteCategory, countCategoryUsage,
    addTransfer, removeTransfer,
    pendingRecurring, copyRecurring, isRecurringDismissed, dismissRecurring,
    exportData, importData,
    get migratedCount() { return migratedCount; },
  };
})();
