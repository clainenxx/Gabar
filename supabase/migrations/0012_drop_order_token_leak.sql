-- ============================================================================
-- Migration 0012: Hapus `order_token` dari `order_status_public`
--
-- Temuan security review pihak ketiga (dikonfirmasi owner 2026-09-18):
-- `order_status_public` (migration 0006) punya policy
-- "select using (true)" — SENGAJA terbuka untuk siapa saja, karena
-- didesain "aman" (tanpa PII apapun: cuma id/status). TAPI kolom
-- `order_token` yang ikut ditaruh di situ TERNYATA justru sama saja
-- membocorkan token unguessable itu ke siapa pun yang query tabel ini
-- (atau subscribe Realtime-nya) — meniadakan proteksi "UUID v4 tidak bisa
-- ditebak" yang jadi satu-satunya penjaga endpoint `get-order` (§5.5).
-- Begitu attacker punya daftar `order_token` (tinggal `select * from
-- order_status_public` pakai anon key, atau dengar semua event Realtime-nya),
-- endpoint publik `get-order` bisa dipakai untuk lihat nama, lokasi antar,
-- item, dan total SETIAP pesanan siapa saja — parah karena basis
-- pelanggannya siswa (data lokasi antar = lokasi sekolah/kelas mereka).
--
-- Kolom ini TERNYATA sudah TIDAK DIPAKAI SAMA SEKALI oleh frontend —
-- `subscribeOrderStatus` (`src/lib/realtime.js`) filter Realtime-nya sejak
-- awal sudah pakai `order_id` (`filter: order_id=eq.${orderId}`), BUKAN
-- `order_token`. Jadi kolom ini murni bocoran yang tidak ada gunanya sama
-- sekali — dihapus total, bukan cuma dicabut dari policy.
-- ============================================================================

alter table public.order_status_public drop column if exists order_token;

-- Trigger sync (migration 0006) perlu diupdate juga supaya tidak lagi coba
-- insert kolom yang sudah tidak ada.
create or replace function public.sync_order_status_public()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.order_status_public (order_id, status, updated_at)
  values (new.id, new.status, now())
  on conflict (order_id)
  do update set status = excluded.status, updated_at = excluded.updated_at;
  return new;
end;
$$;

-- ============================================================================
-- Checklist testing manual:
-- 1. `select * from order_status_public limit 5;` pakai anon key -> kolom
--    `order_token` HARUS TIDAK ADA lagi di hasilnya sama sekali.
-- 2. Buka halaman `/order/:order_token` untuk order `pending`, biarkan tab
--    terbuka, lalu ubah status order itu jadi `paid` (SQL editor atau bayar
--    sungguhan) -> tab yang terbuka HARUS TETAP otomatis update ke tampilan
--    "Sudah Dibayar" tanpa refresh (regression check — pastikan hapus kolom
--    ini TIDAK merusak fitur Realtime yang sudah jalan, karena memang tidak
--    pernah dipakai untuk filter-nya).
-- 3. Scan QR verifikasi (admin) untuk order yang sama -> tab customer harus
--    tetap otomatis berubah jadi "Sudah Diambil" (regression check yang sama).
-- ============================================================================
