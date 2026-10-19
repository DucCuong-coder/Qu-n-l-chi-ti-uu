/* =========================================================
 * utils.js — Hàm tiện ích dùng chung (không phụ thuộc state)
 * ========================================================= */
const U = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  /** Tạo id ngắn, đủ duy nhất cho dữ liệu local */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 500000 -> "500.000đ" */
  function fmt(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('vi-VN') + 'đ';
  }

  /** 500000 -> "500.000" (dùng trong ô nhập) */
  function fmtPlain(n) {
    const v = Math.round(Number(n) || 0);
    return v ? v.toLocaleString('vi-VN') : '';
  }

  /* ---------- Đọc số tiền viết tắt ----------
   * Hỗ trợ:  500000 | 500.000 | 50k | 1tr | 1,5tr | 1.5tr | 1tr5 (=1.500.000)
   *          2tr300k | 2tr3 | 1ty2 | 1m | 1 triệu | 5 nghìn | 50k+30k (cộng dồn)
   * Trả về NaN nếu không đọc được, 0 nếu ô trống. */
  const MONEY_UNITS = {
    k: 1e3, nghin: 1e3, ngan: 1e3, ng: 1e3,
    tr: 1e6, trieu: 1e6, m: 1e6, cu: 1e6,
    ty: 1e9, ti: 1e9, b: 1e9,
  };
  const MONEY_TOKEN = /(\d+(?:[.,]\d+)*)(trieu|tr|ty|ti|nghin|ngan|ng|k|m|cu|b)?/y;

  function parseMoneyPart(part) {
    if (!part) return NaN;
    let pos = 0, total = 0, lastUnit = 0;
    while (pos < part.length) {
      MONEY_TOKEN.lastIndex = pos;
      const m = MONEY_TOKEN.exec(part);
      if (!m) return NaN;
      pos = MONEY_TOKEN.lastIndex;
      const [, num, unit] = m;
      if (unit) {
        // Có đơn vị: "1,5tr" / "1.5tr" là số thập phân; "1.000k" là phân cách hàng nghìn
        const seps = (num.match(/[.,]/g) || []).length;
        const val = seps === 1 && !/[.,]\d{3}$/.test(num)
          ? parseFloat(num.replace(',', '.'))
          : parseFloat(num.replace(/[.,]/g, ''));
        lastUnit = MONEY_UNITS[unit];
        total += val * lastUnit;
      } else if (lastUnit) {
        // Số đứng sau đơn vị là phần lẻ của đơn vị đó: 1tr5 = 1,5tr ; 2k5 = 2.500
        if (/[.,]/.test(num)) return NaN;
        total += parseFloat('0.' + num) * lastUnit;
        lastUnit = 0;
      } else {
        // Số thuần: dấu . và , là phân cách hàng nghìn
        total += parseFloat(num.replace(/[.,]/g, ''));
      }
    }
    return total;
  }

  function parseMoney(input) {
    if (typeof input === 'number') return isFinite(input) ? Math.round(input) : NaN;
    const s = normalizeText(input)
      .replace(/\s+/g, '')
      .replace(/(vnd|dong|d)$/, '');      // bỏ hậu tố "đ", "vnd", "đồng"
    if (!s) return 0;
    let total = 0;
    for (const part of s.split('+')) {
      const v = parseMoneyPart(part);
      if (isNaN(v)) return NaN;
      total += v;
    }
    return Math.round(total);
  }

  /** Như parseMoney nhưng trả 0 khi không đọc được (dùng để tính toán) */
  function parseAmount(str) {
    const v = parseMoney(str);
    return isNaN(v) ? 0 : v;
  }

  /** Ngày hôm nay theo giờ máy (không dùng UTC) -> "YYYY-MM-DD" */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function currentMonth() {
    return todayStr().slice(0, 7);
  }

  /** "2026-10-19" -> "2026-10" */
  function monthOf(dateStr) {
    return String(dateStr || '').slice(0, 7);
  }

  /** shiftMonth("2026-01", -1) -> "2025-12" */
  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  /** "2026-10" -> "Tháng 10/2026" */
  function monthLabel(month) {
    const [y, m] = month.split('-');
    return `Tháng ${Number(m)}/${y}`;
  }

  /** "2026-10" -> "T10/26" (nhãn ngắn cho biểu đồ) */
  function monthShort(month) {
    const [y, m] = month.split('-');
    return `T${Number(m)}/${y.slice(2)}`;
  }

  /** "2026-10-19" -> "19/10/2026" */
  function dateLabel(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  /** Giữ nguyên ngày trong tháng mới, nếu vượt số ngày thì lấy ngày cuối tháng */
  function sameDayInMonth(dateStr, targetMonth) {
    const day = Number(String(dateStr).slice(8, 10)) || 1;
    return `${targetMonth}-${pad(Math.min(day, daysInMonth(targetMonth)))}`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu */
  function normalizeText(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().trim();
  }

  function debounce(fn, ms = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Tải script ngoài khi cần (VD: thư viện xuất Excel) */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được ' + src));
      document.head.appendChild(s);
    });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  return {
    uid, fmt, fmtPlain, parseMoney, parseAmount, todayStr, currentMonth, monthOf, shiftMonth,
    daysInMonth, monthLabel, monthShort, dateLabel, sameDayInMonth, escapeHtml,
    normalizeText, debounce, download, loadScript, cssVar
  };
})();
