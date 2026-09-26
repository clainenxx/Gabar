# PRD.md — Product Requirements Document

> Dokumen ini adalah **North Star** proyek. Semua keputusan teknis di `ARCHITECTURE.md`, `TODO.md`, dan `WORKFLOW.md` harus selaras dengan dokumen ini. Kalau ada konflik, PRD yang menang.
>
> **Proyek ini adalah salinan/adaptasi dari proyek "AyamKu"** (website fried chicken kasir dual-screen + pre-order online). Struktur dokumen, konvensi kerja AI, dan banyak keputusan arsitektur di sini sengaja meniru pola yang sudah terbukti di proyek asal — tapi **scope-nya lebih sederhana** (tanpa kasir/display) dan **tema visualnya beda total**. Lihat `ARCHITECTURE.md` §0 untuk daftar perbedaan paling penting dari proyek asal.

## 1. Nama Proyek
**GAGI** (Gabin Regiee) — Website jualan makanan berbahan gabin (online order only, tanpa kasir fisik/POS), dipakai di lingkungan **sekolah**.
> **Dikonfirmasi owner (2026-09-07): nama brand untuk sekarang "GAGI".** Dipakai untuk domain & alamat email pengirim sampai ada perubahan.
> **[DIPERLUAS 2026-09-15]** Brand di **teks notifikasi (WA & email)** sudah diganti jadi **"GABAR" (Gabin Ice Bar)** (Modul 15c), dan atas permintaan owner langsung di chat, rebrand ini **diperluas ke UI** juga: navbar publik, navbar/login admin, `<title>`, dan default/seed `site_content` (hero, Tentang, footer). Yang masih memakai nama "GAGI" hanyalah identifier internal (nama repo/proyek, CSS variable `--gagi-*`, key localStorage) dan komentar kode. Detail scope ada di `ARCHITECTURE.md` §6 Modul 15c. Nama proyek internal (repo, dokumentasi, identifier kode) tetap "GAGI" supaya riwayat dokumen ini tidak putus.

## 2. Masalah yang Diselesaikan
1. Owner jualan makanan gabin belum punya sistem online yang rapi: pelanggan mesan lewat chat manual (WhatsApp/DM), rawan salah catat, tidak ada bukti pembayaran otomatis, dan tidak ada cara pelanggan pantau status pesanannya sendiri.
2. Tidak ada sistem terpusat untuk kelola produk (varian, harga, stok) dan banner promosi — semua manual.
3. Owner butuh laporan penjualan yang bisa difilter per hari (hari ini/kemarin) atau rentang tanggal bebas, tanpa hitung manual.
4. Konteksnya **jualan di sekolah**: pelanggan (siswa/guru) tidak datang ke satu titik pengambilan tetap. Sebaliknya, **owner sendiri yang mengantar pesanan ke lokasi pelanggan** (misal ke kelas). Owner butuh cara cepat & aman untuk tahu ke mana harus mengantar tiap pesanan, dan untuk verifikasi pesanan itu benar sudah dibayar dan belum pernah diserahkan sebelumnya — **dilakukan owner sendiri lewat panel admin**, karena toko ini **tidak punya meja kasir/perangkat kasir terpisah**.

## 3. Target Pengguna
| Persona | Deskripsi | Kebutuhan Utama |
|---|---|---|
| **Customer Online** | Pesan dari HP/laptop, isi lokasi di sekolah saat checkout, tunggu diantar owner | Pilih menu, checkout, bayar, tulis lokasi pengantaran, dapat QR sebagai bukti, terima email + WhatsApp konfirmasi |
| **Owner/Admin** | Pemilik bisnis, sekaligus yang mengantar pesanan & verifikasi serah terima | Kelola produk & kategori, banner, lihat laporan penjualan, lihat lokasi tiap pesanan, scan QR saat serah terima ke pelanggan |

> **Beda dari proyek asal (AyamKu)**: tidak ada persona "Kasir" maupun "Customer Walk-in dengan layar kasir/display terpisah". Semua transaksi lewat jalur online pre-order; verifikasi serah terima dilakukan admin (owner) di lokasi pelanggan, bukan kasir di meja kasir. **Beda dari model "self pickup" yang tadinya diasumsikan**: pelanggan tidak perlu datang ke titik pengambilan — owner yang mengantar (lihat §4.2).

## 4. Fitur Inti (MVP — In Scope)

### 4.1 Website Publik & Pre-Order Online
- Landing page (`/`): banner promosi, daftar produk per kategori, tombol "Order Sekarang", nuansa visual **musim salju sore menjelang magrib** (lihat §4.4).
- Customer pilih produk & quantity → keranjang (drawer, persist di `localStorage` supaya tidak hilang saat reload). Tidak ada pilihan varian per produk — kalau ada rasa/topping berbeda, itu didaftarkan sebagai produk terpisah (dikonfirmasi owner, lihat `ARCHITECTURE.md` §0.8).
- **Tidak ada sistem voucher/kode diskon** (dikonfirmasi owner, 2026-09-07) — harga yang tampil di keranjang = harga final, tanpa input kode apapun.
- Checkout: isi form **nama, no. telepon, email**, plus **form lokasi pengantaran** (lihat detail UX di bawah), lalu pilih salah satu dari **2 metode pembayaran** (dikonfirmasi owner 2026-09-08, lihat `ARCHITECTURE.md` §0.7 — sebelumnya Midtrans Snap adalah satu-satunya jalur, keputusan itu direvisi):
  - **Bayar Online** — via **Midtrans Snap** (bukan cuma QRIS — Snap otomatis menyediakan beberapa metode sekaligus seperti transfer bank/e-wallet/QRIS sesuai yang diaktifkan owner di Midtrans Dashboard, dikonfirmasi owner 2026-09-07). Order berstatus `pending` sampai webhook Midtrans konfirmasi `paid`.
  - **Bayar Cash** — Cash On Delivery: order LANGSUNG berstatus `paid` (tidak ada Midtrans yang diproses), customer bayar tunai ke admin saat pesanan diantar & QR-nya di-scan (§4.2). **Ini bukan konsep kasir/meja kasir** (tetap di luar scope, §5) — cuma cara bayar tunai di lokasi antar yang sudah ada.
- Halaman `/order/:order_token` untuk order **Bayar Cash** menampilkan teks status **"Menunggu Di-scan"** (bukan "Sudah Dibayar" ataupun "Menunggu Pembayaran") — supaya customer paham QR-nya sudah sah dipakai tapi uangnya belum diserahkan sampai serah terima sungguhan.
- **Form Lokasi Pengantaran (dikonfirmasi owner, 2026-09-07 — proyek dipakai di lingkungan sekolah, owner sendiri yang mengantar, bukan pelanggan yang datang ambil):**
  - **Lokasi 1 (wajib)** — contoh: "Kelas A". Ini lokasi utama yang dituju owner saat mengantar.
  - **Lokasi 2 (opsional, cadangan)** — untuk jaga-jaga kalau pelanggan berencana pindah tempat setelah checkout (misal mau ke kantin/perpustakaan). Kalau owner sampai di Lokasi 1 dan pelanggan tidak ada di sana, owner cek Lokasi 2.
  - **Ketentuan UX (wajib dipenuhi, bukan sekadar ada fiturnya)**: kedua field ditampilkan berdampingan/berurutan di satu form checkout (bukan disembunyikan di step lain), label jelas ("Lokasi 1 (wajib) — di mana kamu sekarang?" / "Lokasi 2 (opsional) — kalau kamu akan pindah tempat"), placeholder contoh nyata (mis. "Kelas A", "Kantin"), dan ada teks bantuan singkat di bawah Lokasi 2 yang menjelaskan fungsinya ("Diisi kalau ada rencana pindah lokasi — supaya kami tetap bisa menemukanmu"). Field Lokasi 2 **tidak boleh terlihat wajib** (tidak ada tanda bintang, tombol submit tidak ke-block kalau kosong).
- Setelah bayar sukses → redirect ke **halaman QR Code unik** milik order tsb (dipakai sebagai bukti saat owner mengantar & scan serah terima, lihat §4.2).
- Email otomatis ke customer berisi **link permanen** ke halaman QR (jaga-jaga tab ke-close).
- Setiap pembayaran online sukses → **email notifikasi** ke alamat email admin/toko (diatur dari panel admin, bukan hardcode), berisi juga lokasi pengantaran supaya owner langsung tahu tujuan.
- **[BARU] Notifikasi WhatsApp ke customer** (diminta owner langsung) — pelengkap email di atas, BUKAN pengganti: begitu pesanan `paid` (online) atau tercatat cash, customer juga menerima pesan WhatsApp berisi ringkasan pesanan + total + link halaman QR, dikirim ke nomor yang customer isi sendiri di form checkout (`no_telp`). Dikirim dari **nomor WhatsApp ke-2 milik owner** (bukan WhatsApp Business API resmi — pakai koneksi WhatsApp Web yang di-scan QR sekali, lihat `ARCHITECTURE.md` Modul 9b). Kalau nomor tidak valid/tidak terdaftar WhatsApp atau layanan sedang bermasalah, notifikasi WA dilewati begitu saja — email konfirmasi & proses checkout/pembayaran tetap jalan normal (best-effort, tidak pernah menggagalkan transaksi).
- Kalau stok produk 0, produk tetap tampil dengan label "Stok Habis", tidak bisa ditambah ke keranjang. Perubahan stok dari admin langsung terlihat di homepage tanpa reload (realtime). Stok tiap produk juga ditampilkan sebagai info ke publik (mis. "Stok: 12") di kartu produk.
- **Keranjang tidak dibatasi ke stok** (diubah owner, 2026-09-08): customer boleh menambah qty berapa pun ke keranjang, tidak ada pembatasan qty di UI selama stok belum 0. Validasi qty vs stok tersisa baru dilakukan **saat checkout**: kalau qty di keranjang melebihi stok yang tersisa saat itu, jumlah yang bisa dipesan **otomatis dibatasi ke stok tersisa** (bukan ditolak seluruhnya) — misal stok tersisa 10 tapi di keranjang 20, maksimal yang bisa di-order tetap 10.

### 4.2 Pengantaran ke Lokasi (dalam lingkungan sekolah) + Verifikasi oleh Admin
> **Beda dari asumsi awal "self pickup"** — dikonfirmasi owner (2026-09-07): karena ini dipakai di sekolah, **tidak perlu konsep "titik pickup"** yang didatangi pelanggan. **Owner sendiri yang mengantar** pesanan ke lokasi pelanggan.
- Setelah pesanan `paid`, owner melihat daftar pesanan beserta **Lokasi 1** dan **Lokasi 2 (kalau diisi)** di panel admin (tab Pesanan), lalu mengantar pesanan ke Lokasi 1.
- Kalau pelanggan tidak ditemukan di Lokasi 1 dan Lokasi 2 sudah diisi, owner lanjut ke Lokasi 2.
- Sesampainya di lokasi, pelanggan menunjukkan halaman `/order/:order_token` (QR-nya, dari email atau tab yang masih terbuka) ke owner.
- **Admin membuka tab "Scan QR Verifikasi" di `/admin`** (pakai kamera HP/laptop admin — tidak ada perangkat kasir terpisah) → scan QR pelanggan → sistem verifikasi order valid, sudah dibayar, belum pernah diserahkan, dan belum lewat masa berlaku → tandai **"sudah diambil / completed"**.
- Begitu berhasil di-scan, halaman QR milik customer (kalau tabnya masih terbuka) otomatis update jadi "sudah diambil" tanpa perlu reload.
- Scan QR yang sudah pernah "completed" → ditolak dengan pesan jelas (anti double-redeem).

### 4.3 Panel Admin (Protected — login wajib, role tunggal: `admin`, multi-akun)
- **Auth**: login email/nama + password. Tidak ada role "kasir" — **owner mengonfirmasi butuh lebih dari 1 orang yang bisa login**, semuanya berbagi role `admin` yang sama dengan hak akses identik (tidak ada tingkatan). Admin bisa tambah/hapus akun admin lain lewat tab "Akun Admin".
- **Manajemen Produk**: tambah, edit, hapus produk — nama, harga, deskripsi (opsional), upload gambar, kategori (dari daftar kategori yang bisa admin kelola sendiri), stok. Tidak ada field varian per produk (dikonfirmasi owner) — rasa/topping berbeda = produk terpisah.
- **Manajemen Akun Admin**: tambah/hapus akun admin lain (dikonfirmasi owner, karena butuh lebih dari 1 akun yang bisa login).
- **Manajemen Kategori**: tambah/hapus kategori produk langsung dari halaman Produk (mis. Original, Topping Coklat, Topping Keju, Paket, dst — bebas sesuai kebutuhan toko gabin, bukan hardcode).
- **Manajemen Banner Header**: tambah/hapus banner promosi yang tampil di homepage.
- **Riwayat Pesanan**: daftar pesanan beserta **Lokasi 1 & Lokasi 2** tiap pesanan, supaya owner tahu ke mana harus mengantar tanpa buka chat manual.
- **Laporan Penjualan & Riwayat Transaksi**: filter **Hari ini / Kemarin / Custom range** (dari tanggal – sampai tanggal), total penjualan mengikuti filter yang sama.
- **Scan QR Verifikasi**: verifikasi pesanan yang sudah diantar & diserahkan ke pelanggan (lihat §4.2) — jadi tab/menu di dalam `/admin`, bukan halaman/perangkat terpisah.
- **Setting Notifikasi**: form input alamat email tujuan notifikasi order baru.

### 4.4 Desain / UI
- Gaya: **minimalis, imut (cute), dan bersalju** — vibe musim dingin sore menjelang magrib (langit mulai gelap, salju turun deras).
- Palet warna dominan **3 warna**: biru muda, biru tua, putih.
- Efek salju turun (animasi ringan, tidak boleh bikin lag — lihat catatan performa di `ARCHITECTURE.md` §0 yang diwariskan dari pelajaran proyek AyamKu).
- Responsive — bisa dibuka dari HP, tablet, laptop.
- **Prinsip UX wajib**: setiap fitur yang ditambahkan harus jelas cara pakainya buat user tanpa penjelasan tambahan — label eksplisit, contoh/placeholder nyata, dan teks bantuan singkat kalau ada bagian yang berpotensi membingungkan (contoh diterapkan di form Lokasi Pengantaran, §4.1). Jangan ada fitur yang "ada" tapi user tidak tahu cara memakainya.

## 5. Di Luar Scope (Out of Scope) untuk MVP
- **Sistem Kasir/Point-of-Sale & Customer Display** — proyek asal (AyamKu) punya ini, GAGI **sengaja tidak punya**. Semua transaksi tetap lewat jalur pre-order online (§4.1) — **"Bayar Cash" (ditambahkan 2026-09-08) bukan pengecualian dari ini**: itu cuma metode pembayaran (dibayar tunai saat serah terima), bukan meja kasir/perangkat kasir terpisah, tidak mengubah flow pre-order sama sekali.
- **Sistem voucher/kode diskon** — dikonfirmasi owner (2026-09-07), tidak masuk MVP.
- Pengantaran di luar lingkungan sekolah (delivery ke rumah/alamat umum, integrasi ojek online) — MVP hanya untuk mengantar ke lokasi di dalam sekolah.
- Aplikasi mobile native (Android/iOS) — semua berbasis web responsif.
- Sistem loyalty/poin member.
- Manajemen stok bahan baku (hanya stok per produk jadi, sama seperti model di AyamKu Modul 17).
- Multi-bahasa (default Bahasa Indonesia).
- Cetak struk fisik — MVP hanya digital (email + halaman QR).
- Refund/pembatalan otomatis via sistem (manual oleh admin kalau perlu).
- Role staff/kasir terpisah dari admin.

## 6. Metrik Sukses (indikatif)
- Owner bisa terima & verifikasi pesanan tanpa hitung manual dari chat.
- Owner tahu lokasi tujuan tiap pesanan tanpa perlu chat manual ke pelanggan.
- Tidak ada downtime saat proses pembayaran via Midtrans Snap (webhook reliability).
- 0 insiden order online yang "double redeem" QR saat serah terima.
- Laporan penjualan bisa diakses admin tanpa export manual.

## 7. Constraint Teknis (dari pemilik project)
- Frontend: React + Vite.
- Backend/DB: Supabase (data teks/relasional, bukan untuk file media).
- Storage media (gambar produk/banner): Cloudflare R2.
- Email transaksional: Gmail + SMTP (App Password).
- Payment Gateway: Midtrans (Snap).
- Keamanan harus jadi perhatian utama di setiap tahap (lihat `ARCHITECTURE.md` §5).
- **Dikerjakan bertahap, modul per modul** (lihat `WORKFLOW.md` §4 untuk urutan) — jangan loncat mengerjakan banyak modul sekaligus tanpa laporan progres.
