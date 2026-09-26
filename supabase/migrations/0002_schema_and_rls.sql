-- ============================================================================
-- Modul 2: Skema Database & RLS
-- Ref: ARCHITECTURE.md §3 (skema) & §5 (security checklist)
--
-- Beda dari AyamKu (lihat ARCHITECTURE.md §0 untuk detail tiap poin):
-- - Tidak ada tabel `vouchers` (§0.4).
-- - `products`/`order_items` tanpa kolom varian/flavors (§0.9).
-- - `orders` tanpa `tipe`/`kasir_id`/`sudah_diambil`, tapi ADA `lokasi_1`
--   (wajib) & `lokasi_2` (opsional) (§0.3, §0.8).
-- - Admin TIDAK punya policy UPDATE langsung ke `orders`/`order_items` sama
--   sekali (beda dari kasir di AyamKu yang boleh) — mutasi status HANYA
--   lewat RPC SECURITY DEFINER (verify_order_pickup, Modul 10) atau Edge
--   Function service-role (public-checkout, midtrans-webhook). Ini keputusan
--   keamanan yang sengaja ditetapkan dari awal (AGENTS.md §4), bukan
--   disederhanakan dulu lalu ditambal belakangan seperti temuan Modul 18 di
--   AyamKu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: trigger generik buat auto-update kolom updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- TABEL: categories
-- ============================================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  urutan int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_categories_urutan on public.categories (urutan);

alter table public.categories enable row level security;

-- Kategori bukan data sensitif — dibaca publik (filter menu di homepage)
-- maupun admin, jadi select terbuka untuk semua orang.
create policy "categories_select_all"
  on public.categories for select
  using (true);

create policy "categories_insert_admin"
  on public.categories for insert
  with check (public.current_user_role() = 'admin');

create policy "categories_update_admin"
  on public.categories for update
  using (public.current_user_role() = 'admin');

create policy "categories_delete_admin"
  on public.categories for delete
  using (public.current_user_role() = 'admin');

-- ============================================================================
-- TABEL: products
-- Tidak ada kolom varian/flavors (§0.9, dikonfirmasi owner) — rasa/topping
-- beda didaftarkan sebagai produk terpisah, dibedakan lewat category_id/nama.
-- ============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  deskripsi text,
  harga numeric(12,2) not null check (harga >= 0),
  category_id uuid not null references public.categories (id) on delete restrict,
  gambar_url text,
  aktif boolean not null default true,
  stock int not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create index if not exists idx_products_aktif on public.products (aktif);
create index if not exists idx_products_category_id on public.products (category_id);

alter table public.products enable row level security;

-- Publik (anon + authenticated) hanya boleh lihat produk yang aktif.
-- Catatan: stok 0 TETAP tampil (PRD §4.1 "Stok Habis"), jadi filter di sini
-- cuma `aktif`, bukan `stock > 0` — logic tombol disabled ada di frontend
-- (Modul 5/6), bukan di RLS.
create policy "products_select_active"
  on public.products for select
  using (aktif = true);

-- Admin boleh lihat semua produk (termasuk nonaktif) untuk tab "Produk".
create policy "products_select_admin"
  on public.products for select
  using (public.current_user_role() = 'admin');

create policy "products_insert_admin"
  on public.products for insert
  with check (public.current_user_role() = 'admin');

create policy "products_update_admin"
  on public.products for update
  using (public.current_user_role() = 'admin');

create policy "products_delete_admin"
  on public.products for delete
  using (public.current_user_role() = 'admin');

-- ============================================================================
-- TABEL: banners
-- ============================================================================
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  gambar_url text not null,
  judul text,
  link text,
  urutan int not null default 0,
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_banners_aktif_urutan on public.banners (aktif, urutan);

alter table public.banners enable row level security;

create policy "banners_select_active"
  on public.banners for select
  using (aktif = true);

create policy "banners_select_admin"
  on public.banners for select
  using (public.current_user_role() = 'admin');

create policy "banners_insert_admin"
  on public.banners for insert
  with check (public.current_user_role() = 'admin');

create policy "banners_update_admin"
  on public.banners for update
  using (public.current_user_role() = 'admin');

create policy "banners_delete_admin"
  on public.banners for delete
  using (public.current_user_role() = 'admin');

-- ============================================================================
-- TABEL: settings (key-value sederhana, mis. notification_email)
-- ============================================================================
create table if not exists public.settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

-- Hanya admin yang boleh baca/tulis settings dari client. Edge Function
-- (service role) selalu bisa baca ini untuk kirim notifikasi email, karena
-- service role bypass RLS.
create policy "settings_all_admin"
  on public.settings for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============================================================================
-- TABEL: orders
-- Beda dari AyamKu (§0.8): tidak ada `tipe`/`kasir_id`/`sudah_diambil`.
-- Ada `lokasi_1` (wajib) & `lokasi_2` (opsional) untuk model "antar ke
-- lokasi" (§0.3). `total` = `subtotal` karena tidak ada voucher (§0.4).
-- ============================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- dipakai di URL /order/:order_token — UUID random, bukan ID sekuensial
  -- (ARCHITECTURE.md §5.5), supaya tidak bisa ditebak/di-enumerasi.
  order_token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'paid', 'completed', 'cancelled')),
  nama_customer text not null,
  no_telp text not null,
  email text not null,
  -- Lokasi 1 wajib (tujuan utama antar), Lokasi 2 opsional (cadangan kalau
  -- pelanggan berencana pindah tempat) — PRD.md §4.1, ARCHITECTURE.md §0.3.
  lokasi_1 text not null,
  lokasi_2 text,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_token)
);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_order_token on public.orders (order_token);

alter table public.orders enable row level security;

-- Sengaja TIDAK ada policy INSERT untuk anon maupun admin (§5.1): order
-- online HANYA dibuat lewat Edge Function `public-checkout` (service role,
-- Modul 7), bukan insert langsung dari browser mana pun.

-- Admin boleh lihat semua order (dibutuhkan untuk tab "Pesanan" & "Dashboard",
-- termasuk lokasi_1/lokasi_2 tiap pesanan).
create policy "orders_select_admin"
  on public.orders for select
  using (public.current_user_role() = 'admin');

-- Sengaja TIDAK ada policy UPDATE/DELETE untuk client mana pun (termasuk
-- admin) — beda dari AyamKu (§0.8, AGENTS.md §4). Perubahan status
-- (`paid`→`completed` via scan QR, atau →`cancelled` via webhook Midtrans
-- deny/expire) HANYA lewat RPC SECURITY DEFINER `verify_order_pickup`
-- (Modul 10) atau Edge Function service-role `midtrans-webhook` (Modul 8),
-- supaya kolom status/total tidak bisa diubah bebas dari console browser.

-- ============================================================================
-- TABEL: order_items
-- Tidak ada kolom varian (§0.9).
-- ============================================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  -- snapshot nama produk saat transaksi, supaya riwayat tidak berubah kalau
  -- produk diedit/dihapus nanti.
  nama_produk text not null,
  qty int not null check (qty > 0),
  harga_satuan numeric(12,2) not null check (harga_satuan >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0)
);

create index if not exists idx_order_items_order_id on public.order_items (order_id);

alter table public.order_items enable row level security;

-- Sama seperti `orders`: insert HANYA lewat Edge Function `public-checkout`
-- (service role). Admin hanya boleh SELECT (lihat isi tiap pesanan), tidak
-- ada UPDATE/DELETE dari client.
create policy "order_items_select_admin"
  on public.order_items for select
  using (public.current_user_role() = 'admin');

-- ============================================================================
-- TABEL: payment_transactions
-- Hanya ditulis/diupdate dari Edge Function webhook Midtrans (service role,
-- bypass RLS). Dari client, admin hanya boleh SELECT untuk audit.
-- ============================================================================
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  midtrans_transaction_id text,
  status text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

create index if not exists idx_payment_transactions_order_id on public.payment_transactions (order_id);

alter table public.payment_transactions enable row level security;

create policy "payment_transactions_select_admin"
  on public.payment_transactions for select
  using (public.current_user_role() = 'admin');

-- Sengaja tidak ada policy insert/update/delete untuk client sama sekali —
-- tabel ini murni ditulis oleh webhook Edge Function via service role key.

-- ============================================================================
-- TABEL: rate_limits
-- Generik (bukan spesifik 1 endpoint) — dipakai `public-checkout` (§0.12)
-- dan endpoint publik lain di masa depan yang butuh rate limit, tinggal beda
-- `key`. Tidak ada policy RLS untuk anon/authenticated sama sekali — hanya
-- diakses lewat function SECURITY DEFINER `check_rate_limit` di bawah, atau
-- service_role (Edge Function).
-- ============================================================================
create table if not exists public.rate_limits (
  key text primary key,
  attempt_count int not null default 0,
  window_started_at timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
-- Sengaja tidak ada policy sama sekali — default deny untuk semua role client.

-- Sliding-window sederhana (fixed window): kalau belum ada baris untuk
-- `p_key` ATAU window sebelumnya sudah lewat `p_window_seconds`, mulai
-- window baru (count = 1) -> izinkan. Kalau masih dalam window & count <
-- p_max_attempts -> increment, izinkan. Kalau sudah >= p_max_attempts ->
-- tolak (count TIDAK ditambah lagi supaya kolom tidak infinite-growth kalau
-- ada penyerang yang tetap coba walau sudah diblokir). `for update` mengunci
-- baris supaya 2 request bersamaan dari key yang sama tidak sama-sama lolos
-- baca count lama sebelum salah satunya sempat increment (race condition).
create or replace function public.check_rate_limit(
  p_key text,
  p_max_attempts int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_window_expired boolean;
begin
  select * into v_row from public.rate_limits where key = p_key for update;

  if not found then
    insert into public.rate_limits (key, attempt_count, window_started_at)
    values (p_key, 1, now());
    return true;
  end if;

  v_window_expired := (now() - v_row.window_started_at) > make_interval(secs => p_window_seconds);

  if v_window_expired then
    update public.rate_limits
    set attempt_count = 1, window_started_at = now()
    where key = p_key;
    return true;
  end if;

  if v_row.attempt_count >= p_max_attempts then
    return false;
  end if;

  update public.rate_limits
  set attempt_count = attempt_count + 1
  where key = p_key;
  return true;
end;
$$;

-- Sengaja HANYA service_role (dipakai Edge Function lewat service role key,
-- bukan anon key browser) yang boleh EXECUTE — supaya klien (browser) tidak
-- bisa memanggil function ini langsung dengan `p_key` sembarangan (mis.
-- reset limit IP orang lain, atau spam key acak untuk membesarkan tabel
-- `rate_limits` tanpa batas / DoS penyimpanan).
revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- Seed default kategori supaya tab "Produk" (Modul 3) tidak mulai kosong
-- total — admin tetap bebas tambah/hapus/ubah dari UI.
insert into public.categories (nama, urutan)
values ('Original', 1), ('Topping Coklat', 2), ('Topping Keju', 3)
on conflict (nama) do nothing;

-- ============================================================================
-- Catatan uji manual DoD Modul 2 (ARCHITECTURE.md §6):
-- 1. Anon key: select * from products; -> hanya baris aktif=true yang muncul.
-- 2. Anon key: select * from orders; -> harus kosong/gagal (tidak ada policy).
-- 3. Anon key: insert into orders (...) values (...); -> harus gagal (no policy).
-- 4. Login sebagai admin: select * from orders; -> semua baris muncul.
-- 5. Login sebagai admin: update orders set status='completed' where id=...;
--    -> HARUS GAGAL (tidak ada policy UPDATE untuk siapa pun, hanya RPC/Edge
--    Function service-role yang boleh, lihat Modul 8 & 10).
-- 6. Login sebagai admin: CRUD ke products/categories/banners/settings ->
--    harus berhasil semua.
-- 7. Anon key: select * from rate_limits; / select check_rate_limit(...);
--    -> harus gagal (permission denied / RLS block).
-- ============================================================================
