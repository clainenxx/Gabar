-- ============================================================================
-- Modul 1: Auth Admin
-- Ref: PRD.md §4.3, ARCHITECTURE.md §0.2, §3, §5
--
-- GAGI cuma punya 1 role (`admin`), beda dari AyamKu yang punya admin+kasir
-- (ARCHITECTURE.md §0.2). Kolom `role` tetap disimpan (bukan dihapus) untuk
-- antisipasi masa depan, tapi untuk MVP nilainya selalu 'admin' dan tidak ada
-- logic pembeda hak akses di aplikasi.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: ambil role user yang sedang login. SECURITY DEFINER supaya query
-- ini tidak kena RLS dirinya sendiri (mencegah infinite recursion saat
-- dipakai di dalam policy tabel profiles maupun tabel lain di Modul 2).
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Admin yang login boleh lihat profilnya sendiri (dipakai frontend untuk
-- tahu nama/role sendiri setelah login).
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- Semua admin boleh lihat daftar admin lain (dipakai tab "Akun Admin",
-- Modul 1b) — semua akun admin hak aksesnya identik (ARCHITECTURE.md §0.2).
create policy "profiles_select_admin"
  on public.profiles for select
  using (public.current_user_role() = 'admin');

-- Sengaja TIDAK ada policy INSERT/UPDATE/DELETE untuk role anon/authenticated
-- sama sekali. Penambahan & penghapusan akun admin HANYA lewat Edge Function
-- `manage-admin` (service role, Modul 1b) — supaya pembuatan akun admin baru
-- selalu tervalidasi ada admin yang login dulu, bukan self sign-up publik
-- (§5.8: "Allow new users to sign up" WAJIB dimatikan di Supabase Auth).

-- ============================================================================
-- BOOTSTRAP: cara buat admin PERTAMA (chicken-and-egg problem)
-- Edge Function `manage-admin` (Modul 1b) mensyaratkan ada admin yang login
-- untuk bisa menambah admin lain. Untuk admin pertama, harus dibuat manual:
--
-- 1. Pastikan dulu "Allow new users to sign up" sudah DIMATIKAN di Supabase
--    Dashboard -> Authentication -> Providers -> Email (ARCHITECTURE.md §5.8).
-- 2. Buka Supabase Dashboard -> Authentication -> Add user -> isi email &
--    password, centang "Auto Confirm User".
-- 3. Copy UUID user yang baru dibuat dari tabel auth.users.
-- 4. Jalankan SQL berikut di SQL Editor (ganti value sesuai):
--
--    insert into public.profiles (id, full_name, email, role)
--    values ('<uuid-dari-langkah-3>', 'Nama Admin', 'admin@gagi.com', 'admin');
--
-- Setelah itu, admin ini bisa login di /admin/login dan (mulai Modul 1b)
-- menambah admin lain lewat tab "Akun Admin" secara normal.
-- ============================================================================
