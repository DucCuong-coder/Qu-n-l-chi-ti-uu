/* =========================================================
 * ledger.js — LOGIC STACK & CÔNG NỢ NỘI BỘ
 *
 * Quy ước:
 *  - "advance" (ứng trước): fromStackId CHO toStackId ứng tiền
 *        -> toStackId nợ fromStackId.
 *  - "repay"   (hoàn trả):  fromStackId (bên nợ) TRẢ cho toStackId (chủ nợ)
 *        -> giảm nợ của fromStackId với toStackId.
 *
 *  - Chuyển tiền nội bộ làm thay đổi Hạn mức khả dụng / Số dư của từng
 *    Stack, nhưng KHÔNG được tính vào Tổng thu / Tổng chi thực tế.
 *    Ở góc nhìn "Tổng quan", tiền ra của Stack này = tiền vào Stack kia
 *    nên tự triệt tiêu.
 *
 *  - Nợ nội bộ tính trên TOÀN BỘ lịch sử (không reset theo tháng):
 *    nợ tháng này chưa trả thì sang tháng sau vẫn còn.
 * ========================================================= */
const Ledger = (() => {
  /* ---------- Ma trận nợ ---------- */

  /** raw[debtor][creditor] = tổng ứng (creditor -> debtor) − tổng trả (debtor -> creditor) */
  function rawMatrix(transfers) {
    const raw = {};
    const add = (debtor, creditor, v) => {
      raw[debtor] = raw[debtor] || {};
      raw[debtor][creditor] = (raw[debtor][creditor] || 0) + v;
    };
    transfers.forEach((t) => {
      if (t.kind === 'advance') add(t.toStackId, t.fromStackId, t.amount);
      else if (t.kind === 'repay') add(t.fromStackId, t.toStackId, -t.amount);
    });
    return raw;
  }

  /** Danh sách nợ ròng giữa từng cặp Stack: [{ debtor, creditor, amount }] */
  function allDebts(transfers = Store.get().transfers) {
    const raw = rawMatrix(transfers);
    const ids = Store.get().stacks.map((s) => s.id);
    const debts = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const net = (raw[a]?.[b] || 0) - (raw[b]?.[a] || 0); // >0: a nợ b
        if (net > 0) debts.push({ debtor: a, creditor: b, amount: net });
        else if (net < 0) debts.push({ debtor: b, creditor: a, amount: -net });
      }
    }
    return debts;
  }

  /** Số tiền debtor đang nợ creditor (0 nếu không nợ) */
  function pairDebt(debtorId, creditorId) {
    const d = allDebts().find((x) => x.debtor === debtorId && x.creditor === creditorId);
    return d ? d.amount : 0;
  }

  /** { owes: [{stackId, amount}], lends: [{stackId, amount}] } cho 1 Stack */
  function debtsOf(stackId) {
    const debts = allDebts();
    return {
      owes: debts.filter((d) => d.debtor === stackId).map((d) => ({ stackId: d.creditor, amount: d.amount })),
      lends: debts.filter((d) => d.creditor === stackId).map((d) => ({ stackId: d.debtor, amount: d.amount })),
    };
  }

  /* ---------- Thao tác ---------- */

  /** Ứng trước: fromId cho toId ứng `amount` */
  function advance({ fromId, toId, amount, date, note }) {
    if (!fromId || !toId || fromId === toId) throw new Error('Chọn 2 Stack khác nhau');
    if (!(amount > 0)) throw new Error('Số tiền phải lớn hơn 0');
    return Store.addTransfer({ kind: 'advance', fromStackId: fromId, toStackId: toId, amount, date, note });
  }

  /** Hoàn trả: debtorId trả `amount` cho creditorId (không được trả quá số nợ) */
  function repay({ debtorId, creditorId, amount, date, note }) {
    const owed = pairDebt(debtorId, creditorId);
    if (owed <= 0) throw new Error('Không có khoản nợ nào giữa 2 Stack này');
    if (!(amount > 0)) throw new Error('Số tiền phải lớn hơn 0');
    if (amount > owed) throw new Error(`Chỉ còn nợ ${U.fmt(owed)}`);
    return Store.addTransfer({ kind: 'repay', fromStackId: debtorId, toStackId: creditorId, amount, date, note });
  }

  /** Xóa 1 bản ghi chuyển nội bộ — chặn nếu làm sổ nợ bị âm (đã trả nhiều hơn đã ứng) */
  function removeTransfer(id) {
    const rest = Store.get().transfers.filter((t) => t.id !== id);
    const raw = rawMatrix(rest);
    const broken = Object.values(raw).some((row) => Object.values(row).some((v) => v < -0.5));
    if (broken) throw new Error('Khoản ứng này đã được hoàn trả. Hãy xóa khoản hoàn trả tương ứng trước.');
    Store.removeTransfer(id);
  }

  /* ---------- Tổng hợp số liệu theo tháng ---------- */

  /** Số liệu của 1 Stack trong 1 tháng */
  function stackMonth(stackId, month) {
    const s = Store.get();
    let income = 0, expense = 0, unpaid = 0;
    s.transactions.forEach((t) => {
      if (t.stackId !== stackId || U.monthOf(t.date) !== month) return;
      if (!Store.isCounted(t)) { unpaid += t.amount; return; } // chi cố định chưa trả
      if (t.type === 'income') income += t.amount; else expense += t.amount;
    });

    const flow = { advIn: 0, advOut: 0, repIn: 0, repOut: 0 };
    s.transfers.forEach((t) => {
      if (U.monthOf(t.date) !== month) return;
      if (t.kind === 'advance') {
        if (t.toStackId === stackId) flow.advIn += t.amount;
        if (t.fromStackId === stackId) flow.advOut += t.amount;
      } else {
        if (t.toStackId === stackId) flow.repIn += t.amount;
        if (t.fromStackId === stackId) flow.repOut += t.amount;
      }
    });
    const netTransfer = flow.advIn + flow.repIn - flow.advOut - flow.repOut;

    const plan = Store.getPlan(stackId, month);
    const spendLimit = plan.limit + netTransfer;       // Hạn mức khả dụng (đã cộng/trừ ứng trước)
    const remaining = spendLimit - expense;            // Còn được chi
    const balance = income - expense + netTransfer;    // Số dư khả dụng thực tế trong tháng

    return {
      income, expense, unpaid, balance, plan, flow, netTransfer, spendLimit, remaining,
      usedPct: spendLimit > 0 ? Math.min(100, (expense / spendLimit) * 100) : (expense > 0 ? 100 : 0),
    };
  }

  /** Số liệu tổng của mọi Stack — chuyển nội bộ triệt tiêu nhau */
  function overviewMonth(month) {
    const perStack = Store.get().stacks.map((st) => ({ stack: st, ...stackMonth(st.id, month) }));
    const sum = (k) => perStack.reduce((a, x) => a + x[k], 0);
    const limit = perStack.reduce((a, x) => a + x.plan.limit, 0);
    const saving = perStack.reduce((a, x) => a + x.plan.saving, 0);
    const plannedIncome = perStack.reduce((a, x) => a + x.plan.income, 0);
    const income = sum('income'), expense = sum('expense');
    return {
      perStack, income, expense, unpaid: sum('unpaid'), limit, saving, plannedIncome,
      balance: income - expense,
      spendLimit: limit,
      remaining: limit - expense,
      usedPct: limit > 0 ? Math.min(100, (expense / limit) * 100) : (expense > 0 ? 100 : 0),
      hasPlan: perStack.some((x) => !x.plan.empty),
    };
  }

  return { allDebts, pairDebt, debtsOf, advance, repay, removeTransfer, stackMonth, overviewMonth };
})();
