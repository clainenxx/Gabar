-- ============================================================================
-- Migration 0011: Auto-Expire Order Cash Menggantung (7 Hari)
--
-- Latar belakang (temuan security review pihak ketiga, dikonfirmasi owner
-- 2026-09-18): order cash (migration 0008) langsung `paid` tanpa verifikasi
-- nomor/email apapun, dan SEBELUM migration ini tidak pernah kedaluwarsa
-- otomatis sama sekali — beda dari order online yang otomatis `cancelled` +
-- stok di-restore lewat webhook Midtrans (expire 15 menit, migration 0008/
-- `_shared/midtrans.ts`). Konsekuensinya: siapa saja bisa checkout cash
-- berkali-kali (tanpa perlu bayar apapun di muka) untuk MENGUNCI stok tanpa
-- batas waktu — stok baru kembali kalau admin SADAR & membatalkan manual
-- satu-satu lewat `cancel_cash_order` (migration 0009).
--
-- Keputusan owner (chat 2026-09-18) soal durasi kedaluwarsa: BUKAN 15 menit
-- seperti online (order cash dipakai juga buat pre-order/"PO" — customer
-- checkout duluan, ambil & bayar tunai belakangan begitu barang siap) —
-- disamakan dengan durasi QR yang SUDAH ADA di seluruh sistem ("QR berlaku
-- 1x seminggu", lihat teks email `public-checkout`/`midtrans-webhook` dan
-- `verify_order_pickup` migration 0004): **7 hari**. Order cash yang masih
-- `paid` (belum sempat di-scan admin jadi `completed`) begitu lewat 7 hari
-- sejak `created_at` dianggap tidak jadi diambil, otomatis `cancelled` +
-- stok semua itemnya di-restore — PERSIS pola yang sama dengan
-- `cancel_cash_order` (migration 0009), cuma dipicu terjadwal (pg_cron),
-- bukan diklik admin.
--
-- Soal penghitungan omzet (keputusan owner, chat 2026-09-18): TIDAK diubah
-- sama sekali — order cash TETAP dihitung "terjual" sejak checkout dibuat
-- (status `paid`), sama seperti sebelumnya (`COUNTED_STATUSES` di
-- `src/features/orders/ordersApi.js` TIDAK disentuh migration ini). Efeknya
-- justru OTOMATIS "self-correcting": begitu migration ini menjalankan
-- auto-expire (status jadi `cancelled`), order itu OTOMATIS TIDAK LAGI
-- ikut terhitung di `totalPenjualan`/`totalCash` (logic yang sudah ada
-- SEJAK AWAL mengecualikan status `cancelled`) — tidak perlu perubahan kode
-- dashboard apapun untuk ini, cukup pastikan order yang menggantung memang
-- benar-benar di-`cancelled`-kan (itulah fungsi migration ini).
--
-- Owner MEMILIH untuk TIDAK membatasi jumlah order cash aktif per nomor
-- telepon (opsi itu ditolak, chat 2026-09-18) — jadi migration ini SENGAJA
-- tidak menambahkan pembatasan apapun soal itu. Kalau nanti berubah pikiran,
-- itu perubahan terpisah (butuh kolom/RPC baru di checkout, bukan di sini).
-- ============================================================================

-- pg_cron tersedia bawaan di semua project Supabase (extension resmi,
-- tinggal diaktifkan) — dipakai di sini karena paling sederhana untuk
-- "jalankan 1 fungsi SQL tiap jam", tidak perlu infrastruktur
-- Node.js/Edge Function terpisah untuk pekerjaan sesederhana ini.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.expire_stale_cash_orders()
returns int
security definer
set search_path = public
language plpgsql
as $$
declare
  v_order record;
  v_item record;
  v_count int := 0;
begin
  for v_order in
    select id
    from public.orders
    where payment_method = 'cash'
      and status = 'paid'
      and created_at < now() - interval '7 days'
  loop
    -- Guard atomic `.eq('status','paid')` di WHERE — pola sama persis
    -- dengan `cancel_cash_order` (migration 0009): mencegah race condition
    -- kalau order ini KEBETULAN sedang diverifikasi (scan QR) nyaris
    -- bersamaan dengan cron ini jalan.
    update public.orders
    set status = 'cancelled'
    where id = v_order.id
      and status = 'paid';

    if found then
      v_count := v_count + 1;

      -- Restore stok semua item di order ini — per-item, best-effort,
      -- POLA SAMA PERSIS dengan `cancel_cash_order` (migration 0009) &
      -- jalur expire order online di `midtrans-webhook` (migration 0003).
      for v_item in
        select product_id, qty from public.order_items where order_id = v_order.id
      loop
        if v_item.product_id is not null then
          begin
            perform public.restore_product_stock(v_item.product_id, v_item.qty);
          exception when others then
            raise notice 'Gagal restore stok produk % pada order % (auto-expire tetap lanjut): %',
              v_item.product_id, v_order.id, sqlerrm;
          end;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Function ini SENGAJA tidak boleh dipanggil client mana pun (anon maupun
-- admin login) — bukan RPC yang dipakai UI, murni dipanggil terjadwal oleh
-- pg_cron (yang jalan sebagai superuser Postgres, bukan lewat PostgREST/
-- API sama sekali). Cabut grant default PostgREST supaya tidak bisa
-- ditembak lewat endpoint /rest/v1/rpc/expire_stale_cash_orders.
revoke execute on function public.expire_stale_cash_orders() from anon, authenticated;

-- Jadwalkan jalan tiap jam (cukup untuk toleransi "7 hari", tidak perlu
-- lebih sering dari ini) — nama job dibuat unik/idempotent supaya migration
-- ini aman dijalankan ulang tanpa duplikat job.
select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-stale-cash-orders';

select cron.schedule(
  'expire-stale-cash-orders',
  '0 * * * *', -- tiap jam, menit ke-0
  $$select public.expire_stale_cash_orders();$$
);

-- ============================================================================
-- Checklist testing manual:
-- 1. `select public.expire_stale_cash_orders();` langsung lewat SQL Editor
--    (sebagai postgres/service role, BUKAN lewat anon key) -> harus
--    berhasil jalan, return jumlah order yang di-expire (0 kalau memang
--    belum ada yang lewat 7 hari).
-- 2. Coba panggil lewat anon key: `supabase.rpc('expire_stale_cash_orders')`
--    dari browser console -> HARUS ditolak (403/tidak ditemukan), bukan
--    berhasil jalan.
-- 3. Buat order cash baru, lalu manual update `created_at` order itu jadi
--    8 hari lalu lewat SQL Editor (`update orders set created_at = now() -
--    interval '8 days' where id = '...'`) -> jalankan
--    `select public.expire_stale_cash_orders();` manual -> order itu harus
--    jadi `cancelled` dan stok produknya bertambah kembali sejumlah qty.
-- 4. Pastikan order cash yang SUDAH `completed` (sudah di-scan) atau order
--    `online` TIDAK PERNAH ikut ke-expire oleh function ini walau umurnya
--    lebih dari 7 hari (filter `payment_method = 'cash' and status =
--    'paid'` di function harus menyaring itu).
-- 5. Cek job terjadwal benar-benar terdaftar: `select * from cron.job where
--    jobname = 'expire-stale-cash-orders';` -> harus muncul 1 baris dengan
--    schedule `0 * * * *`.
-- ============================================================================
