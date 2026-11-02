-- =========================================================
-- Bảng lưu dữ liệu đồng bộ — chạy 1 lần trong Supabase:
-- Dashboard -> SQL Editor -> New query -> dán toàn bộ file -> Run
-- =========================================================

-- Mỗi tài khoản 1 dòng, chứa toàn bộ dữ liệu app (stacks, giao dịch, kế hoạch...)
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  rev        bigint not null default 1,          -- tăng mỗi lần ghi, dùng để phát hiện 2 máy cùng sửa
  updated_at timestamptz not null default now()
);

-- Row Level Security: mỗi người chỉ đọc / ghi được dòng của chính mình
alter table public.user_data enable row level security;

drop policy if exists "Đọc dữ liệu của mình" on public.user_data;
create policy "Đọc dữ liệu của mình" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Tạo dữ liệu của mình" on public.user_data;
create policy "Tạo dữ liệu của mình" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Sửa dữ liệu của mình" on public.user_data;
create policy "Sửa dữ liệu của mình" on public.user_data
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Realtime: máy khác sửa là máy này nhận được ngay
do $$
begin
  alter publication supabase_realtime add table public.user_data;
exception when duplicate_object then null;
end $$;
