-- ============================================================================
-- Migration 0005: tambah kolom orders.snap_token
--
-- Latar belakang (TODO.md Bug/Isu #9): implementasi awal "Lanjutkan
-- Pembayaran" (Modul 7b, resume-payment) salah asumsi Midtrans Snap Create
-- Transaction bisa dipanggil ulang dengan `order_id` yang sama untuk minta
-- token BARU. Ternyata begitu customer sempat pilih metode pembayaran,
-- `order_id` itu terkunci permanen — request ulang SELALU gagal
-- "order_id sudah digunakan" (dokumentasi resmi Midtrans, dikonfirmasi
-- lewat 2 percobaan fix yang gagal, termasuk cancel-then-recreate di
-- Bug/Isu #8 yang ternyata juga tidak berlaku andal untuk transaksi yang
-- dibuat lewat Snap).
--
-- Solusi yang BENAR (dokumentasi resmi Midtrans, Snap.js `window.snap.pay`):
-- "Will open payment page for that specific Snap Token... Also useful if
-- you want to re-open that same payment page again e.g. when you allow
-- another attempt of payment for that same Order ID, in case of closed
-- earlier." — jadi TIDAK PERLU minta transaksi baru ke Midtrans sama
-- sekali untuk "Lanjutkan Pembayaran"; cukup SIMPAN token dari transaksi
-- pertama, lalu panggil `window.snap.pay(token)` lagi dengan token yang
-- SAMA. Migration ini menambah kolom penyimpanannya.
-- ============================================================================

alter table public.orders
  add column if not exists snap_token text;

comment on column public.orders.snap_token is
  'Snap token dari createSnapTransaction() (public-checkout). Disimpan supaya '
  '"Lanjutkan Pembayaran" (resume-payment) bisa buka ulang popup Snap yang '
  'SAMA (window.snap.pay dengan token yang sama) tanpa minta transaksi baru '
  'ke Midtrans — lihat TODO.md Bug/Isu #9.';

-- Tidak perlu index — kolom ini cuma pernah di-lookup lewat `order_token`
-- (sudah unique/ter-index sejak migration 0002), bukan di-query langsung
-- berdasarkan `snap_token`.

-- ============================================================================
-- Checklist testing manual (TODO.md Bug/Isu #9):
-- 1. Checkout baru -> cek kolom `orders.snap_token` untuk order itu terisi
--    (tidak NULL) setelah public-checkout sukses.
-- 2. Di halaman /order/:order_token waktu status masih `pending`, pilih
--    metode bayar di Snap TAPI jangan diselesaikan -> tutup popup.
-- 3. Klik "Lanjutkan Pembayaran" lagi -> popup Snap harus terbuka lagi
--    TANPA error, menampilkan sesi pembayaran yang sama (mis. VA number/QR
--    yang sudah digenerate tetap sama, bukan bikin baru).
-- 4. Selesaikan pembayaran di popup itu -> webhook tetap jalan normal
--    (order_id yang dipakai Midtrans tidak pernah berubah sejak awal).
-- 5. Order lama (dibuat SEBELUM migration ini, `snap_token` NULL) yang
--    klik "Lanjutkan Pembayaran" -> resume-payment fallback minta token
--    baru (order_id itu belum pernah dipakai sama sekali di Midtrans kalau
--    order lama itu juga belum sempat checkout ke Midtrans, ATAU akan
--    gagal dengan pesan jelas kalau ternyata sudah -> arahkan customer
--    checkout ulang dari awal).
-- ============================================================================
