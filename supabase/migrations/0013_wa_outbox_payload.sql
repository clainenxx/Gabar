-- Kartu pesanan WhatsApp (gambar + QR) — kolom `payload` untuk `wa_outbox`.
--
-- Latar belakang: notifikasi WA ke customer sekarang berupa GAMBAR (kartu
-- pesanan dengan QR ke `/order/:order_token`), dibuat `whatsapp-service`
-- dari data pesanan (`order-card.js`). Kalau `whatsapp-service` down saat
-- order masuk, batch disimpan ke `wa_outbox` (migration 0010) untuk di-retry.
-- Kolom `message` (teks) saja tidak cukup buat retry — retry harus tetap
-- mengirim GAMBAR, jadi data kartunya ikut disimpan di sini.
--
-- Isi `payload`: `{ "card": { namaCustomer, items[], total, orderToken,
-- orderUrl, caption? } }` untuk pesan bergambar; NULL untuk pesan teks biasa
-- (mis. pesan ke admin) dan untuk semua baris lama sebelum migration ini.
-- `message` tetap terisi sebagai teks CADANGAN (tanpa link) yang dikirim kalau
-- gambar gagal dibuat saat retry.
--
-- Tidak ada perubahan RLS: tabel ini tetap default-deny total, cuma
-- `service_role` (Edge Function & whatsapp-service) yang mengakses.
--
-- URUTAN DEPLOY: jalankan migration ini SEBELUM redeploy `midtrans-webhook`
-- dan `public-checkout` — versi barunya menulis kolom `payload`; kalau
-- kolomnya belum ada, insert ke `wa_outbox` (jalur retry saat service down)
-- akan gagal.
alter table public.wa_outbox
  add column if not exists payload jsonb;

comment on column public.wa_outbox.payload is
  'Data tambahan pesan. {"card": {...}} = kirim GAMBAR kartu pesanan (whatsapp-service/order-card.js); '
  'NULL = pesan teks biasa. `message` tetap jadi teks cadangan tanpa link.';
