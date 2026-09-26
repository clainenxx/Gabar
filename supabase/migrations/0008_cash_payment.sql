-- ============================================================================
-- Migration 0008: Fitur Pembayaran Cash (COD saat diantar)
--
-- Latar belakang: PRD.md/ARCHITECTURE.md §0.7 sebelumnya menyatakan Midtrans
-- Snap adalah SATU-SATUNYA jalur pembayaran ("tidak ada jalur cash seperti
-- kasir AyamKu, karena semua transaksi online"). Owner (2026-09-08) meminta
-- ditambahkan jalur "Bayar Cash" di checkout — dikonfirmasi via chat
-- langsung ke AI, dicatat di sini + PRD.md/ARCHITECTURE.md/AGENTS.md sebagai
-- perubahan scope resmi (WORKFLOW.md §6).
--
-- Konsep: karena TIDAK ADA kasir/meja pembayaran terpisah (§4.2 — owner
-- sendiri yang mengantar), "cash" di GAGI berarti Cash On Delivery: owner
-- menerima uang tunai LANGSUNG DI LOKASI saat serah terima, bersamaan
-- dengan momen scan QR verifikasi (RPC `verify_order_pickup`, migration
-- 0004) yang SUDAH ADA dan TIDAK DIUBAH sama sekali oleh migration ini.
-- Konsekuensinya:
--   - Order cash TIDAK PERNAH melalui status `pending` (tidak ada Midtrans
--     Snap yang perlu ditunggu) — begitu checkout submit, order LANGSUNG
--     dibuat dengan status `paid` (dipilih owner supaya tetap dianggap sah
--     & lolos filter laporan penjualan yang sudah ada, ARCHITECTURE.md
--     §4.2 `COUNTED_STATUSES`, tanpa perlu status baru).
--   - Stok dipotong di titik yang SAMA seperti order online (saat checkout,
--     `decrement_product_stock` di Edge Function `public-checkout`) —
--     tidak ada perbedaan logic potong stok antara cash/online.
--   - Pembeda cash vs online HANYA lewat kolom `payment_method` baru di
--     bawah ini — TIDAK menambah nilai baru ke `orders.status` (tetap
--     `pending`/`paid`/`completed`/`cancelled`, migration 0002) supaya RPC
--     `verify_order_pickup`, filter laporan (`isCountedOrderStatus`), dan
--     RLS yang sudah ada semuanya tetap berlaku APA ADANYA tanpa perubahan.
--   - Teks yang ditampilkan ke customer untuk order `paid` + `payment_method
--     = 'cash'` SENGAJA beda dari order online (bukan "Sudah Dibayar" —
--     uangnya belum diterima owner sungguhan sampai serah terima — dan
--     bukan "Menunggu Pembayaran" — order sudah sah/tidak perlu bayar
--     online) — jadi teks "Menunggu Di-scan" (lihat OrderQr.jsx). Ini murni
--     perubahan tampilan di frontend, tidak butuh nilai status baru di DB.
--   - Email konfirmasi tetap dikirim ke customer SAAT checkout submit
--     (bukan lewat webhook Midtrans yang tidak akan pernah terpanggil untuk
--     cash) — dikirim langsung dari `public-checkout` (lihat perubahan di
--     file itu), memakai template yang disesuaikan (minta siapkan uang
--     cash, bukan "pembayaran sudah diterima").
-- ============================================================================

alter table public.orders
  add column if not exists payment_method text not null default 'online'
    check (payment_method in ('online', 'cash'));

comment on column public.orders.payment_method is
  'Cara bayar dipilih customer saat checkout: ''online'' (Midtrans Snap, '
  'default/perilaku lama) atau ''cash'' (COD — dibayar tunai ke admin saat '
  'serah terima, dikonfirmasi bersamaan dengan scan QR verify_order_pickup). '
  'Ditambahkan di migration 0008, dikonfirmasi owner 2026-09-08.';

-- Index kecil untuk kebutuhan admin/laporan filter per metode bayar nanti
-- (belum ada UI-nya di tahap ini, disiapkan supaya query-nya murah kalau
-- diminta owner di tahap berikutnya).
create index if not exists idx_orders_payment_method on public.orders (payment_method);

-- Tidak ada perubahan RLS/RPC apapun di migration ini — kolom baru ini
-- hanya pernah DITULIS lewat Edge Function `public-checkout` (service role,
-- sudah bypass RLS sejak awal, ARCHITECTURE.md §5.1) dan DIBACA lewat
-- policy `orders_select_admin` yang sudah ada + Edge Function `get-order`
-- (keduanya cukup ditambah kolom ini ke daftar `select`, tidak perlu
-- policy baru).

-- ============================================================================
-- Checklist testing manual:
-- 1. Checkout pilih "Bayar Cash" -> order langsung dibuat dengan
--    `status='paid'` dan `payment_method='cash'`, TANPA membuka popup
--    Midtrans Snap sama sekali, customer langsung diarahkan ke
--    `/order/:order_token` dan LANGSUNG lihat QR (bukan tombol "Lanjutkan
--    Pembayaran").
-- 2. Stok produk yang dipesan berkurang tepat setelah submit checkout cash
--    (sama seperti checkout online) -- cek `products.stock` di admin/DB.
-- 3. Email konfirmasi tetap masuk ke customer (isi email beda dari email
--    online — minta siapkan uang cash, BUKAN "pembayaran sudah diterima").
-- 4. Halaman `/order/:order_token` untuk order cash tersebut menampilkan
--    teks status "Menunggu Di-scan" (BUKAN "Sudah Dibayar"/"Menunggu
--    Pembayaran").
-- 5. Admin scan QR order cash itu di tab "Scan QR Verifikasi" -> berhasil
--    seperti order online biasa (RPC `verify_order_pickup` tidak diubah
--    sama sekali oleh migration ini), status jadi `completed`, halaman
--    customer auto-update ke "QR berhasil di-scan" tanpa reload.
-- 6. Checkout pilih "Bayar Online" (default) -> perilaku SAMA PERSIS seperti
--    sebelum migration ini (regression check) -- `payment_method` tersimpan
--    `'online'`, tetap lewat status `pending` + popup Snap seperti biasa.
-- ============================================================================
