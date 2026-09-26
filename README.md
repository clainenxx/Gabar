# GAGI (Gabin Regiee) — Website Jualan Makanan Gabin, Pre-Order Online

Adaptasi dari proyek "AyamKu" (fried chicken kasir + pre-order online), disederhanakan **tanpa sistem kasir/customer display** — hanya **website publik** (order online, bayar, isi lokasi pengantaran, dapat QR, email konfirmasi) dan **panel admin** (kelola produk, lihat laporan transaksi, lihat lokasi tiap pesanan, scan QR saat serah terima). Dipakai di lingkungan **sekolah**: tidak ada titik pickup fisik — **owner sendiri yang mengantar** pesanan ke lokasi pelanggan. Tema visual: minimalis, imut, bersalju — vibe musim dingin sore menjelang magrib, 3 warna dominan biru muda / biru tua / putih.

Frontend React + Vite, backend Supabase (Postgres + Auth + Realtime + Edge Functions), media di Cloudflare R2, email via Gmail SMTP, pembayaran via Midtrans Snap.

## Status Proyek Saat Ini
**Tahap dokumentasi & perencanaan — belum ada kode aplikasi.** Sesuai permintaan owner, proyek ini dikerjakan **bertahap**: dokumentasi lengkap dibuat dulu, asumsi arsitektur dikonfirmasi, baru pengerjaan kode dimulai modul demi modul. Lihat `documentations/TODO.md` untuk status terkini & riwayat perubahan (changelog) — **sumber kebenaran paling update**.

## Dokumen Lengkap (folder `documentations/`)
| Dokumen | Isi |
|---|---|
| `PRD.md` | Requirement produk — fitur, target pengguna, scope in/out |
| `ARCHITECTURE.md` | Desain teknis — asumsi arsitektur, skema DB, flow, security checklist, breakdown modul |
| `AGENTS.md` | Panduan kerja untuk AI coding agent manapun |
| `CLAUDE.md` | Tambahan khusus untuk Claude/Claude Code |
| `WORKFLOW.md` | Aturan kapan AI boleh otonom vs wajib minta izin, termasuk **aturan changelog wajib** |
| `SKILL.md` | Prompt pattern berulang (security review, testing, refactor, debug) |
| `TODO.md` | Status tiap modul + **changelog setiap perubahan** (wajib diisi sebelum file diserahkan ke owner) |

## Keputusan yang Sudah Dikonfirmasi Owner
- Nama brand untuk sekarang: **GAGI**.
- Lebih dari 1 akun admin dibutuhkan → tab "Akun Admin" masuk MVP.
- Produk tidak butuh varian (rasa/topping) → tiap varian jadi produk terpisah.
- Masa berlaku QR verifikasi: **1x seminggu** (bukan 1x24 jam).
- Metode pembayaran Midtrans Snap **tidak dibatasi ke QRIS saja**.
- **Tidak ada sistem voucher** — dihapus dari scope MVP.
- **Tidak ada titik pickup** — owner sendiri mengantar ke lokasi pelanggan (form Lokasi 1 wajib + Lokasi 2 opsional saat checkout).

## Sebelum Mulai Coding — Perlu Konfirmasi Owner
Lihat daftar lengkap "Keputusan Terbuka" di `documentations/TODO.md`, sisanya tinggal:
- Hosting frontend (asumsi Netlify)?

Setelah ini dikonfirmasi, pengerjaan dimulai dari **Modul 0 — Setup Project** (lihat `documentations/ARCHITECTURE.md` §6), satu modul per giliran kerja.
