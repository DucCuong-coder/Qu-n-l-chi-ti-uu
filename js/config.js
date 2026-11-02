/* =========================================================
 * config.js — Kết nối Supabase (đăng nhập & đồng bộ)
 * Lấy 2 giá trị trong Supabase: Project Settings -> API
 *   - Project URL
 *   - anon / publishable key (khóa công khai, được phép để ở web;
 *     dữ liệu được bảo vệ bằng Row Level Security trong supabase/schema.sql)
 * KHÔNG dán service_role / secret key vào đây.
 * Để trống thì app chạy như cũ, chỉ lưu trên máy.
 * ========================================================= */
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};
