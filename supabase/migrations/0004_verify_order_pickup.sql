-- Modul 10: Scan QR Verifikasi Serah Terima Admin (ARCHITECTURE.md §6).
--
-- Tabel `orders` SENGAJA tidak punya policy UPDATE untuk client manapun
-- (0002_schema_and_rls.sql, ARCHITECTURE.md §5 poin 1 & 3) — mutasi status
-- `paid` -> `completed` cuma boleh lewat RPC SECURITY DEFINER ini, bukan
-- `UPDATE` langsung dari browser admin (beda dari AyamKu yang awalnya punya
-- celah ini sebelum security review Modul 18, lihat AYAMKU_REFERENCE.md §4
-- temuan #1 — GAGI menerapkan RPC dari awal, bukan ditambal belakangan).
--
-- Dipanggil dari tab "Scan QR Verifikasi" (`src/components/admin/ScanQrTab.jsx`)
-- lewat `src/features/orders/pickupApi.js`, pakai anon key sebagai admin yang
-- login (`authenticated` role, `current_user_role() = 'admin'` dicek di
-- dalam fungsi, sama pola dengan `update_product_stock` Modul 6).
--
-- SQLSTATE custom dipakai supaya frontend bisa membedakan jenis penolakan
-- tanpa harus mem-parsing teks pesan (§6 Modul 10 DoD — pesan beda untuk
-- "sudah completed" vs "expired" vs "belum paid"):
--   P0001 (default raise exception) -> pesanan tidak ditemukan / token salah
--   P0002 -> pesanan SUDAH pernah diverifikasi sebelumnya (double-scan)
--   P0003 -> QR sudah kedaluwarsa (lebih dari 1x seminggu sejak created_at,
--            ARCHITECTURE.md §0.10)
--   P0004 -> status order belum `paid` (masih `pending` / sudah `cancelled`)
create or replace function public.verify_order_pickup(p_order_token uuid)
returns public.orders
security definer
set search_path = public
language plpgsql
as $$
declare
  v_row public.orders;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Hanya admin yang boleh verifikasi serah terima pesanan';
  end if;

  select * into v_row from public.orders where order_token = p_order_token;

  if v_row.id is null then
    raise exception 'Pesanan tidak ditemukan — QR/kode tidak dikenali';
  end if;

  if v_row.status = 'completed' then
    raise exception 'Pesanan ini SUDAH diverifikasi/diambil sebelumnya' using errcode = 'P0002';
  end if;

  -- Masa berlaku 1x seminggu (7x24 jam) sejak dibuat, ARCHITECTURE.md §0.10
  -- — dicek SEBELUM cek status paid, supaya pesan error paling spesifik
  -- muncul duluan kalau order paid tapi sudah lewat waktu (dibanding cuma
  -- bilang "belum paid" yang menyesatkan).
  if v_row.created_at < (now() - interval '7 days') then
    raise exception 'QR pesanan ini sudah KEDALUWARSA (lebih dari 1x seminggu sejak dipesan)'
      using errcode = 'P0003';
  end if;

  if v_row.status <> 'paid' then
    raise exception 'Pesanan belum bisa diverifikasi — status saat ini: %', v_row.status
      using errcode = 'P0004';
  end if;

  -- Guard atomic `.eq('status','paid')` di WHERE (bukan cek-lalu-update
  -- terpisah) mencegah race condition kalau 2 admin scan QR yang sama nyaris
  -- bersamaan — cuma salah satu yang berhasil UPDATE, yang lain akan dapat
  -- `v_row.id is null` di bawah lalu ditolak dengan pesan generik (jarang
  -- terjadi tapi dijaga, sama filosofi dengan `decrement_product_stock`).
  update public.orders
  set status = 'completed'
  where id = v_row.id
    and status = 'paid'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Gagal verifikasi — status pesanan berubah saat diproses, coba scan ulang';
  end if;

  return v_row;
end;
$$;

revoke all on function public.verify_order_pickup(uuid) from public;
grant execute on function public.verify_order_pickup(uuid) to authenticated;

-- ============================================================================
-- Checklist testing manual DoD Modul 10 (ARCHITECTURE.md §6):
-- 1. Buat order sampai `paid` (checkout sungguhan atau update manual SQL utk
--    testing), scan QR-nya (atau input token manual) di tab "Scan QR
--    Verifikasi" -> harus sukses, `orders.status` jadi `completed`.
-- 2. Scan QR yang sama lagi -> harus muncul warning jelas "sudah pernah
--    diverifikasi" (SQLSTATE P0002), BUKAN error generik.
-- 3. Update manual `created_at` 1 order jadi 8 hari lalu, coba verifikasi ->
--    ditolak "kedaluwarsa" (P0003).
-- 4. Coba verifikasi order yang masih `pending`/`cancelled` -> ditolak jelas
--    status belum bisa diverifikasi (P0004).
-- 5. Panggil `verify_order_pickup` pakai anon key TANPA login admin (mis.
--    lewat SQL/REST langsung sebagai role `anon`) -> harus ditolak
--    "Hanya admin...".
-- 6. Begitu status jadi `completed`, buka halaman `/order/:order_token`
--    customer di tab/device lain yang sudah terbuka SEBELUM verifikasi ->
--    harus auto-update tanpa reload (Realtime `subscribeOrderStatus`, sudah
--    discaffold sejak Modul 7, tidak ada perubahan di sini).
-- ============================================================================
