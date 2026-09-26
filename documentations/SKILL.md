# SKILL.md — Prompt Pattern yang Sering Dipakai Ulang

> Kumpulan pola prompt untuk tugas yang berulang di proyek ini (testing, security review, refactor, dsb). Tujuannya supaya tidak perlu tulis ulang instruksi yang sama tiap sesi baru — tinggal rujuk bagian ini.

## 1. Security Review (sebelum deploy modul apapun yang menyentuh uang/data customer)
Prompt pattern:
```
Review modul [nama modul] terhadap checklist keamanan di ARCHITECTURE.md §5.
Khusus cek:
1. Apakah ada data sensitif (harga, diskon, status pembayaran) yang dipercaya
   langsung dari input client tanpa validasi ulang di server?
2. Apakah RLS policy tabel yang dipakai modul ini sudah default-deny lalu
   whitelist per role (bukan sebaliknya)?
3. Apakah ada mutasi status `orders` yang lewat UPDATE langsung dari client
   (harus lewat RPC SECURITY DEFINER/Edge Function, lihat AGENTS.md §4)?
4. Apakah ada credential/API key yang bocor ke kode frontend (/src)?
5. Kalau ada endpoint publik (anon), apakah rawan enumerasi/abuse
   (contoh: bisa tebak order_token orang lain)?
Laporkan temuan sebagai list, urutkan dari risiko paling tinggi.
```

## 2. Testing Manual End-to-End (sebelum tandai modul "Selesai" di TODO.md)
Prompt pattern:
```
Buat checklist testing manual untuk modul [nama modul], mengacu ke
Definition of Done di ARCHITECTURE.md §6. Format checklist:
- [ ] Skenario normal (happy path)
- [ ] Skenario gagal/edge case (contoh: QR sudah discan, QR lewat 1x seminggu,
      checkout tanpa isi Lokasi 1 (wajib), checkout dengan stok habis)
- [ ] Skenario keamanan (contoh: coba akses endpoint/RPC sebagai anon,
      coba UPDATE orders langsung dari console browser)
Jangan tandai modul selesai di TODO.md sebelum semua checklist ini lolos.
```

## 3. Refactor Komponen/Fungsi
Prompt pattern:
```
Refactor [nama file/fungsi] tanpa mengubah behavior yang sudah benar.
Fokus:
1. Pecah kalau ada tanggung jawab ganda dalam satu file/fungsi.
2. Pastikan tidak ada logic uang/diskon yang duplikat antara frontend dan
   Edge Function (kalau ada, jadikan sumber kebenaran tunggal di server).
3. Update komentar kalau ada yang jadi tidak relevan setelah refactor.
Setelah refactor, jalankan ulang checklist testing manual modul terkait,
lalu tambahkan baris changelog di TODO.md (WORKFLOW.md §0).
```

## 4. Menambah Fitur Baru ke Modul yang Sudah Ada
Prompt pattern:
```
Sebelum menambah [nama fitur baru] ke modul [nama modul]:
1. Cek apakah ini mengubah skema database (ARCHITECTURE.md §3) — kalau ya,
   update dokumen itu juga, jangan cuma ubah migration.
2. Cek apakah menyentuh RLS policy yang sudah ada — re-review §5.
3. Update TODO.md: tambah baris baru atau ubah status modul terkait jadi
   "Berjalan" sebelum mulai coding, dan tambahkan baris changelog begitu
   selesai (WORKFLOW.md §0) — WAJIB sebelum file diserahkan ke owner.
```

## 5. Debug Payment/Webhook Midtrans
Prompt pattern:
```
Debug masalah pembayaran Midtrans di [order_id/transaction_id]:
1. Cek log Edge Function `midtrans-webhook` — apakah webhook diterima?
2. Cek signature key verification — apakah lolos atau gagal?
3. Cek status di tabel `payment_transactions` (raw_payload) vs status di
   `orders` — apakah sinkron?
4. Jangan pernah "paksa" ubah status order jadi paid secara manual dari
   frontend/client — kalau perlu koreksi manual, lakukan lewat SQL langsung
   di Supabase dashboard oleh admin, dan catat di TODO.md sebagai isu.
```

## 6. Debug Scan QR Verifikasi Gagal/Tidak Sinkron
Prompt pattern:
```
Debug masalah scan QR verifikasi untuk order_token [xxx]:
1. Cek status order saat ini di `orders` (pending/paid/completed/cancelled),
   `created_at` (untuk cek apakah sudah lewat 1x seminggu), dan `lokasi_1`/
   `lokasi_2` (untuk pastikan admin mengantar ke lokasi yang benar).
2. Cek apakah RPC `verify_order_pickup` dipanggil dengan role admin yang
   sah (bukan anon) — lihat log Edge Function/RPC.
3. Cek apakah halaman `/order/:order_token` customer subscribe ke Realtime
   Postgres Changes pada baris order yang benar (filter by order_id/token).
4. Jangan pernah menandai `completed` langsung lewat UPDATE manual dari
   client — kalau perlu koreksi manual, lewat SQL Editor Supabase oleh
   admin, dicatat di TODO.md.
```

## 7. Review Sebelum Deploy ke Production
Prompt pattern:
```
Sebelum deploy modul [nama modul] ke production:
1. Pastikan semua environment variable production (Midtrans production key,
   R2 production credentials, Supabase production project) sudah benar,
   bukan masih sandbox/testing.
2. Jalankan Security Review (§1) dan Testing Manual (§2) sekali lagi.
3. Update status modul di TODO.md jadi "Selesai" hanya setelah kedua hal
   di atas lolos, dan tambahkan baris changelog (WORKFLOW.md §0).
```
