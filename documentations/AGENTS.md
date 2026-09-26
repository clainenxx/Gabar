# AGENTS.md — Panduan Kerja untuk AI (Coding Agent)

> File ini dibaca AI (Claude Code atau agent lain) sebelum menulis kode. Tes sederhana untuk isi file ini: **"bisakah developer lain memahami apa yang saya tulis di sini?"** Kalau ada instruksi yang cuma AI mengerti tapi manusia bingung, tulis ulang.
>
> Proyek ini adaptasi dari proyek "AyamKu" — kalau ada istilah/pola yang terasa aneh sendirian, cek dulu `ARCHITECTURE.md` §0 untuk lihat apa yang sengaja diwarisi vs sengaja disederhanakan dari proyek asal. **AI TIDAK PERLU akses ke project/zip AyamKu asli untuk memahami rujukan ini** — baca `AYAMKU_REFERENCE.md` di folder yang sama, isinya rangkuman mandiri lengkap tentang AyamKu (fitur yang tidak ada di GAGI, pola yang diwarisi, temuan security review) supaya sesi AI baru tanpa memori apapun tetap bisa lanjut kerja atau membandingkan kedua proyek hanya dari dokumentasi GAGI ini.

## 1. Konteks Proyek
Baca `PRD.md` dan `ARCHITECTURE.md` dulu sebelum menyentuh kode apapun. Semua keputusan implementasi harus konsisten dengan kedua dokumen itu. Kalau ada instruksi user yang bertentangan dengan PRD/Architecture, **tanya dulu**, jangan asumsi sendiri (lihat `WORKFLOW.md` §Kapan Harus Bertanya).

## 2. Tech Stack (jangan diganti tanpa persetujuan eksplisit)
- Frontend: React + Vite, Tailwind CSS, deploy Netlify (asumsi, lihat `ARCHITECTURE.md` §0.11).
- Backend: Supabase (Postgres + Auth + Realtime + Edge Functions).
- Storage media: Cloudflare R2 (bukan Supabase Storage).
- Payment: Midtrans (Snap) **dan** Cash/COD (dikonfirmasi owner 2026-09-08, lihat `PRD.md` §4.1 & `ARCHITECTURE.md` §0.7 — sebelumnya dokumen ini menyatakan "Snap saja" karena dianggap tidak ada kasir; keputusannya diubah, TAPI tetap TIDAK ADA meja kasir/perangkat kasir terpisah — cash di sini artinya Cash On Delivery, dibayar tunai ke admin saat serah terima/scan QR, bukan transaksi di meja kasir).
- Email: Gmail SMTP + App Password via `denomailer`.
- Notifikasi WhatsApp (dikonfirmasi owner 2026-09-15): service Node.js terpisah (`whatsapp-service/`, hosting sendiri, di luar Netlify/Supabase) pakai Baileys — nomor WA ke-2 login scan QR. Edge Function panggil lewat HTTP (secret `WHATSAPP_SERVICE_URL`/`WHATSAPP_SERVICE_API_KEY`), lihat `ARCHITECTURE.md` §1 & `whatsapp-service/README.md`.

## 3. Struktur Folder (standar yang diikuti)
```
/src
  /pages          -> satu file per route (Home.jsx, Checkout.jsx, OrderQr.jsx, AdminLogin.jsx, AdminPage.jsx, dst.)
  /components      -> komponen reusable (Button, Card, ProductCard, LokasiPengantaranInput, SnowOverlay, dst.)
  /features        -> logic per domain (cart/, orders/, products/)
  /lib             -> supabaseClient.js, realtime.js
  /hooks           -> custom hooks (usePublicCart, useProductsStockRealtime, useAuth, dst.)
  /styles          -> tailwind config, design tokens (warna, tema salju)
/supabase
  /functions       -> Edge Functions (midtrans-webhook, public-checkout, get-order, product-image-upload, dst.)
  /migrations      -> SQL migration files (schema + RLS policy)
```

> **Tidak ada** folder/route untuk kasir/display (`pages/kasir/`, `pages/display/`) — kalau suatu saat fitur itu diminta masuk, itu perubahan scope besar yang butuh update `PRD.md` dulu (lihat `WORKFLOW.md` §6), bukan sekadar tambah folder.

## 4. Coding Style & Best Practice
- Bahasa kode/variabel: **Inggris**. Komentar & pesan UI ke user: **Bahasa Indonesia**.
- Komponen React: functional component + hooks, hindari class component.
- Satu file = satu tanggung jawab jelas. Kalau file mulai >250 baris, pertimbangkan pecah jadi sub-komponen.
- Semua environment variable rahasia (Midtrans server key, R2 secret, Supabase service role key) **hanya** boleh dipakai di `/supabase/functions` (Edge Functions), **tidak pernah** di kode `/src` (frontend) yang di-bundle ke browser.
- Semua akses ke Supabase dari frontend pakai **anon key** + mengandalkan RLS, bukan service role key.
- Setiap fungsi yang menyentuh uang (total, diskon, harga) harus punya validasi ulang di server (Edge Function/RPC), tidak boleh percaya 100% angka dari frontend.
- **Mutasi status `orders` (termasuk verifikasi pickup) HANYA lewat RPC SECURITY DEFINER atau Edge Function service-role — tidak pernah ada policy RLS `UPDATE orders` langsung untuk client mana pun.** Ini keputusan yang sudah ditetapkan dari awal (`ARCHITECTURE.md` §5.3), bukan sesuatu yang boleh "disederhanakan dulu, dibenerin nanti" — proyek asal (AyamKu) sempat punya celah persis ini dan perlu security review terpisah untuk menambalnya, jangan diulang di sini.
- Gaya komentar: jelaskan **kenapa**, bukan **apa**. Contoh baik: `// pakai UUID biar order_token tidak bisa ditebak/di-enumerasi`.
- Format commit message: `[modul] deskripsi singkat` — contoh: `[checkout] tambah validasi form Lokasi Pengantaran`.

## 5. Format Test (kalau menulis test)
- Nama file test: `NamaFile.test.jsx` bersebelahan dengan file yang dites.
- Struktur: `describe("NamaKomponen/Fungsi")` → `it("harus melakukan X ketika Y")`.
- Prioritas testing: logic keranjang (total), validasi form Lokasi 1 (wajib)/Lokasi 2 (opsional), validasi webhook Midtrans, RLS policy (test manual query sebagai role berbeda), RPC `verify_order_pickup` (anti double-scan & anti-expired).
- Untuk MVP, test manual end-to-end (checklist di `TODO.md`) cukup; automated test jadi nice-to-have kalau waktu memungkinkan.

## 6. Larangan / Hal yang Tidak Boleh Dilakukan AI Tanpa Izin
- Jangan ubah tech stack inti (React/Vite/Netlify/Supabase/R2/Midtrans) tanpa konfirmasi user.
- Jangan hardcode credentials/API key apapun di kode — selalu lewat environment variable.
- Jangan nonaktifkan RLS "sementara untuk testing" lalu lupa aktifkan lagi — kalau perlu nonaktifkan untuk debug lokal, catat di `TODO.md` sebagai reminder eksplisit.
- Jangan buat tabel/kolom baru di luar skema `ARCHITECTURE.md` §3 tanpa update dokumen itu juga (dokumentasi harus selalu sinkron dengan kode).
- **Jangan menambah kembali konsep kasir/display/role terpisah** tanpa konfirmasi eksplisit owner — ini beda scope yang sudah sengaja dihapus dari proyek asal (`PRD.md` §5).
- **Setiap kali AI mengubah/menambah/menghapus sesuatu di proyek ini, WAJIB tambahkan baris changelog di `TODO.md` (bagian "Perubahan Terbaru") SEBELUM menyerahkan file/hasil ke owner.** Ini aturan mutlak untuk proyek GAGI (lihat `WORKFLOW.md` §5 & `TODO.md` bagian atas).

## 7. Referensi Silang Dokumen
- Kebutuhan produk & fitur → `PRD.md`
- Detail teknis, skema DB, flow, security checklist → `ARCHITECTURE.md`
- Status pengerjaan tiap modul + **changelog wajib** → `TODO.md`
- Prompt pattern berulang (security review, refactor, testing) → `SKILL.md`
- Aturan main kerja (izin, otonomi, definisi "selesai") → `WORKFLOW.md`
- Konteks proyek asal AyamKu (fitur yang tidak diwarisi, pola yang diwarisi, temuan security review) tanpa perlu upload ulang project AyamKu → `AYAMKU_REFERENCE.md`
