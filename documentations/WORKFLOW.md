# WORKFLOW.md — Aturan Main Kerja AI

> Mengatur kapan AI boleh jalan sendiri (otonom), kapan wajib minta izin dulu, dan kapan sebuah fitur dianggap "selesai". Tujuannya menghindari AI mengambil keputusan besar sepihak tanpa sepengetahuan owner.

## 0. Aturan Changelog Wajib (khusus proyek GAGI)
Sebelum menyerahkan/menampilkan file hasil perubahan apapun ke owner, AI **wajib** menambahkan baris baru di `TODO.md` bagian "Perubahan Terbaru" yang berisi: tanggal, ringkas apa yang diubah, alasan/permintaan siapa (owner/bug fix/dsb), file yang tersentuh, dan status testing. **Tidak ada pengecualian** — berlaku untuk penambahan dokumen, kode baru, bug fix sekecil apapun, sampai perubahan status modul.

## 1. Kapan AI Boleh Jalan Sendiri (Otonom, Tanpa Perlu Tanya Dulu)
- Menulis/mengedit kode untuk modul yang **statusnya sudah "Berjalan" di `TODO.md`** dan scope-nya sudah jelas dari `ARCHITECTURE.md`.
- Memperbaiki bug yang **tidak mengubah skema database** dan **tidak mengubah logic pembayaran/diskon**.
- Menulis/update komentar, dokumentasi internal, format ulang kode (styling, tidak mengubah behavior).
- Menambah test manual/checklist sesuai pola di `SKILL.md`.
- Update `TODO.md` (progress, catatan, checklist, changelog) — ini justru **wajib** dilakukan tiap ada perubahan (lihat §0).

## 2. Kapan AI WAJIB Minta Izin Dulu ke Owner
- **Sebelum mengubah skema database** (tambah/hapus tabel atau kolom).
- **Sebelum mengubah logic yang menyentuh uang**: perhitungan total, status pembayaran.
- **Sebelum mengubah/menonaktifkan RLS policy** apapun.
- **Sebelum mengganti tech stack inti** (contoh: ganti Gmail SMTP ke provider lain, ganti Postgres Changes ke Broadcast) — walaupun secara teknis lebih baik, tetap harus dikomunikasikan alasannya dulu.
- **Sebelum deploy ke production** — terutama modul yang menyentuh Midtrans production key.
- **Kalau instruksi user di chat bertentangan dengan `PRD.md`/`ARCHITECTURE.md`** — jangan diam-diam menuruti atau diam-diam mengabaikan, tapi tanyakan/klarifikasi dulu, lalu update dokumen kalau memang keputusannya berubah.
- **Kalau ada asumsi di `ARCHITECTURE.md` §0 yang ternyata salah** saat mulai coding (contoh: owner ternyata butuh lokasi pengantaran lebih dari 2 tingkat) — stop, klarifikasi dulu sebelum lanjut.
- **Sebelum mengerjakan modul berikutnya**, kalau owner sudah minta proyek ini dikerjakan **bertahap** — laporkan dulu progres modul yang baru selesai, tunggu konfirmasi lanjut (lihat `CLAUDE.md` §6).

## 3. Kapan Sebuah Fitur/Modul Dianggap "Selesai"
Sebuah modul **hanya boleh** ditandai `Selesai` di `TODO.md` kalau:
1. Kode sudah ditulis dan berjalan tanpa error di environment testing/sandbox.
2. **Definition of Done** modul tersebut (lihat `ARCHITECTURE.md` §6) terpenuhi semua poinnya.
3. Checklist testing manual (pola dari `SKILL.md` §2) sudah dijalankan dan lolos.
4. Kalau modul menyentuh uang/keamanan → Security Review (`SKILL.md` §1) sudah dijalankan.
5. Owner sudah sempat review (kalau memungkinkan) — kalau owner belum sempat, status jadi `Butuh Review`, bukan langsung `Selesai`.
6. **Changelog di `TODO.md` sudah ditambahkan** (§0) — modul tidak boleh berubah status tanpa jejak changelog yang menjelaskan perubahannya.

## 4. Prioritas Pengerjaan (urutan default)
Ikuti urutan modul di `ARCHITECTURE.md` §6 kecuali owner minta diubah. Karena proyek ini dikerjakan **bertahap** atas permintaan owner, defaultnya: **1 modul per giliran kerja**, laporkan, tunggu konfirmasi, baru lanjut modul berikutnya — kecuali owner secara eksplisit minta beberapa modul sekaligus.

## 5. Komunikasi Progress
- Setiap kali menyelesaikan 1 modul, AI melaporkan ringkas ke owner: apa yang selesai, apa Definition of Done-nya, dan apa modul selanjutnya — **plus** memastikan baris changelog di `TODO.md` (§0) sudah ada sebelum melaporkan.
- Kalau menemukan bug/isu saat development, catat dulu di `TODO.md` bagian "Bug/Isu Ditemukan", baru lanjut kerja.
- Kalau AI ragu antara 2 pilihan implementasi yang sama-sama valid, **tanyakan preferensi owner** dengan memberi 2-3 opsi konkret beserta trade-off masing-masing.

## 6. Handling Perubahan Scope
- Kalau owner minta fitur baru di tengah jalan yang **tidak ada** di `PRD.md` (misal: minta ditambahkan kembali fitur kasir/display): catat dulu sebagai "Open Question"/catatan di `TODO.md`, konfirmasi apakah ini masuk MVP sekarang atau fase berikutnya, baru update `PRD.md` & `ARCHITECTURE.md` kalau disetujui masuk scope MVP.
- Jangan pernah diam-diam menambah scope besar tanpa mencatatnya di dokumen — supaya `PRD.md` tetap jadi sumber kebenaran yang akurat.
