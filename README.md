# GABAR (Gabin Ice Bar) — Website Pre-Order Es Krim Sandwich, Lingkungan Sekolah

Website jualan **GABAR (Gabin Ice Bar)** — pre-order es krim sandwich (Tiramisu, Matcha, Cookies n Cream) yang dipakai di lingkungan **sekolah**: tidak ada titik pickup fisik, **owner sendiri yang mengantar** pesanan langsung ke lokasi pembeli (kelas/kantin/dsb). Terdiri dari **website publik** (browse produk, checkout online via Midtrans atau bayar cash, isi lokasi pengantaran, dapat QR + notifikasi WhatsApp/email) dan **panel admin** (kelola produk/banner/konten halaman, dashboard laporan penjualan, riwayat & pembatalan pesanan, scan QR verifikasi serah terima, broadcast WhatsApp, pengaturan notifikasi & akun admin). Tema visual: minimalis, imut, bersalju — vibe musim dingin sore menjelang magrib, dominan biru muda/biru tua/putih.

> Awalnya proyek ini dimulai dengan nama kerja "GAGI (Gabin Regiee)", diadaptasi dari proyek referensi "AyamKu" (kasir fried chicken) lalu disederhanakan tanpa sistem kasir/customer display. Brand tampilan sudah direbranding penuh jadi **GABAR** — nama lama masih muncul di beberapa identifier internal (CSS variable, key `localStorage`, nama dokumen) yang sengaja tidak diubah karena tidak terlihat pengguna.

## Status Proyek
**Fitur inti sudah dibangun & dipakai** (bukan lagi tahap dokumentasi) — website publik, panel admin, checkout online (Midtrans Snap) & cash, notifikasi WhatsApp (gambar kartu pesanan + QR) dan email, realtime status pesanan, serta beberapa lapis security hardening sudah berjalan. Pengerjaan tetap dilakukan **bertahap per modul/permintaan**, dengan setiap perubahan dicatat sebagai baris changelog di `documentations/TODO.md` — **itu sumber kebenaran paling update** soal fitur apa yang sudah/belum dites live oleh owner, bug yang pernah ditemukan, dan langkah deploy yang masih ditunggu.

## Fitur Utama
**Publik (`/`)**
- Browse produk per kategori, banner promo (carousel, bisa digeser/swipe), keranjang belanja (persist di localStorage)
- Checkout: bayar **online** (Midtrans Snap — kartu, e-wallet, dst. sesuai yang diaktifkan di Dashboard Midtrans) atau **cash** (dibayar tunai saat pesanan diantar)
- Form Lokasi Pengantaran (Lokasi 1 wajib, Lokasi 2 opsional) — dilindungi Cloudflare Turnstile + rate limit + validasi teks anti-spam/phishing
- Halaman `/order/:token` — status pesanan real-time (tanpa reload) + QR code untuk diverifikasi admin, valid 1×seminggu
- Notifikasi otomatis lewat **WhatsApp** (gambar kartu pesanan + QR, via layanan Baileys terpisah) dan **email**

**Admin (`/admin`)**
- Dashboard: ringkasan penjualan (filter Hari Ini/Kemarin/Custom Range/Semua), grafik revenue, statistik pesanan cash
- Manajemen Produk, Kategori, Banner, Konten Halaman publik (semua bisa diedit tanpa deploy ulang)
- Tab Pesanan: riwayat transaksi + pencarian, detail per pesanan, pembatalan manual order cash (stok otomatis dikembalikan)
- Scan QR Verifikasi (kamera device + fallback input manual) untuk serah terima pesanan
- Broadcast WhatsApp ke pelanggan yang belum di-scan QR-nya
- Pengaturan notifikasi (email & nomor WA admin), manajemen banyak akun admin
- Navbar & tab admin sudah responsif di mobile (pill tab bar yang bisa digeser)

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS v4, di-hosting di **Netlify**
- **Backend**: Supabase (Postgres + Auth + Realtime + Row Level Security + Edge Functions/Deno)
- **Pembayaran**: Midtrans Snap (online) + jalur cash custom
- **Notifikasi WhatsApp**: layanan Node.js terpisah (`whatsapp-service/`, library Baileys) yang di-hosting sendiri oleh owner, dipanggil dari Edge Function lewat HTTP + API key; gambar kartu pesanan dirender pakai Satori + resvg
- **Email**: Gmail SMTP (via `denomailer`, dipanggil dari Edge Function)
- **Media**: Cloudflare R2 (disajikan lewat Cloudflare Worker sebagai proxy publik)
- **Anti-bot/anti-abuse**: Cloudflare Turnstile + rate limit RPC di checkout

## Struktur Folder
```
src/                     Frontend React (pages, components/public, components/admin, features, hooks, lib)
supabase/migrations/     Migration SQL berurutan (skema, RLS, RPC)
supabase/functions/      Edge Function Deno (checkout, webhook Midtrans, upload gambar, kelola admin, dll.)
whatsapp-service/        Service Node.js terpisah (Baileys) — dihosting sendiri, BUKAN di Netlify/Supabase
documentations/          PRD, arsitektur, panduan kerja AI, dan TODO.md (status + changelog lengkap)
```

## Menjalankan Secara Lokal
1. `npm install`
2. Salin `.env.example` → `.env`, isi `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MIDTRANS_CLIENT_KEY`, `VITE_TURNSTILE_SITE_KEY`
3. `npm run dev`

Edge Function & secret server (service role Supabase, Midtrans server key, kredensial R2, Turnstile secret, Gmail App Password, dll.) **tidak** disimpan di `.env` frontend — diset lewat `supabase secrets set` / Supabase Dashboard, lalu Edge Function terkait di-deploy ulang setiap kali kodenya berubah. Detail lengkap tiap secret ada di komentar kode Edge Function masing-masing dan riwayatnya di `documentations/TODO.md`.

`whatsapp-service/` dijalankan terpisah di hosting Node.js milik owner sendiri (bukan Netlify/Supabase) — lihat `whatsapp-service/README.md` untuk cara setup & scan QR login WhatsApp.

⚠️ **Jangan pernah commit file `.env`/`.env.bak`/kunci apa pun ke git** — sudah dikecualikan lewat `.gitignore`, tapi selalu cek dulu sebelum `git push` kalau ada file `.env.bak` atau sejenisnya yang sempat dibuat manual.

## Dokumentasi Lengkap (folder `documentations/`)
| Dokumen | Isi |
|---|---|
| `PRD.md` | Requirement produk — fitur, target pengguna, scope in/out |
| `ARCHITECTURE.md` | Desain teknis — skema DB, flow, security checklist, breakdown modul |
| `AGENTS.md` | Panduan kerja untuk AI coding agent manapun |
| `CLAUDE.md` | Tambahan khusus untuk Claude/Claude Code |
| `WORKFLOW.md` | Aturan kapan AI boleh otonom vs wajib minta izin, termasuk aturan changelog wajib |
| `SKILL.md` | Prompt pattern berulang (security review, testing, refactor, debug) |
| `TODO.md` | **Status tiap modul + changelog lengkap setiap perubahan — paling update, baca ini dulu** |
| `AYAMKU_REFERENCE.md` | Rangkuman proyek referensi "AyamKu" (fitur yang sengaja tidak diikuti, pelajaran security) |
