/* =========================================================
 * cloud.js — ĐĂNG NHẬP & ĐỒNG BỘ (Supabase)
 * Mỗi tài khoản có 1 dòng trong bảng user_data chứa toàn bộ state.
 * Cột rev tăng mỗi lần ghi: chỉ ghi được khi rev trên cloud vẫn là
 * bản mình đã thấy -> phát hiện được 2 máy cùng sửa lúc offline.
 *
 * Không có giao diện ở đây; app.js truyền các hook vào init().
 * ========================================================= */
const Cloud = (() => {
  const META_KEY = 'qlct_sync';
  const BACKUP_KEY = 'qlct_backup_sync';
  const TABLE = 'user_data';
  const cfg = window.APP_CONFIG || {};
  let enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  let sb = null;
  let user = null;
  let channel = null;
  let status = enabled ? 'signed-out' : 'off';
  let changeSeq = 0;      // tăng mỗi lần sửa trên máy này
  let pushTimer = null;
  let chain = Promise.resolve();
  const hooks = { onStatus() {}, onUser() {}, resolveConflict: async () => 'remote' };

  /* ---------- Meta: máy này đang gắn với tài khoản nào, đã thấy rev nào ---------- */
  // { userId, rev (null = chưa biết dòng trên cloud), dirty (có thay đổi chưa đẩy lên) }
  let meta = {};
  try { meta = JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch (_) { meta = {}; }
  function saveMeta(patch) {
    meta = patch === null ? {} : { ...meta, ...patch };
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) {}
  }

  function setStatus(s) {
    status = s;
    hooks.onStatus(s);
  }

  /** Chạy lần lượt từng thao tác đồng bộ, không cho chồng lên nhau */
  function serial(fn) {
    chain = chain.then(fn).catch((err) => {
      console.error('Đồng bộ lỗi', err);
      setStatus(navigator.onLine === false || /fetch|network/i.test(err?.message) ? 'offline' : 'error');
    });
    return chain;
  }

  const must = ({ data, error }) => { if (error) throw error; return data; };

  async function fetchRow() {
    return must(await sb.from(TABLE).select('data, rev').eq('user_id', user.id).maybeSingle());
  }

  function applyRemote(remote, { keepBackup = false } = {}) {
    if (keepBackup) {
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Store.exportData())); } catch (_) {}
    }
    saveMeta({ rev: remote.rev, dirty: false });
    Store.replace(remote.data, 'remote');
    setStatus('synced');
  }

  /** So bản trên cloud với máy này rồi quyết định kéo về / đẩy lên / hỏi người dùng */
  async function reconcile(remote) {
    if (!remote) {                                  // cloud chưa có -> đẩy dữ liệu máy này lên
      saveMeta({ rev: null, dirty: true });
      return push();
    }
    if (remote.rev === meta.rev) return meta.dirty ? push() : setStatus('synced');
    if (!meta.dirty) return applyRemote(remote);
    // Cả cloud lẫn máy này đều có thay đổi mới
    const choice = await hooks.resolveConflict();
    if (choice === 'remote') return applyRemote(remote, { keepBackup: true });
    saveMeta({ rev: remote.rev });                  // giữ máy này: ghi đè lên bản cloud vừa thấy
    return push();
  }

  async function pull() {
    if (!user) return;
    setStatus('syncing');
    return reconcile(await fetchRow());
  }

  async function push() {
    if (!user) return;
    if (!meta.dirty && meta.rev != null) return setStatus('synced');
    setStatus('syncing');
    const seq = changeSeq;
    const data = Store.get();
    let res;
    if (meta.rev == null) {
      res = await sb.from(TABLE).insert({ user_id: user.id, data, rev: 1 }).select('rev').maybeSingle();
      if (res.error?.code === '23505') return reconcile(await fetchRow());   // máy khác vừa tạo trước
    } else {
      res = await sb.from(TABLE)
        .update({ data, rev: meta.rev + 1, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('rev', meta.rev)
        .select('rev').maybeSingle();
    }
    const row = must(res);
    if (!row) return reconcile(await fetchRow());   // rev đã đổi -> máy khác vừa ghi
    saveMeta({ rev: row.rev, dirty: seq !== changeSeq });
    if (meta.dirty) schedulePush();
    else setStatus('synced');
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => serial(push), 800);
  }

  /* ---------- Realtime: máy khác ghi -> kéo về ngay ---------- */
  function subscribeRealtime() {
    unsubscribeRealtime();
    channel = sb.channel('user_data:' + user.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` },
        (p) => { if (p.new?.rev !== meta.rev) serial(pull); })
      .subscribe();
  }
  function unsubscribeRealtime() {
    if (channel) sb.removeChannel(channel);
    channel = null;
  }

  function handleSession(session) {
    const next = session?.user || null;
    if (next?.id === user?.id) return;              // chỉ là làm mới token
    user = next;
    hooks.onUser(user);
    if (!user) { unsubscribeRealtime(); setStatus('signed-out'); return; }
    // Lần đầu gắn máy này với tài khoản: dữ liệu đang có trên máy coi như "chưa đồng bộ"
    if (meta.userId !== user.id) saveMeta({ userId: user.id, rev: null, dirty: Store.hasUserData() });
    subscribeRealtime();
    serial(pull);
  }

  /* ---------- Khởi động ---------- */
  function init(h) {
    Object.assign(hooks, h);
    if (!enabled) return setStatus('off');
    try {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (err) {
      console.error('Cấu hình Supabase sai (kiểm tra js/config.js)', err);
      enabled = false;
      return setStatus('off');
    }

    Store.subscribe((_, origin) => {
      if (origin !== 'local' || !meta.userId) return;
      changeSeq++;
      saveMeta({ dirty: true });
      if (user) schedulePush();
    });

    // Không gọi Supabase ngay trong callback (tránh khóa phiên) -> đẩy sang tick sau
    sb.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
    window.addEventListener('online', () => { if (user) serial(pull); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && user) serial(pull);
    });
  }

  /* ---------- Tài khoản ---------- */
  const AUTH_ERRORS = [
    [/invalid login credentials/i, 'Sai email hoặc mật khẩu'],
    [/email not confirmed/i, 'Email chưa được xác nhận — mở hộp thư và bấm link xác nhận trước'],
    [/already registered|already been registered/i, 'Email này đã có tài khoản, hãy đăng nhập'],
    [/at least 6|password should be/i, 'Mật khẩu tối thiểu 6 ký tự'],
    [/invalid.*email|email.*invalid/i, 'Email không hợp lệ'],
    [/rate limit|too many/i, 'Thử quá nhiều lần, đợi một lát rồi thử lại'],
    [/provider is not enabled/i, 'Đăng nhập Google chưa được bật trong Supabase'],
  ];
  function authError(err) {
    const msg = err?.message || String(err);
    const hit = AUTH_ERRORS.find(([re]) => re.test(msg));
    return new Error(hit ? hit[1] : msg);
  }

  const redirectUrl = () => location.origin + location.pathname;

  async function signInEmail(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
  }

  /** Trả về true nếu cần mở email để xác nhận trước khi đăng nhập */
  async function signUpEmail(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
    if (error) throw authError(error);
    // Supabase không báo lỗi khi email đã tồn tại, chỉ trả user không có identity
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
      throw authError(new Error('already registered'));
    }
    return !data.session;
  }

  async function signInGoogle() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
    if (error) throw authError(error);
  }

  /** Đẩy nốt thay đổi đang chờ. Trả về true nếu cloud đã có bản mới nhất. */
  async function flush() {
    if (!user) return !meta.dirty;
    clearTimeout(pushTimer);
    await serial(push);
    return !meta.dirty;
  }

  /** Đăng xuất và xóa dữ liệu trên máy này (dữ liệu vẫn còn trong tài khoản) */
  async function signOut() {
    clearTimeout(pushTimer);
    unsubscribeRealtime();
    await sb.auth.signOut().catch(() => {});
    user = null;
    saveMeta(null);
    Store.reset();
    hooks.onUser(null);
    setStatus('signed-out');
  }

  return {
    init, signInEmail, signUpEmail, signInGoogle, signOut, flush,
    syncNow: () => serial(pull),
    get enabled() { return enabled; },
    get user() { return user; },
    get status() { return status; },
    get dirty() { return !!meta.dirty; },
  };
})();
