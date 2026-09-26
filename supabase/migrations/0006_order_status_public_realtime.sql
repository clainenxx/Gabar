-- Modul 7c (2026-09-08): Auto-update halaman /order/:order_token TANPA
-- RELOAD saat status order berubah (pending->paid oleh webhook Midtrans,
-- atau paid->completed oleh admin scan QR Modul 10) — beneran nyala,
-- bukan cuma niat.
--
-- BUG YANG DIPERBAIKI: `subscribeOrderStatus` (src/lib/realtime.js) dari
-- Modul 7 SEBENARNYA sudah subscribe ke Postgres Changes tabel `orders`
-- sejak awal, TAPI tidak pernah benar-benar mengirim event ke browser
-- customer karena 2 hal yang kelewat:
--   1. Tabel `orders` TIDAK PERNAH ditambahkan ke publication
--      `supabase_realtime` (beda dari `products`, lihat
--      0003_realtime_stock.sql) — jadi Postgres tidak pernah
--      me-replicate perubahannya ke Realtime server sama sekali.
--   2. SEANDAINYA pun (1) ditambal, Supabase Realtime tetap mengevaluasi
--      RLS SELECT tabel itu untuk role yang connect (anon, karena
--      customer tidak login) sebelum broadcast — dan `orders` SENGAJA
--      tidak punya policy select untuk anon (0002_schema_and_rls.sql
--      §5.1, karena isinya PII: nama_customer/no_telp/email/lokasi).
--      Menambahkan `using (true)` langsung di tabel `orders` akan
--      membuka celah baru: `GET /rest/v1/orders` tanpa filter jadi bisa
--      men-dump SEMUA data pesanan (nama/no-telp/lokasi) pakai anon key.
--
-- SOLUSI: tabel bayangan sempit `order_status_public` — HANYA berisi
-- id, order_token, status, updated_at (tanpa PII apapun) — disinkron
-- otomatis lewat trigger tiap `orders.status` berubah, dan tabel INI
-- yang didaftarkan ke publication + dikasih RLS select terbuka (aman,
-- karena tidak ada data sensitif yang bisa didapat walau di-dump
-- seluruhnya). Frontend (`subscribeOrderStatus`) pindah dengar dari
-- tabel ini, bukan `orders` langsung.

-- ============================================================================
-- 1. Tabel bayangan (tanpa PII)
-- ============================================================================
create table if not exists public.order_status_public (
  order_id uuid primary key references public.orders (id) on delete cascade,
  order_token uuid not null unique,
  status text not null,
  updated_at timestamptz not null default now()
);

alter table public.order_status_public enable row level security;

-- Aman dibuka untuk siapa saja (anon) — cuma status + token (yang memang
-- sudah diketahui customer lewat URL-nya sendiri), tidak ada nama/no
-- telp/lokasi/total. Tidak ada policy insert/update/delete untuk client
-- manapun — baris ini HANYA diisi lewat trigger di bawah (yang jalan
-- dengan hak akses `verify_order_pickup` SECURITY DEFINER atau service
-- role Edge Function `midtrans-webhook`, keduanya sudah bypass RLS).
create policy "order_status_public_select_all"
  on public.order_status_public for select
  using (true);

-- ============================================================================
-- 2. Trigger sync dari `orders.status` -> `order_status_public`
-- ============================================================================
create or replace function public.sync_order_status_public()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.order_status_public (order_id, order_token, status, updated_at)
  values (new.id, new.order_token, new.status, now())
  on conflict (order_id)
  do update set status = excluded.status, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists trg_sync_order_status_public on public.orders;
create trigger trg_sync_order_status_public
  after insert or update of status on public.orders
  for each row execute function public.sync_order_status_public();

-- Backfill baris yang sudah ada sebelum migration ini jalan.
insert into public.order_status_public (order_id, order_token, status, updated_at)
select id, order_token, status, updated_at from public.orders
on conflict (order_id) do update set status = excluded.status, updated_at = excluded.updated_at;

-- ============================================================================
-- 3. Realtime publication
-- ============================================================================
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_status_public'
  ) then
    alter publication supabase_realtime add table public.order_status_public;
  end if;
end $$;

-- ============================================================================
-- Checklist testing manual:
-- 1. Buka halaman `/order/:order_token` untuk order berstatus `pending` di
--    browser, biarkan tab tetap terbuka. Bayar order tsb (atau update
--    manual `orders.status = 'paid'` via SQL editor untuk testing) ->
--    tab yang terbuka HARUS otomatis berubah ke tampilan QR "Sudah
--    Dibayar" dalam <2 detik, TANPA refresh.
-- 2. Dari tab admin "Scan QR Verifikasi", scan QR order yang sama itu ->
--    tab customer yang masih terbuka HARUS otomatis berubah jadi
--    "Sudah Diambil" tanpa refresh.
-- 3. `select * from order_status_public;` lewat anon key -> harus
--    berhasil (design choice: tidak ada PII di tabel ini) tapi
--    `select * from orders;` lewat anon key HARUS TETAP gagal/kosong
--    seperti sebelumnya (RLS orders tidak berubah sama sekali).
-- ============================================================================
