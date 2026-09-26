# ARCHITECTURE.md — Rencana Implementasi Teknis

> Rujukan wajib sebelum menulis kode. Dipecah jadi modul-modul kecil yang bisa dikerjakan satu-satu, masing-masing punya *Definition of Done* (kriteria selesai) yang jelas. Update `TODO.md` setiap modul berubah status.

## 0. Asumsi Arsitektur Penting (WAJIB dikonfirmasi owner sebelum mulai coding)

Proyek ini adalah adaptasi dari proyek "AyamKu" (lihat `documentations/` proyek asal yang sudah dibaca AI sebelum menulis dokumen ini). Beberapa keputusan di bawah **sengaja mewarisi** pola yang sudah terbukti di sana, sebagian **sengaja disederhanakan** karena GAGI tidak punya kasir/display. **Koreksi di sini kalau ada yang salah asumsi:**

1. **Tidak ada sistem kasir/POS & Customer Display.** Ini beda paling besar dari proyek asal. Konsekuensi teknis: tidak perlu channel realtime Broadcast `store-main-channel` untuk sinkron cart kasir↔display sama sekali — realtime yang dipakai GAGI hanya untuk (a) stok produk live di homepage publik, dan (b) opsional live-update badge order baru di dashboard admin. Kedua-duanya pakai **Supabase Realtime Postgres Changes**, bukan Broadcast.
2. **Role tunggal: `admin`, tapi multi-akun (dikonfirmasi owner).** Tidak ada role `kasir`. Tabel `profiles` tetap punya kolom `role` (untuk konsistensi & antisipasi masa depan), nilainya selalu `admin` untuk MVP. **Owner mengonfirmasi butuh lebih dari 1 akun admin** yang bisa login bersamaan (mis. owner + karyawan yang bantu kelola) — jadi tab "Akun Admin" (CRUD akun) **masuk scope MVP** (§2, §6 Modul 1b), mengikuti pola `manage-staff` Edge Function di AyamKu (pakai `admin.createUser()` service role, bukan self sign-up). Semua akun admin punya hak akses yang sama persis — **tidak ada pemisahan hak akses/tingkatan** di dalam panel admin untuk MVP ini (beda dari AyamKu yang punya admin vs kasir dengan hak berbeda).
3. **Tidak ada "titik pickup" fisik — model diganti "antar ke lokasi" (dikonfirmasi owner, 2026-09-07).** Proyek ini dipakai di lingkungan **sekolah**: pelanggan tidak datang ke satu titik pengambilan tetap, melainkan **owner (admin) sendiri yang mengantar** pesanan ke lokasi pelanggan (mis. ruang kelas). Konsekuensinya:
   - Order butuh dua kolom lokasi teks bebas: `lokasi_1` (wajib, tujuan utama) dan `lokasi_2` (opsional, cadangan kalau pelanggan berencana pindah tempat) — lihat §3.
   - Panel admin (tab Pesanan) menampilkan `lokasi_1`/`lokasi_2` tiap order supaya owner tahu ke mana harus mengantar.
   - **Verifikasi serah terima tetap lewat scan QR** (bukan dihapus) — hanya *tempat* terjadinya yang berubah: dulu diasumsikan pelanggan datang ke admin di titik pickup, sekarang admin yang datang ke lokasi pelanggan lalu scan QR pelanggan saat serah terima. Mekanisme teknisnya (RPC `verify_order_pickup`, anti double-scan, masa berlaku) **tidak berubah** dari §0.9 — cuma konteks fisiknya beda.
   - Open Question lama "berapa titik pickup untuk MVP" **tidak relevan lagi** dan dihapus — tidak ada titik pickup sama sekali.
4. **Tidak ada sistem voucher (dikonfirmasi owner, 2026-09-07).** Beda dari AyamKu yang punya voucher diskon — untuk GAGI, harga di keranjang = harga final, tidak ada input kode diskon. Konsekuensi: tabel `vouchers`, kolom `voucher_id`/`diskon` di `orders`, RPC `validate_voucher`, dan Edge Function `validate-voucher` **tidak ada** di GAGI (beda dari AyamKu, lihat §3 & §6).
5. **Email service**: sama seperti AyamKu — **Gmail SMTP + App Password** (via `denomailer`), bukan provider lain, karena owner (asumsi) belum punya domain sendiri. Kalau ternyata sudah punya domain & mau pakai Resend/provider lain, tinggal ganti isi `_shared/email.ts` tanpa ubah kode pemanggil.
6. **QR Code isi**: URL unik `https://domain.com/order/{order_token}` — `order_token` UUID v4 random (bukan sekuensial), sama seperti pola AyamKu §0.3.
7. **Midtrans integration**: pakai **Midtrans Snap** (popup Snap.js) untuk checkout online. **Dikonfirmasi owner (2026-09-07): tidak dibatasi ke QRIS saja** — Snap otomatis menyediakan beberapa metode pembayaran sekaligus (QRIS, transfer bank, e-wallet, dll), tinggal diaktifkan/nonaktifkan owner dari Midtrans Dashboard, tidak perlu logic khusus per metode di kode. Status pembayaran online **tidak pernah dipercaya dari client**, selalu diverifikasi server-side via signature key Midtrans di webhook.
   - **REVISI (dikonfirmasi owner, 2026-09-08 — lihat migration `0008_cash_payment.sql`)**: baris di atas TADINYA berbunyi "Midtrans Snap satu-satunya jalur pembayaran, tidak ada jalur cash seperti kasir AyamKu, karena semua transaksi online" — keputusan itu DIREVISI. Sekarang ada 2 `payment_method` di `orders`: `'online'` (perilaku Snap di atas, tidak berubah) dan `'cash'` (COD — order LANGSUNG `paid` tanpa Midtrans, dibayar tunai ke admin bersamaan dengan scan QR `verify_order_pickup` saat serah terima, §0.3/§0.10 tidak berubah sama sekali). **Ini TETAP BUKAN kasir/POS** (§5 PRD.md) — tidak ada meja/perangkat kasir terpisah, cash cuma cara bayar di titik antar yang sudah ada. Konsekuensi teknis lengkap ada di komentar migration `0008` dan `supabase/functions/public-checkout/index.ts`.
8. **Skema order disederhanakan** dari AyamKu: tidak ada kolom `tipe` (`walkin`/`online`) karena semua order online, tidak ada `kasir_id`. Status akhir serah terima memakai `orders.status = 'completed'` langsung (tidak perlu kolom boolean `sudah_diambil` terpisah seperti AyamKu, karena tidak ada kondisi "paid tapi belum tentu diambil vs sedang diproses kasir" yang butuh dua flag independen — `status` transisi `pending → paid → completed` / `cancelled` sudah cukup jadi satu sumber kebenaran).
9. **Produk tanpa varian (dikonfirmasi owner).** Beda dari AyamKu yang punya field `flavors`/rasa per produk (Pedas/Original) — untuk GAGI, **tiap produk berdiri sendiri** tanpa sub-varian rasa/topping. Kalau owner mau jual "Gabin Coklat" dan "Gabin Keju" sebagai pilihan berbeda, keduanya didaftarkan sebagai **produk terpisah** (bukan 1 produk dengan dropdown varian), cukup dibedakan lewat `categories`/nama produk. Konsekuensi: kolom `varian`/`flavors` **tidak ada** di tabel `products` maupun `order_items` (lihat §3) — skema & UI jadi lebih sederhana dari AyamKu.
10. **Batas waktu verifikasi QR: 1x seminggu (dikonfirmasi owner, BEDA dari AyamKu).** AyamKu memakai 1x24 jam (produk fried chicken yang harus segera diambil), tapi **owner GAGI mengonfirmasi masa berlaku QR adalah 1x seminggu (7×24 jam) sejak `created_at`** — cocok untuk produk gabin yang lebih awet. Scan yang lewat waktu ini ditolak walau order masih `paid` & belum pernah di-scan. Dihitung dari kolom `created_at` yang sudah ada, tidak perlu kolom baru (pola sama seperti AyamKu, cuma angkanya beda: `7 hari` bukan `1 hari`).
11. **Warna & tema visual**: 3 warna dominan **biru muda / biru tua / putih**, gaya **minimalis + imut (cute) + bersalju**, vibe "musim dingin, sore menjelang magrib" (langit meredup + salju turun deras). Desain token lengkap didefinisikan saat mulai coding UI (Modul versi GAGI, §6), tapi arah utamanya:
    - Background: gradient vertikal dari biru muda/putih (atas) ke biru tua yang lebih gelap (bawah), meniru langit sore.
    - Efek salju: partikel jatuh pelan (CSS animation atau canvas ringan), jumlah partikel dibatasi, **wajib pause saat tab tidak aktif** (`document.visibilitychange`) dan hormati `prefers-reduced-motion`.
    - **Pelajaran performa yang diwariskan dari AyamKu** (jangan diulangi): jangan pakai `background-attachment: fixed`; batasi `backdrop-filter`/blur cuma untuk elemen yang sedikit jumlahnya di layar (navbar, cart drawer), bukan tiap kartu produk; pakai `IntersectionObserver` untuk reveal-on-scroll, bukan listener `scroll` polos.
    - **UX wajib jelas dipakai** (§4.4 `PRD.md`): setiap field/form baru (contoh: Lokasi 1 & Lokasi 2 di checkout, §0.3) harus punya label eksplisit, placeholder contoh nyata, dan teks bantuan singkat kalau berpotensi bikin bingung — jangan sampai ada fitur yang secara teknis jalan tapi user tidak tahu cara/kapan memakainya.
12. **Rate limiting** endpoint publik (`public-checkout`) — ikut pola AyamKu Modul 22: lewat Edge Function + tabel `rate_limits` generik, bukan RPC yang dipanggil langsung dari browser.
13. **Hosting**: diasumsikan sama seperti AyamKu — Netlify untuk frontend + Supabase Cloud untuk backend. **Perlu dikonfirmasi owner** kalau ternyata mau pakai platform lain.

---

## 1. Tech Stack

| Layer | Teknologi | Catatan |
|---|---|---|
| Frontend | React + Vite | Deploy Netlify (asumsi §0.13, konfirmasi owner) |
| Styling | Tailwind CSS + custom snow/winter utility | Minimalis, ringan, hindari efek berat (§0.11) |
| Backend/DB | Supabase (Postgres) | Hanya data teks/relasional |
| Auth | Supabase Auth (email/password) | Role tunggal `admin` |
| Realtime sync | Supabase Realtime (Postgres Changes) | Stok produk live di publik; status order live di `/order/:order_token` lewat tabel bayangan tanpa-PII `order_status_public` (Modul 7c, karena `orders` sendiri sengaja tidak boleh diakses anon — berisi PII); opsional badge order baru di admin — **bukan** Broadcast (tidak ada kasir/display untuk disinkronkan) |
| Serverless functions | Supabase Edge Functions (Deno) | Midtrans webhook, checkout, resume payment (Modul 7b), kirim email, presigned URL R2. **`midtrans-webhook` sengaja di-deploy dengan `verify_jwt = false`** (Bug/Isu #6, `TODO.md`) — Midtrans memanggilnya langsung dari server mereka tanpa header Supabase Auth, jadi wajib dimatikan JWT check di gateway; keamanan tetap terjaga karena payload diverifikasi lewat `signature_key` Midtrans sendiri di dalam kode. Function lain (`public-checkout`/`get-order`/`resume-payment`) TETAP `verify_jwt = true` (default) karena dipanggil `supabase-js` dari browser yang otomatis mengirim anon key. |
| File/Image storage | Cloudflare R2 (S3-compatible API) | Upload via presigned URL dari Edge Function. **URL publik disajikan lewat Cloudflare Worker proxy** (owner buat sendiri, binding ke bucket `gagi`), **bukan** domain dev `pub-xxxx.r2.dev` bawaan R2 — domain itu ternyata butuh VPN dari lokasi owner (Bug/Isu #4 di `TODO.md`). `R2_PUBLIC_URL_BASE` (Supabase secret) diarahkan ke domain Worker ini. |
| Payment Gateway | Midtrans (Snap — QRIS, transfer bank, e-wallet, dll, §0.7) | Webhook notification handler |
| Email transaksional | Gmail SMTP + App Password (via `denomailer`) | Link QR ke customer & notifikasi order baru (+lokasi antar) ke admin |
| Notifikasi WhatsApp | **[BARU 2026-09-15, dikonfirmasi owner]** Service Node.js terpisah (`whatsapp-service/`, hosting sendiri milik owner) pakai [Baileys](https://github.com/WhiskeySockets/Baileys) — nomor WA **ke-2** login via scan QR code (bukan WhatsApp Business API resmi). Dipanggil dari `midtrans-webhook` (order online `paid`) & `public-checkout` (order cash) lewat HTTP `POST /send`, diautentikasi header `x-api-key` (secret `WHATSAPP_SERVICE_API_KEY`, URL service di secret `WHATSAPP_SERVICE_URL`). Kirim ke **nomor customer** (`orders.no_telp`, diisi sendiri saat checkout) — **[DIUBAH 2026-09-20]** isi pesan ke customer sekarang berupa **GAMBAR kartu pesanan** (nama, ringkasan item, total, kode pendek, dan **QR code** yang kalau di-scan membuka `/order/:order_token`) — TANPA link mentah di pesan. **[DIUBAH 2026-09-21]** gambar diberi *caption* (teks di bawah gambar, tanpa link): order online berisi sapaan "Halo {nama}", konfirmasi pembayaran, dan penjelasan bahwa QR di gambar dipakai untuk membuka halaman pesanan di website, dan yang ditunjukkan ke admin saat pesanan diantar adalah QR yang tampil di halaman website itu (bukan QR di gambar); order cash berisi instruksi bayar tunai. Gambar dibuat `whatsapp-service/order-card.js` pakai **Satori + resvg-js** (font Poppins, tanpa browser headless); Edge Function cuma kirim data pesanan (nama, item, total, token, URL) dan kalau pembuatan gambar gagal, service mengirim teks cadangan TANPA link. Pesan ke admin teks saja **tanpa link** (diubah 2026-09-20; detail & QR verifikasi admin ada di email dan tab Scan QR). **Pelengkap email, bukan pengganti** — email tetap dikirim seperti biasa, kegagalan salah satu tidak menghalangi yang lain (best-effort, lihat `_shared/whatsapp.ts`). |
| QR Code generation | Library `qrcode` (client-side) | Generate dari `order_token` |
| QR Code scanning | Library `qr-scanner` (dipakai di tab Scan QR Verifikasi `/admin`) | Sama seperti pola AyamKu Modul 12 |
| Hosting | Netlify (frontend) + Supabase Cloud (backend) | Cloudflare R2 untuk asset |

---

## 2. Struktur Halaman (Routes)

### Public (tidak butuh login)
- `/` — Landing page: banner header (promo), daftar produk per kategori (+ filter kategori), keranjang (drawer), efek salju/tema musim dingin.
- `/checkout` — Form **nama, no. telp, email, Lokasi 1 (wajib), Lokasi 2 (opsional, cadangan)**, pilihan **Metode Pembayaran (Online/Cash, ditambahkan 2026-09-08 — `PaymentMethodInput.jsx`)** + ringkasan total + tombol bayar (Online: buka Midtrans Snap popup; Cash: langsung submit, tanpa popup). Lihat ketentuan UX di `PRD.md` §4.1.
- `/order/:order_token` — Halaman QR code unik per order (dikirim ke email & jadi redirect setelah bayar sukses), dipakai sebagai bukti saat admin mengantar & scan serah terima. Auto-update tanpa reload kalau statusnya berubah (`pending` → `paid` → `completed`) lewat Realtime — **Modul 7c**: dengar tabel bayangan `order_status_public`, BUKAN tabel `orders` langsung (`orders` tidak pernah didaftarkan ke publication realtime & sengaja tidak punya RLS select anon karena berisi PII, jadi subscribe langsung ke situ tidak akan pernah menerima event — lihat catatan Modul 7c di §6). **Modul 7b (ditambahkan 2026-09-08, dikonfirmasi owner)**: QR code HANYA ditampilkan waktu `status === "paid"` — waktu `pending`, halaman menampilkan tombol **"Lanjutkan Pembayaran"** yang minta Snap token baru untuk transaksi Midtrans yang sama (Edge Function `resume-payment`, memanfaatkan sifat idempotent Midtrans selama transaksi masih `pending`) dan membuka ulang popup Snap; waktu `completed`, QR diganti pesan sukses "QR berhasil di-scan" (otomatis, konsekuensi dari Realtime yang sudah ada, bukan channel baru).

> Tidak ada route `/menu`/`/cart` terpisah — mengikuti pola AyamKu, digabung ke `/` (drawer) supaya lebih ringkas. Bisa dipecah kalau nanti diminta owner.

### Admin Panel (butuh login, role `admin`)
- `/admin/login` — Login admin. Belum login & coba akses `/admin` → redirect ke sini (`RequireRole`).
- `/admin` — Satu halaman dengan sidebar tab (pola sama seperti AyamKu, supaya semua menu di 1 URL):
  - **Dashboard** — ringkasan laporan penjualan (filter tanggal: Hari Ini/Kemarin/Custom Range).
  - **Produk** — CRUD produk + kelola kategori + stok.
  - **Banner** — CRUD banner header.
  - **Pesanan** — riwayat semua transaksi online, filter tanggal, **Lokasi 1 & Lokasi 2 tampil langsung di baris tabel** supaya owner tahu tujuan antar tanpa klik apa pun. **[DIUBAH 2026-09-21]** Klik baris membuka **popup detail** (bukan lagi expand ke bawah): nama, no. telp, email, kode antar (8 karakter pertama `order_token`, huruf besar — sama dengan "Kode" di kartu WhatsApp dan "No. Pesanan" di `/order/:token`), Lokasi 1 & 2, link halaman order pelanggan, daftar item, total, status & metode. Ditutup lewat ✕, klik di luar kotak, atau Esc. **Search bar** (disaring di sisi klien dari daftar rentang tanggal yang aktif) mencocokkan nama, no. telp (format `08…`/`+62…`/`62…` disamakan), email, kode antar (boleh diawali `#`), lokasi, link order (link dari domain mana pun dikenali lewat tokennya), nama produk, metode & status; yang tidak cocok disembunyikan sehingga hasil cocok langsung tampil di paling atas. Logika pencarian di `src/lib/orderSearch.js`.
  - **Scan QR Verifikasi** — modal/panel kamera untuk verifikasi serah terima ke pelanggan setelah diantar (§0.3).
  - **Broadcast WA Belum Scan** — **[BARU 2026-09-24, diminta owner]** kirim WA custom (beberapa field pesan berurutan, bisa dicustom admin) ke semua customer yang sudah bayar (`status='paid'`, cash/online) tapi QR-nya belum discan, memberitahu pesanan akan segera diantarkan. Diurutkan pembeli paling awal dulu. Wajib password konfirmasi sebelum kirim massal. Lihat Modul 16 di §6.
  - **Pengaturan** — atur email tujuan notifikasi order baru.
  - **Akun Admin** — tambah/hapus akun admin lain (dikonfirmasi owner, §0.2 & Modul 1b — semua akun admin hak aksesnya sama).

> Catatan role: karena role tunggal `admin` (§0.2), tidak ada logic `RequireRole role="kasir"` seperti AyamKu — cukup 1 guard `RequireRole role="admin"` untuk seluruh `/admin/*`.

---

## 3. Skema Database (Supabase Postgres) — ringkasan tabel

> Diimplementasikan bertahap di `supabase/migrations/`. Ringkasan ini WAJIB dijaga sinkron dengan migration — kalau ada perubahan skema, update dua-duanya sekaligus (AGENTS.md §6).

- `profiles` — id, full_name, email, role (`admin` saja untuk MVP, kolom tetap ada untuk antisipasi masa depan), created_at. Terhubung ke `auth.users`.
- `categories` — id, nama (unique), urutan (int, urutan tampil di filter menu & homepage), created_at.
- `products` — id, nama, deskripsi (nullable), harga, `category_id` (FK ke `categories`, `on delete restrict`), gambar_url (link R2), aktif (bool), `stock` (int, default 0, `>= 0`), created_at, updated_at. **Tidak ada kolom varian/flavors** (§0.9, dikonfirmasi owner) — produk beda rasa/topping didaftarkan sebagai produk terpisah.
- `orders` — id, order_token (UUID unik, dipakai di `/order/:order_token`), status (`pending`,`paid`,`completed`,`cancelled`), **`payment_method` (text, `'online'`/`'cash'`, default `'online'` — ditambahkan migration `0008`, §0.7 REVISI 2026-09-08)**, nama_customer, no_telp, email, **`lokasi_1` (text, wajib — tujuan utama antar, §0.3), `lokasi_2` (text, nullable — lokasi cadangan)**, subtotal, total, created_at, updated_at. **Beda dari AyamKu**: tidak ada `tipe`, `kasir_id`, `sudah_diambil` (§0.8). **Tidak ada `voucher_id`/`diskon`** — GAGI tidak punya sistem voucher (§0.4); `total` = `subtotal`. Order `payment_method='cash'` dibuat LANGSUNG dengan `status='paid'` (tidak pernah `pending`) — lihat migration `0008` untuk alasan lengkap kenapa tidak ditambah nilai status baru.
- `order_status_public` — **(Modul 7c, ditambahkan 2026-09-08; kolom `order_token` DIHAPUS 2026-09-18, lihat Bug/Isu keamanan)** tabel bayangan tanpa PII: order_id (PK, FK ke `orders.id`), status, updated_at. Disinkron OTOMATIS lewat trigger tiap `orders.status` berubah (`sync_order_status_public()`). Satu-satunya alasan tabel ini ada: `orders` sengaja tidak boleh diakses `anon` (berisi nama/no telp/lokasi customer), tapi halaman publik `/order/:order_token` tetap butuh dengar perubahan status lewat Realtime — jadi dipisah ke tabel sempit ini yang aman dibuka `select using (true)` karena tidak ada data sensitif sama sekali di dalamnya. **PENTING**: kolom ini TIDAK BOLEH pernah berisi `order_token` lagi walau kelihatannya "aman" — tabel ini terbuka untuk SIAPA SAJA, jadi menaruh `order_token` di sini SAMA SAJA membocorkannya ke publik, meniadakan proteksi "UUID tidak bisa ditebak" yang jadi satu-satunya penjaga endpoint `get-order` (§5.5).
- `order_items` — id, order_id, product_id (nullable, `on delete set null`), nama_produk (snapshot), qty, harga_satuan, subtotal. **Tidak ada kolom varian** (§0.9).
- `banners` — id, gambar_url, judul (opsional), link (opsional), urutan, aktif (bool), created_at.
- `payment_transactions` — id, order_id, midtrans_transaction_id, status Midtrans mentah, raw_payload (jsonb, audit), created_at, updated_at. Hanya ditulis webhook (service role); admin hanya bisa SELECT.
- `settings` — key (text, PK), value, updated_at — key-value sederhana, misal `notification_email`. **Admin-only** (RLS `settings_all_admin`, tidak bisa dibaca `anon`) — dipakai untuk data yang memang tidak boleh publik.
- `rate_limits` — key (text, PK), attempt_count, window_started_at — dipakai `check_rate_limit()` RPC (service-role only), mengikuti pola AyamKu Modul 22.
- `site_content` — **(penyempurnaan pasca-Modul 5/12, ditambahkan 2026-09-08)** single-row (`id smallint primary key default 1 check (id=1)`), `content` (jsonb), `updated_at`. Menyimpan teks-teks landing page publik yang bisa diedit admin (hero, header section Produk, section "Tentang GAGI", footer) — dipisah dari tabel `settings` di atas karena `site_content` MEMANG harus bisa dibaca publik (RLS `select using (true)`, sama filosofi dengan `categories`/`products_select_active`), sedangkan `settings` sengaja admin-only. Insert/update tetap admin-only (RLS `site_content_insert_admin`/`site_content_update_admin`).
- `wa_outbox` — **(Modul 15e, ditambahkan 2026-09-17)** antrian retry notifikasi WhatsApp yang gagal terkirim (`whatsapp-service` down/unreachable): `order_id` (nullable, FK `orders.id` `on delete set null`), `phone`, `message`, `payload` (jsonb nullable, **migration `0013`** — `{"card": {...}}` untuk pesan bergambar supaya retry tetap kirim gambar; `message` jadi teks cadangan tanpa link), `status` (`pending`/`sent`/`failed`), `attempts`, `last_error`, `created_at`, `sent_at`. RLS enabled TANPA policy sama sekali (default-deny total, sama filosofi `payment_transactions`) — cuma `service_role` yang boleh insert (dari `_shared/whatsapp.ts`, Edge Function) atau select/update (dari `whatsapp-service/server.js`, `flushPendingOutbox()`). Diproses ulang EVENT-DRIVEN (saat koneksi WA reconnect), bukan cron/polling berkala — lihat §6 Modul 15e.

Semua tabel RLS enabled, default-deny lalu whitelist per role sesuai §5.

---

## 4. Alur Sistem (Flow)

### 4.1 Flow Customer Online Pre-Order (satu-satunya jalur transaksi)
1. Customer buka `/` → lihat banner promo & produk per kategori → pilih produk + qty → masuk keranjang (drawer, `localStorage`).
2. Checkout → isi form (nama, no telp, email, **Lokasi 1 wajib, Lokasi 2 opsional** — §0.3, §2) → klik bayar → Midtrans Snap popup muncul.
3. Bayar sukses (dikonfirmasi via webhook, bukan cuma redirect) → order status `paid`, `order_token` dibuat → customer diarahkan ke `/order/:order_token`.
4. Edge Function trigger dari webhook: kirim email ke customer (link `/order/:order_token`) + email notifikasi ke `settings.notification_email` (berisi juga Lokasi 1/Lokasi 2 supaya admin langsung tahu tujuan).
5. Admin melihat pesanan baru + lokasinya di tab **Pesanan** `/admin`, lalu mengantar pesanan ke **Lokasi 1**. Kalau pelanggan tidak ada di sana dan **Lokasi 2** terisi, admin lanjut ke Lokasi 2.
6. Sesampainya di lokasi pelanggan, pelanggan menunjukkan halaman `/order/:order_token` (QR-nya). Admin buka tab **Scan QR Verifikasi** di `/admin`, scan QR pelanggan. Sistem cek: order valid? status `paid`? belum `completed`? belum lewat 1x seminggu sejak `created_at` (§0.10)? → kalau semua valid, tandai `completed`. Halaman `/order/:order_token` milik customer (kalau tab masih terbuka) otomatis update ke "sudah diambil" lewat Realtime Postgres Changes pada tabel bayangan **`order_status_public`** (filter `order_id`, Modul 7c — bukan tabel `orders` langsung, yang sengaja tidak pernah diekspos ke anon karena berisi PII customer) — **tanpa** channel Broadcast khusus seperti AyamKu, cukup dengar perubahan baris status order itu sendiri.
   - Sudah pernah di-scan → warning "sudah diambil sebelumnya" (anti double-redeem).
   - Lewat 1x seminggu → warning "QR sudah kadaluarsa", ditolak meski masih `paid`.

### 4.2 Flow Admin
- CRUD produk/kategori/banner langsung ke Supabase via RLS (role `admin` saja).
- Upload gambar: frontend minta **presigned URL** dari Edge Function → upload langsung ke R2 → simpan hanya **URL publik R2** ke kolom `gambar_url`.
- Laporan penjualan: query `orders` dengan filter tanggal (hari ini/kemarin/custom range), agregasi total (hanya status `paid`/`completed`, sama seperti pola AyamKu Modul 13 — `pending`/`cancelled` dikecualikan).
- Riwayat Pesanan: menampilkan `lokasi_1`/`lokasi_2` per baris supaya admin tahu ke mana harus mengantar tanpa buka chat manual.
- Scan QR Verifikasi: lewat RPC SECURITY DEFINER (§6 Modul), **bukan** UPDATE langsung dari client — pelajaran keamanan yang diwariskan dari AyamKu Modul 18 (RLS row-level saja tidak cukup, harus dikunci lewat RPC/Edge Function supaya kolom `status`/`total` tidak bisa diubah bebas dari console browser).

---

## 5. Keamanan (Security) — checklist wajib

1. **RLS aktif di semua tabel** — default deny, whitelist per role.
   - Public (anon): `SELECT` produk aktif, `SELECT` kategori, `SELECT` banner aktif, `SELECT` `site_content` (teks halaman publik, aman dibuka karena tidak ada data sensitif — sama filosofi dengan kategori/produk aktif). **Tidak ada** akses langsung `INSERT`/`UPDATE` ke `orders` dari anon — semua lewat Edge Function `public-checkout` (service role). **`orders` juga tidak punya policy SELECT untuk anon sama sekali** (berisi PII: nama/no telp/email/lokasi) — halaman publik `/order/:order_token` baca datanya lewat Edge Function `get-order` (service role), BUKAN query langsung. Pengecualian sempit: `order_status_public` (Modul 7c) **BOLEH** `SELECT` bebas oleh anon (`using (true)`) — aman karena isinya cuma order_id/order_token/status/updated_at, tidak ada PII apapun, dipakai khusus supaya Realtime auto-update halaman QR customer bisa jalan tanpa membuka akses ke tabel `orders` yang sesungguhnya.
   - Admin: full akses `products`, `categories`, `banners`, `profiles`, `settings`, `site_content`; `SELECT` penuh ke `orders`/`order_items`/`payment_transactions`; **tidak ada** policy `UPDATE` langsung ke `orders` (mutasi status lewat RPC, lihat poin 2 & §6).
2. **Payment tidak pernah dipercaya dari client.** Status `paid` hanya diubah dari Edge Function `midtrans-webhook` setelah verifikasi signature key Midtrans.
3. **Mutasi status order lewat RPC SECURITY DEFINER**, bukan `UPDATE` langsung dari client — sejak awal (bukan hasil temuan security review belakangan seperti di AyamKu). RPC `verify_order_pickup(order_token)` untuk scan QR serah terima, dengan guard atomic (`status='paid' AND status != 'completed'`) mencegah race condition double-scan.
4. **Input `lokasi_1`/`lokasi_2` disanitasi** sama seperti field form publik lain (nama, no telp, email) — validasi panjang & format, cegah XSS di render ulang data customer di panel admin.
5. **`order_token` = UUID v4 random**, bukan auto-increment.
6. **Rate limiting** untuk `public-checkout` (Edge Function + tabel `rate_limits`, §0.12).
7. **R2 upload via presigned URL** — kredensial R2 hanya di Edge Function.
8. **Auth admin**: Supabase Auth standar, logout jelas ada. **Matikan "Allow new users to sign up"** di Supabase Auth sejak awal (bukan ditemukan belakangan seperti AyamKu Modul 18 temuan #8) — dicatat sebagai langkah wajib di Modul 0.
9. **Environment variables**: anon key boleh publik (didesain publik + RLS); **service role key**, **Midtrans server key**, **R2 secret key** HANYA di Edge Function, tidak pernah di kode `/src` (frontend).
10. **HTTPS** dipaksa di semua endpoint (Netlify & Supabase default HTTPS).
11. **QR scan verification**: cek status order + masa berlaku 1x seminggu sebelum accept scan (§0.10).
12. **CORS**: `Access-Control-Allow-Origin` di semua Edge Function baca dari env var `ALLOWED_ORIGIN` (fallback `*` kalau belum diset) — sejak awal, bukan temuan belakangan seperti AyamKu.
13. **Anti-penyalahgunaan checkout publik (2026-09-19)** — `public-checkout` (a) wajib token **Cloudflare Turnstile** yang diverifikasi server-side, fail-closed, token sekali pakai (secret `TURNSTILE_SECRET_KEY`, site key `VITE_TURNSTILE_SITE_KEY` di frontend); (b) nama & Lokasi 1/2 dibatasi karakter dan ditolak kalau menyerupai link (`_shared/checkout-guards.ts`, aturan HARUS sama dengan `src/lib/textRules.js`) karena teks ini ikut terkirim ke WhatsApp/email; (c) rate limit per NOMOR telepon dan per EMAIL (maks 3 per jam, kunci di-hash) plus batas global order cash per jam (`CASH_GLOBAL_LIMIT_PER_HOUR`, default 100), lewat RPC `check_rate_limit` yang sama dengan §0.12. Detail & langkah deploy ada di `TODO.md` (changelog 2026-09-19).

---

## 6. Pemecahan Modul (Breakdown Kerja + Definition of Done)

> Urutan disarankan sesuai dependency, disederhanakan dari AyamKu karena tidak ada modul kasir/display/realtime-broadcast/voucher. Update status di `TODO.md`, bukan di sini.

### Modul 0 — Setup Project
- Init repo, Vite + React + Tailwind, struktur folder, Supabase project, R2 bucket, Midtrans sandbox, akun Gmail (App Password). Matikan "Allow new users to sign up" di Supabase Auth (§5.8).
- **DoD**: semua service bisa "Hello World" konek (query test Supabase, upload test file R2, transaksi test Midtrans sandbox, 1 email test Gmail SMTP).

### Modul 1 — Auth Admin
- Supabase Auth + tabel `profiles` (role `admin` saja) + route guard `RequireRole` di frontend. Bootstrap admin pertama manual (dokumentasi di `README.md`, pola sama seperti AyamKu).
- **DoD**: bisa login sebagai admin, akses `/admin`; belum login → redirect ke `/admin/login`.

### Modul 1b — Manajemen Akun Admin (dikonfirmasi owner, multi-akun)
- Tab "Akun Admin" di `/admin`: admin yang login bisa tambah/hapus akun admin lain. Edge Function `manage-admin` (service role, pola sama `manage-staff` AyamKu — pakai `supabase.auth.admin.createUser()`, bukan self sign-up publik).
- **DoD**: admin bisa tambah akun admin baru (email+password) dari tab ini, akun baru langsung bisa login ke `/admin` dengan hak akses sama persis (§0.2 — tidak ada tingkatan admin).

### Modul 2 — Skema Database & RLS
- Buat semua tabel di §3 + RLS policy sesuai §5.
- **DoD**: query dari anon key hanya bisa akses yang diizinkan (tes manual: coba `UPDATE orders` sebagai admin dari console browser → harus gagal, hanya RPC yang boleh).

### Modul 3 — Manajemen Produk, Kategori & Upload Gambar (R2)
- CRUD produk & kategori di tab "Produk" pada `/admin`, upload gambar via presigned URL ke R2 (Edge Function `product-image-upload`, folder-aware `products`/`banners` supaya reusable di Modul 4).
- **DoD**: admin bisa tambah produk baru + kategori baru, gambar tampil di `/` dalam <2 detik load.

### Modul 4 — Manajemen Banner
- CRUD banner di tab "Banner", reuse Edge Function `product-image-upload` (folder `banners`), carousel auto-rotate di header `/`.
- **DoD**: admin tambah/hapus banner, urutan sesuai, banner nonaktif tidak muncul di publik.

**Penyempurnaan Modul 4 — Banner bisa digeser (ditambahkan 2026-09-08, diminta owner):**
- `BannerCarousel.jsx` ditambah drag/swipe pakai Pointer Events (jalan untuk touch HP maupun mouse desktop) — slide mengikuti gerakan jari secara real-time, snap ke slide berikutnya/sebelumnya kalau geseran melewati ambang batas ±50px, auto-rotate `setInterval` yang sudah ada tetap jalan tapi pause otomatis selama user sedang menggeser. Klik pada banner yang berlink tetap berfungsi (tidak ke-trigger sebagai klik kalau yang terjadi ternyata swipe).
- Tidak ada perubahan skema/RLS/Edge Function — murni interaksi frontend di komponen yang sudah ada sejak Modul 4/5.
- **DoD tambahan**: banner di `/` bisa dipindah slide dengan menggeser jari (HP) atau drag mouse (desktop), bukan cuma menunggu auto-rotate atau klik dot indicator.

### Modul 5 — Website Publik & Cart Online
- `/`: landing page (banner, produk per kategori dengan filter, cart drawer `usePublicCart` di `localStorage`).
- **DoD**: customer bisa browse produk, tambah ke cart, lihat total, lanjut ke checkout.

**Penyempurnaan Modul 5/12 — Konten Halaman Publik bisa diedit dari admin (ditambahkan 2026-09-08, diminta owner):**
- Teks-teks yang sebelumnya hardcode di `Home.jsx` (hero: badge/judul/subjudul/2 tombol CTA, header section "Produk Kami"), `AboutSection.jsx` (judul/deskripsi + judul+deskripsi 3 kartu fitur "Tentang GAGI"), dan `Footer.jsx` (nama brand, tagline, 3 baris "Cara Pesan") sekarang disimpan di tabel baru `site_content` (§3) dan bisa diedit lewat tab admin baru **"Konten Halaman"**.
- Field yang TIDAK dipindah ke `site_content` (sengaja tetap fixed di kode): link navigasi footer (`#home`/`#produk`/`#tentang`), ikon SVG 3 kartu fitur "Tentang", tahun copyright — bukan konten yang wajar diedit lewat form teks biasa.
- `getSiteContent()` (`src/features/settings/siteContentApi.js`) melakukan deep-merge terhadap `DEFAULT_SITE_CONTENT` (duplikat persis teks asli yang di-hardcode sebelumnya) — kalau baris `site_content` belum ada atau field tertentu belum pernah diisi admin, halaman publik tetap tampil dengan teks default, tidak pernah kosong/rusak.
- **DoD tambahan**: admin isi tab "Konten Halaman", simpan → teks di `/` langsung berubah sesuai isian tanpa perlu deploy ulang; kalau baris `site_content` kosong/baru instalasi, halaman publik tetap tampil dengan teks default (tidak blank).

### Modul 6 — Realtime Stok Produk
- Kolom `stock` di `products`, RPC `update_product_stock` (admin), `decrement_product_stock`/`restore_product_stock` (service-role only, dipanggil dari checkout & pembatalan). Tabel `products` masuk publication `supabase_realtime`.
- **DoD**: admin ubah stok → berubah di `/` dalam <1 detik tanpa reload; checkout mengurangi stok; checkout qty > stok ditolak; stok 0 → produk tampil "Stok Habis", tombol tambah disabled.

### Modul 7 — Checkout Online + Midtrans + Form Lokasi Pengantaran
- Edge Function `public-checkout` (anon — insert order dengan `lokasi_1`/`lokasi_2` + `order_items`, hitung ulang harga server-side, potong stok, generate Snap token) dan `get-order` (anon — lookup order by `order_token` via service role, bukan RLS publik).
- Halaman `/checkout` (form nama, no telp, email, **Lokasi 1 wajib + Lokasi 2 opsional** sesuai ketentuan UX `PRD.md` §4.1, lalu Snap.js popup) dan `/order/:order_token` (tampilkan QR, subscribe Realtime Postgres Changes pada baris order itu untuk auto-update status).
- **DoD**: dari checkout sampai bayar sandbox sukses, customer sampai ke halaman QR unik miliknya, order tersimpan status `paid` beserta lokasi yang diisi, stok berkurang; submit checkout tanpa isi Lokasi 1 ditolak dengan pesan jelas, submit tanpa Lokasi 2 tetap berhasil; kalau qty item di keranjang melebihi stok yang tersisa saat checkout, jumlah yang diproses **otomatis dibatasi ke stok tersisa** (bukan ditolak seluruhnya, diubah owner 2026-09-08 — lihat `PRD.md` §4.1), dengan pesan jelas ke customer soal penyesuaian jumlah.

**Modul 7d — Metode Pembayaran Cash (ditambahkan 2026-09-08, dikonfirmasi owner, migration `0008_cash_payment.sql`):**
- Checkout menambah pilihan **Metode Pembayaran** (`PaymentMethodInput.jsx`): "Bayar Online" (default, perilaku Modul 7 di atas TIDAK BERUBAH) atau "Bayar Cash". `public-checkout` menerima field baru `payment_method` (`'online'`/`'cash'`, default `'online'` kalau tidak dikirim — kompatibel dengan client lama).
- Jalur cash: order dibuat LANGSUNG `status='paid'` (bukan `pending`), TANPA request Snap token ke Midtrans sama sekali. Potong stok tetap di titik yang sama (langkah 4, tidak ada perbedaan). Email konfirmasi (Modul 9) dikirim LANGSUNG dari `public-checkout` saat itu juga (bukan dari `midtrans-webhook`, yang tidak pernah terpanggil untuk cash) — isi email beda: minta customer siapkan uang tunai, bukan "pembayaran diterima".
- Frontend (`Checkout.jsx`): kalau `payment_method='cash'`, response tidak mengandung `snap_token` — popup Snap dilewati total, customer langsung diarahkan ke `/order/:order_token`.
- Halaman `/order/:order_token` (`OrderQr.jsx`): untuk `status='paid'` + `payment_method='cash'`, teks status jadi **"Menunggu Di-scan"** (bukan "Sudah Dibayar"/"Menunggu Pembayaran") — QR tetap ditampilkan sama seperti order `paid` biasa. Admin scan QR-nya lewat tab "Scan QR Verifikasi" **tanpa perubahan apapun** ke RPC `verify_order_pickup` (Modul 10) — cash dan online sama-sama diverifikasi lewat RPC yang sama persis.
- Tab "Pesanan" admin (`PesananTab.jsx`) menambah kolom **Metode** (badge Cash/Online) + label status terpisah untuk `paid`+`cash` ("Cash - Belum Ditagih") supaya admin tahu masih perlu menagih tunai saat mengantar.
- **Efek pada laporan penjualan (Modul 11, PENTING — dicatat eksplisit karena menyentuh uang, AGENTS.md §4)**: karena order cash langsung `status='paid'`, ia IKUT TERHITUNG di `COUNTED_STATUSES`/total penjualan (`ordersApi.js`) SEJAK CHECKOUT DIBUAT — BUKAN baru terhitung setelah admin benar-benar menerima uang tunai saat serah terima. Ini keputusan sadar (supaya tidak perlu status baru), TAPI owner perlu tahu: kalau ada pesanan cash yang batal diantar/tidak jadi diambil, order itu TETAP tercatat sebagai "terjual" di laporan sampai ada penanganan manual (belum ada fitur cancel/refund manual untuk order cash di tahap ini — dicatat sebagai Open Question, lihat §7).
- **DoD**: checkout pilih "Bayar Cash" -> tanpa Midtrans sama sekali, order `paid`+`cash`, stok berkurang, email konfirmasi customer & notifikasi admin tetap terkirim (isi disesuaikan, bukan disalin dari template online), customer sampai ke `/order/:order_token` dan langsung lihat QR dengan teks "Menunggu Di-scan"; admin bisa scan QR itu di tab "Scan QR Verifikasi" seperti biasa, status jadi `completed`; checkout pilih "Bayar Online" (default) berperilaku SAMA PERSIS seperti sebelum Modul 7d (regression check).

**Modul 7e — Pembatalan Manual Order Cash (ditambahkan 2026-09-14, dikonfirmasi owner, migration `0009_cancel_cash_order.sql`):**
- RPC baru `cancel_cash_order(p_order_id)` (SECURITY DEFINER, pola sama `verify_order_pickup` Modul 10) — HANYA bisa membatalkan order `payment_method='cash'` yang masih `status='paid'` (order `completed`/`cancelled` ditolak, order `online` ditolak juga — pembatalannya tetap lewat Midtrans/webhook Modul 8). Begitu berhasil, stok semua item di order itu di-restore lewat `restore_product_stock` (RPC yang sama dipakai Modul 8), per-item best-effort.
- SQLSTATE dipakai `PT404`/`PT422`/`PT409` (format baru, BUKAN `P0002`-style seperti `verify_order_pickup` — lihat alasan lengkap & rekomendasi di komentar migration `0009` dan Bug/Isu #6 `TODO.md`; RPC lama TIDAK diubah, cuma RPC baru ini yang pakai format yang benar dari awal).
- UI: tombol **"Batalkan"** di tab "Pesanan" admin (`PesananTab.jsx`), muncul HANYA di baris order `cash`+`paid`; sukses -> baris jadi status "Dibatalkan" tanpa perlu reload/refetch (`ordersApi.js` fungsi `cancelCashOrder`).
- **DoD**: order cash `paid` -> klik "Batalkan" -> konfirmasi -> status jadi `cancelled`, stok produk yang dipesan kembali ke angka semula; tombol tidak muncul untuk order online ataupun order cash yang sudah `completed`/`cancelled`; RPC ditolak jelas kalau dipanggil untuk kombinasi yang tidak valid (lihat checklist lengkap di migration `0009`).

**Modul 7b — Lanjutkan Pembayaran & Auto-hide QR (ditambahkan 2026-09-08, dikonfirmasi owner):**
- Edge Function baru `supabase/functions/resume-payment/index.ts` (anon) — untuk order yang masih `pending`, minta Snap token BARU ke Midtrans dengan `order_id`/`gross_amount`/`item_details` PERSIS SAMA seperti transaksi asli (di-derive dari snapshot `order_items`, bukan hitung ulang dari `products`). Ini bukan bikin order baru — Midtrans bersifat idempotent selama transaksi `order_id` yang sama masih `pending`, jadi token baru tetap merujuk transaksi yang sama. Order yang statusnya bukan `pending` ditolak `409` dengan pesan spesifik per status (`paid`/`completed`/`cancelled`). Rate limit 10x/60 detik per IP.
- **DoD**: order `pending` yang dibuka di `/order/:order_token` TIDAK menampilkan QR, menampilkan tombol "Lanjutkan Pembayaran" — klik membuka popup Snap untuk transaksi yang sama; order `paid` menampilkan QR seperti biasa; begitu admin scan QR (Modul 10) dan status jadi `completed`, QR di halaman customer (kalau tab masih terbuka) hilang OTOMATIS tanpa reload, diganti teks "QR berhasil di-scan".

**Modul 7c — Realtime auto-update `/order/:order_token` beneran nyala + polish UI (ditambahkan 2026-09-08):**
- **Bug yang diperbaiki**: `subscribeOrderStatus` sejak Modul 7 Tahap 2 SUDAH menulis kode subscribe Postgres Changes ke tabel `orders`, tapi TIDAK PERNAH benar-benar mengirim event ke browser customer, karena 2 hal yang kelewat: (1) tabel `orders` tidak pernah didaftarkan ke publication `supabase_realtime` (beda dari `products` di Modul 6); (2) SEANDAINYA pun ditambal, Supabase Realtime tetap mengevaluasi RLS SELECT tabel itu untuk role `anon` (customer tidak login) sebelum broadcast — dan `orders` sengaja tidak punya policy select untuk anon (§5, karena isinya PII). Jadi status di halaman customer SELALU butuh reload manual untuk update, walau komentar kode lama sudah optimis menyebut "otomatis update".
- **Fix**: migration baru `0006_order_status_public_realtime.sql` — tabel bayangan `order_status_public` (order_id, order_token, status, updated_at — **tanpa PII**), trigger `sync_order_status_public()` yang menyalin `orders.status` ke tabel ini tiap kali berubah, RLS `select using (true)` untuk tabel bayangan ini (aman, tidak ada data sensitif), dan tabel ini yang didaftarkan ke publication `supabase_realtime` (bukan `orders`). `src/lib/realtime.js` (`subscribeOrderStatus`) dan `src/pages/OrderQr.jsx` diubah untuk dengar dari tabel baru ini.
- **Sekaligus**: tampilan `/order/:order_token` dipoles — kartu status dibuat lebih rapi (badge + indikator "Live" kecil waktu `pending`/`paid`, animasi fade/slide `animate-detail-open` tiap status berubah supaya transisinya terasa, kotak QR dikasih bingkai putih+shadow, ikon centang "completed" dikasih animasi `animate-pop`, nomor pesanan singkat ditampilkan gaya struk) — tanpa mengubah data/skema yang ditampilkan.
- **DoD**: buka `/order/:order_token` untuk order `pending` di 1 tab, biarkan terbuka, lalu ubah `orders.status` jadi `paid` dari tab/SQL lain → tab yang terbuka HARUS otomatis berubah ke tampilan QR dalam <2 detik TANPA refresh; begitu juga transisi `paid` → `completed` lewat scan QR admin; `select * from order_status_public` pakai anon key berhasil (by design), `select * from orders` pakai anon key TETAP gagal/kosong seperti sebelumnya.

### Modul 8 — Security Hardening: Pembatalan Order & Restore Stok
- `midtrans-webhook` menangani `transaction_status` `deny`/`cancel`/`expire` → `orders.status='cancelled'` + `restore_product_stock`, dijaga guard `.eq('status','pending')` supaya idempotent (pelajaran dari AyamKu Modul 18 temuan #2 — dikerjakan dari awal di sini, bukan sebagai temuan review belakangan).
- **[BARU 2026-09-15, dikonfirmasi owner]** Batas waktu bayar Snap diset EKSPLISIT **15 menit** lewat parameter `expiry` di `_shared/midtrans.ts` (`createSnapTransaction`, konstanta `SNAP_EXPIRY_MINUTES`) — bukan cuma mengandalkan setting durasi expiry di Midtrans Dashboard (yang sudah diubah owner ke 15 menit juga di sisi Midtrans, tapi tidak terlihat/terdokumentasi dari kode). Parameter `expiry` di request SELALU menang dari default dashboard (dokumentasi resmi Midtrans), jadi perilakunya PASTI 15 menit apa pun isi dashboard saat itu. **Restore stok otomatis saat expired TIDAK BERUBAH SAMA SEKALI** — baris di atas (guard `expire`/`cancel`/`deny` → restore stok) SUDAH ADA sejak Modul 8 ditulis, bukan fitur baru; perubahan 2026-09-15 murni memastikan angka "15 menit"-nya konsisten dan tertulis jelas di kode.
- **DoD**: checkout dibuat tapi tidak pernah dibayar sampai expired Snap (sekarang **15 menit**, bukan default 24 jam Midtrans) → order `cancelled`, stok kembali ke angka semula; webhook duplikat tidak restore stok dua kali; halaman `/order/:order_token` customer auto-update ke "Dibatalkan" tanpa reload begitu expired (Realtime, Modul 7c).

### Modul 9 — Email Notification (Gmail SMTP)
- `supabase/functions/_shared/email.ts` (`sendEmail()` via `denomailer`, port 465/TLS), dipanggil dari `midtrans-webhook` tepat setelah order jadi `paid`: email link `/order/:order_token` ke customer + email notifikasi (berisi Lokasi 1/Lokasi 2) ke `settings.notification_email` (kalau sudah diisi admin).
- **DoD**: kedua email terkirim otomatis begitu status order jadi `paid`, email notifikasi ke admin mencantumkan lokasi pengantaran dengan jelas.

### Modul 9b — Notifikasi WhatsApp ke Customer (BARU, 2026-09-15, diminta owner langsung)
- Pelengkap email di atas, **bukan pengganti** — begitu order `paid` (online, dari `midtrans-webhook`) atau tercatat cash (`public-checkout`), customer juga dikirimi pesan WhatsApp (ringkasan item + total + link `/order/:order_token`) ke nomor yang diisi sendiri saat checkout (`orders.no_telp`).
- **Arsitektur**: dikirim lewat service Node.js **terpisah** (`whatsapp-service/`, di luar Netlify/Supabase, hosting Node.js milik owner sendiri) yang menjaga 1 koneksi WhatsApp Web tetap hidup pakai [Baileys](https://github.com/WhiskeySockets/Baileys) — nomor **WA ke-2** owner, login sekali via scan QR di terminal, sesi tersimpan di folder `auth_info_baileys/` (tidak di-commit, setara kredensial). Supabase Edge Function (Deno, stateless/cold-start) tidak bisa menjaga sesi WA tetap login, makanya dipisah — Edge Function cuma `fetch()` `POST /send` ke service ini.
- Kode: `supabase/functions/_shared/whatsapp.ts` (`normalizeIndonesianPhone()`, `buildCustomerWhatsAppMessage()`, `sendWhatsAppMessage()` — timeout 8 detik, sengaja `throw` di error supaya pemanggil yang tangani), dipanggil dari `midtrans-webhook`/`public-checkout` di blok try/catch **terpisah** dari email (best-effort — gagal kirim WA tidak pernah menggagalkan checkout/webhook/email).
- **Keamanan**: endpoint `/send` service Node.js diautentikasi header `x-api-key`, harus sama persis dengan secret Supabase `WHATSAPP_SERVICE_API_KEY`; URL service di secret `WHATSAPP_SERVICE_URL` — kedua secret HANYA di Edge Function Secrets, tidak pernah di kode frontend (`AGENTS.md` §2/§4).
- **Anti-spam kosmetik [BARU 2026-09-15]**: sebelum kirim pesan sungguhan, service menampilkan status "mengetik..." (`sendPresenceUpdate`) selama `TYPING_DELAY_MS` (default 3 detik, bisa diubah lewat env var) supaya pola kirim terasa natural. Murni kosmetik, best-effort — gagal set status ini tidak membatalkan pengiriman pesan.
- **Bukan WhatsApp Business API resmi** — risiko nomor kena banned WhatsApp kalau volume kirim besar/terindikasi spam; untuk skala 1 toko dinilai risikonya rendah, tetap dicatat sebagai keputusan sadar owner (lihat `whatsapp-service/README.md`).
- **DoD**: order online `paid` atau order cash yang baru dibuat → customer menerima WhatsApp (dari nomor WA ke-2) berisi status/ringkasan/total/link `/order/:order_token`, DAN email konfirmasi tetap terkirim seperti biasa; nomor telepon format aneh/tidak terdaftar WA atau service WA down → notifikasi WA dilewati dengan log jelas, checkout/pembayaran/email TIDAK ikut gagal; TIDAK ada notifikasi WA ke admin (cuma ke customer, beda dari email yang punya 2 tujuan).

### Modul 10 — Scan QR Verifikasi Serah Terima (Admin)
- Tab/modal "Scan QR Verifikasi" di `/admin` pakai kamera device (library `qr-scanner`) + fallback input manual. Verifikasi & update via RPC `verify_order_pickup(order_token)` (SECURITY DEFINER, §5.3) — bukan UPDATE langsung.
- **DoD**: scan QR valid & belum diambil → sukses, tandai `completed`; scan QR yang sudah `completed` → warning jelas; scan lewat 1x seminggu (§0.10) → ditolak "expired"; halaman `/order/:order_token` customer auto-update tanpa reload (Realtime).

### Modul 11 — Laporan Penjualan & Riwayat Pesanan
- Tab "Dashboard" & "Pesanan" pada `/admin` dengan filter tanggal (hari ini/kemarin/custom range) + total penjualan sesuai filter (hanya status `paid`/`completed`). Tab "Pesanan" menampilkan `lokasi_1`/`lokasi_2` per baris.
- **DoD**: angka total penjualan cocok dengan hitung manual dari data transaksi di rentang tanggal yang sama; admin bisa lihat lokasi tujuan tiap pesanan tanpa buka detail tambahan.

### Modul 12 — Pengaturan Notifikasi
- Tab "Pengaturan" di `/admin` — form alamat email tujuan notifikasi, upsert ke tabel `settings`.
- **DoD**: admin ubah alamat email, checkout online sandbox berikutnya mengirim notifikasi ke alamat baru.

### Modul 13 — UI/UX: Tema Musim Salju Minimalis & Imut
- Terapkan design token §0.11: palet biru muda/biru tua/putih, gradient dusk, efek salju performant, komponen minimalis & cute (rounded, soft shadow) di `/` dan `/admin`. Pastikan form Lokasi Pengantaran (Modul 7) mengikuti ketentuan UX §0.11/`PRD.md` §4.4 (label jelas, placeholder contoh, teks bantuan).
- **DoD**: Lighthouse performance score wajar (>80) di halaman publik meski ada animasi salju; efek salju otomatis berhenti saat tab tidak aktif; semua halaman konsisten secara visual; `prefers-reduced-motion` dihormati; user awam yang belum pernah lihat form ini bisa isi Lokasi 1/Lokasi 2 dengan benar tanpa penjelasan tambahan (diuji manual, §6 Modul 13).

### Modul 14 — Testing & Deploy Production
- Testing end-to-end semua flow, deploy Netlify + Supabase production + R2 production + Midtrans production keys.
- **DoD**: seluruh flow di PRD berjalan mulus di production dengan transaksi nyata nominal kecil untuk uji.

### Modul 15 — Penyempurnaan Notifikasi WA + Rebranding "GABAR" (RENCANA, diminta owner 2026-09-15, dikerjakan BERTAHAP)
> **Status: rencana ditulis, kode BELUM ada sama sekali.** Diminta owner langsung di chat setelah lihat screenshot email masuk (customer & admin). Owner secara eksplisit minta dikerjakan **bertahap, satu-satu, bukan langsung semua sekaligus** — urutan di bawah adalah urutan pengerjaan yang disepakati. Tiap sub-modul (15a-15d) punya status sendiri di `TODO.md`, jangan digabung jadi satu baris "Selesai".

**15a — Field Nomor WA Admin (multi-nomor) di Tab Pengaturan**
- Tambah field input nomor WhatsApp tujuan notifikasi admin di tab "Pengaturan" (`PengaturanTab.jsx`), **bisa ditambah lebih dari 1 nomor** (bukan cuma 1-2 field fix) — pola UI "tambah nomor" + tombol hapus per baris, mirip daftar dinamis.
- Penyimpanan: perlu diputuskan format storage — opsi (a) key baru di tabel `settings` existing (value berupa JSON array nomor, key mis. `whatsapp_admin_numbers`) supaya tidak perlu migration baru, atau (b) tabel baru kalau owner mau tiap nomor punya metadata (nama/label). **Default rencana: opsi (a)** kecuali owner minta lain, karena pola sama dengan `notification_email` yang sudah ada (Modul 12) dan tidak perlu migration/RLS baru.
- **DoD (15a)**: admin bisa tambah/hapus banyak nomor WA di tab Pengaturan, tersimpan & muncul lagi setelah reload; validasi format nomor sama seperti `normalizeIndonesianPhone()` yang sudah ada di `_shared/whatsapp.ts` (dipindah/diekspos supaya bisa dipakai validasi ringan di frontend juga, atau divalidasi ulang di Edge Function saat kirim).

**15b — Notifikasi WA ke Admin (pesan berjajar/queued, bukan serentak)** — ✅ kode ditulis 2026-09-15 (lihat changelog `TODO.md`)
- Begitu order masuk (online `paid` / cash), kirim WA ke **customer dulu** (perilaku existing, Modul 9b) — SETELAH itu baru kirim WA ke **setiap nomor admin** yang terdaftar (dari 15a), satu per satu, masing-masing dengan jeda "mengetik..." 3 detik yang sudah ada (`TYPING_DELAY_MS`) — bukan ditembak bersamaan. Tujuannya: pola kirim pesan WA dari nomor ke-2 owner terlihat natural (satu per satu, ada jeda), meminimalkan risiko nomor dianggap spam bot & diblokir WhatsApp saat order lagi ramai.
- Isi pesan ke admin: sama seperti isi email notifikasi admin yang sudah ada (nama, no. telp, email, Lokasi 1/2, ringkasan item, total, link `/order/:order_token`) — bukan versi ringkas seperti pesan ke customer.
- **✅ Diimplementasikan sebagai opsi (b), dikonfirmasi owner 2026-09-15**: antrian pengiriman (customer + semua admin, berurutan dengan jeda) dipindah ke **dalam `whatsapp-service/` sendiri** — Edge Function (`midtrans-webhook`/`public-checkout`) cuma kirim SATU request `POST /send-batch` berisi daftar semua tujuan (`_shared/whatsapp.ts`, `sendWhatsAppBatch()`), service Node.js (`server.js`, antrian in-memory `messageQueue` + worker `processQueue()`) yang atur urutan+jeda secara async di background — Edge Function balas cepat (tidak menunggu semua pesan terkirim), sehingga tidak berisiko timeout webhook Midtrans meski nomor admin banyak.
- **DoD (15b)**: order masuk → WA ke customer terkirim dulu (dengan jeda mengetik 3 detik seperti sekarang), BARU SETELAH ITU WA ke tiap nomor admin terkirim satu-satu (masing-masing juga dengan jeda mengetik 3 detik) — bukan serentak; isi pesan admin mencakup info yang sama seperti email admin; kegagalan kirim ke salah satu nomor admin tidak menghalangi nomor admin lain atau notifikasi customer (best-effort per nomor, sama filosofi dengan pola existing). **Belum ditest live** — lihat checklist "Menunggu owner" di changelog `TODO.md` 2026-09-15.

**15c — Rebranding "GAGI" → "GABAR" (Gabin Ice Bar)**
- Ganti semua teks brand di **isi notifikasi WA & email** (subjek, salam pembuka, tanda tangan) dari "GAGI"/"❄️ GAGI" jadi **"GABAR"** (nama brand pendek, dipakai di teks singkat) dengan keterangan **"Gabin Ice Bar"** (nama lengkap, dipakai di tempat yang sudah menyebut kepanjangan, sama pola seperti `PRD.md` §1 "GAGI (Gabin Regiee)" sebelumnya).
- **Scope perlu dikonfirmasi owner**: apakah rebrand ini HANYA di teks notifikasi (WA + email), atau ikut ke tempat lain juga — judul halaman publik (`<title>`)/navbar/footer (`Footer.jsx`, teks "Cara Pesan")/`site_content` default seed/nama pengirim email (`GMAIL_ADDRESS` display name)/domain. **Rencana default (sampai dikonfirmasi lain): scope MINIMAL, cuma teks notifikasi WA (`buildCustomerWhatsAppMessage()` di `_shared/whatsapp.ts`) & email (`_shared/email.ts`, subjek+html di `midtrans-webhook`/`public-checkout`)** — sesuai konteks awal permintaan owner (soal notifikasi), bukan rebrand visual/domain penuh, supaya scope sub-modul ini tidak melebar ke §0/`PRD.md` §1 tanpa konfirmasi eksplisit.
- **[UPDATE 2026-09-15, diminta owner langsung di chat] Scope diperluas ke UI**: selain notifikasi, teks brand di halaman publik & panel admin ikut diganti (navbar publik `Navbar.jsx`, `AdminNavbar.jsx`, `AdminLogin.jsx`, `<title>` di `index.html`, default `siteContentApi.js` + seed `0007_site_content.sql`). **Tidak termasuk**: domain, CSS variable `--gagi-*`, key localStorage, nama repo/proyek di dokumentasi. Lihat baris changelog `TODO.md` 2026-09-15.
- **DoD (15c)**: semua notifikasi WA & email (customer maupun admin, online maupun cash) menyebut "GABAR"/"Gabin Ice Bar", tidak ada sisa teks "GAGI" di pesan-pesan itu.

**15d — Bug Fix: artefak `=20` di email notifikasi (quoted-printable soft line break)**
- **Diagnosis awal (dari screenshot owner)**: teks `=20` yang muncul di badan email customer & admin adalah artefak encoding **quoted-printable** (`Content-Transfer-Encoding: quoted-printable`) — `=20` adalah representasi 1 spasi (0x20) dalam quoted-printable, biasanya muncul kalau ada baris yang diakhiri spasi/trailing-whitespace sebelum newline lalu di-encode tapi TIDAK di-decode dengan benar oleh client, atau `denomailer` mengirim `content`/`html` dengan header encoding itu tapi body yang dikirim sebenarnya sudah plain text (bukan quoted-printable asli) — perlu dicek langsung ke `_shared/email.ts` (kandidat: fungsi `htmlToPlainText()` yang ditulis di fix Bug/Isu #7, atau parameter `content`/`encoding` di `client.send()`) begitu masuk giliran coding sub-modul ini.
- **DoD (15d)**: email customer & admin (online maupun cash) tidak lagi menampilkan artefak `=20` (atau artefak quoted-printable lain) di badan pesan, dicek di minimal 2 email client berbeda (mis. Gmail web + 1 client lain) karena rendering artefak ini bisa beda per client.

**15e — Retry Otomatis Notifikasi WA lewat Antrian `wa_outbox` (BARU, 2026-09-17, diminta owner langsung)**
> Ditambahkan SETELAH 15a-15d selesai ditulis (bukan bagian rencana awal Modul 15) — owner lapor `whatsapp-service` (hosting Node.js miliknya) sering down, dan minta notifikasi yang gagal terkirim saat itu bisa "pending" lalu otomatis terkirim lagi begitu service hidup kembali, bukan hilang begitu saja seperti perilaku sebelumnya (dicatat apa adanya sejak Modul 15b: kegagalan kirim WA "TIDAK di-retry otomatis").
- **Keputusan desain (dikonfirmasi lewat diskusi dengan owner)**: sempat diusulkan polling berkala (cron Supabase tiap 1-2 menit mengecek antrian), tapi DITOLAK owner karena dianggap boros query/egress database untuk skala 1 toko yang jarang down. Desain final: **event-driven**, bukan polling — `whatsapp-service` sendiri yang menyedot antrian TEPAT SAAT event `connection.update` (Baileys) melaporkan `connection === "open"`, karena momen itu PERSIS saat koneksi baru bisa dipakai kirim pesan lagi (baik setelah down beneran, restart service, maupun cuma jaringan putus sebentar). Konsekuensinya: tidak ada query ke `wa_outbox` yang jalan terus-menerus selama service normal/hidup — cuma terjadi pas memang ada kemungkinan sesuatu perlu di-retry.
- Tabel baru `wa_outbox` (migration `0010_wa_outbox.sql`, lihat §3) menyimpan batch pesan yang gagal terkirim, RLS default-deny total (cuma `service_role`).
- `sendWhatsAppBatch()` (`_shared/whatsapp.ts`) terima parameter opsional `{ supabase, orderId }` — kalau diisi dan request ke `whatsapp-service` gagal, batch otomatis di-insert ke `wa_outbox` sebagai `pending` sebelum error dilempar ke pemanggil (`midtrans-webhook`/`public-checkout`, keduanya diupdate untuk mengoper parameter ini).
- `whatsapp-service/server.js` — fungsi baru `flushPendingOutbox()`, dipanggil dari dalam handler `connection.update` di cabang `connection === "open"`: ambil baris `pending` (limit 50, terurut `created_at`), coba kirim ulang lewat `sendOneMessage()` yang sudah ada sejak Modul 15b, update status `sent`/tetap `pending`/`failed` (kalau `attempts` sudah mencapai `OUTBOX_MAX_ATTEMPTS`, default 5 — supaya nomor yang memang selalu gagal, mis. tidak terdaftar WA, tidak dicoba selamanya tiap kali reconnect).
- **DoD (15e)**: matikan `whatsapp-service` sengaja → buat order baru sampai proses checkout selesai (WA gagal terkirim, tersimpan ke `wa_outbox` sebagai `pending`, dicek lewat log Edge Function) → checkout/pembayaran tetap sukses normal (regression check, best-effort tidak berubah) → nyalakan lagi `whatsapp-service` → dalam hitungan detik setelah reconnect, pesan yang tadi pending otomatis terkirim TANPA aksi manual apapun, status di `wa_outbox` berubah jadi `sent`; nomor yang memang tidak valid/tidak terdaftar WA akhirnya ditandai `failed` setelah `OUTBOX_MAX_ATTEMPTS` kali percobaan, bukan dicoba selamanya.

**Urutan pengerjaan (sesuai permintaan eksplisit owner, jangan diubah urutannya tanpa konfirmasi ulang): 15a → 15b → 15c → 15d.** Setiap sub-modul selesai ditulis kodenya, redeploy & ditest owner dulu sebelum lanjut ke sub-modul berikutnya (`WORKFLOW.md` §4).

### Modul 16 — Broadcast WA Belum Scan (BARU, 2026-09-24, diminta owner langsung)
- Tab admin baru "Broadcast WA Belum Scan": daftar semua order `status='paid'` (cash/online) yang belum `completed` (QR belum discan), diurutkan `created_at` ASCENDING — pembeli paling duluan dikirim paling awal, paling akhir dikirim paling akhir.
- Template pesan berupa beberapa "field" custom yang bisa ditambah/dikurang admin sendiri (tiap field = 1 chat WA terpisah, dikirim BERURUTAN ke 1 nomor yang sama), mendukung placeholder `{nama}` dan `{pesanan}`. Disimpan di `settings` (key `wa_broadcast_template`, JSON array — tidak ada migration/RLS baru).
- Sebelum kirim massal, admin wajib masukkan password konfirmasi tetap (`sudo apt udpate notification all`, string sengaja seperti perintah CLI sesuai permintaan owner) — ini gate UI, bukan keamanan sungguhan; pengiriman sungguhan tetap wajib admin login (dijaga Edge Function di bawah).
- Pacing pengiriman diatur SEPENUHNYA di frontend (`BroadcastWaTab.jsx`), bukan di `whatsapp-service`, supaya progress & animasi bisa ditampilkan live per pesan: animasi "Mengetik..." **5 detik** sebelum tiap chat benar-benar terkirim; setelah SEMUA field untuk 1 nomor selesai, jeda **10 detik** sebelum lanjut ke nomor berikutnya. Ada tombol "Batalkan Broadcast". 1 nomor gagal tidak menghentikan nomor lain (best-effort).
- Edge Function baru `wa-broadcast-notify` — proxy admin-only (wajib JWT admin + `current_user_role()='admin'`, pola sama `manage-admin`) ke endpoint `/send` `whatsapp-service` yang SUDAH ADA sejak Modul 9b (satu pesan teks plain per panggilan, BUKAN `/send-batch` Modul 15b). Kenapa harus lewat Edge Function: secret `WHATSAPP_SERVICE_URL`/`WHATSAPP_SERVICE_API_KEY` tidak boleh pernah ada di kode `/src` (§5.9) — kalau admin panel manggil `whatsapp-service` langsung dari browser, API key WA harus ikut ditanam ke bundle frontend dan bisa dicuri siapa saja lewat devtools.
- **Tidak ada perubahan sama sekali** di `whatsapp-service/server.js`, skema database, migration, atau RLS — murni SELECT ke `orders` (RLS `orders_select_admin` yang sudah ada) + 1 key baru di tabel `settings` yang sudah ada.
- **DoD**: admin isi/ubah field template, simpan, reload — template tetap ada; daftar customer belum discan tampil terurut dari yang beli paling duluan; klik "Kirim Semua" tanpa password benar → ditolak; dengan password benar → tiap chat menampilkan animasi "Mengetik..." persis 5 detik lalu terkirim, jeda 10 detik sebelum nomor berikutnya, urutan pengiriman sesuai urutan tampil; 1 nomor dengan format telepon rusak/tidak terdaftar WA ditandai gagal/dilewati tanpa menghentikan broadcast ke nomor lain; "Batalkan Broadcast" menghentikan proses di tengah jalan.

---

## 7. Hal yang Perlu Keputusan Owner Sebelum/Selama Development

### Sudah dikonfirmasi owner (2026-09-07)
- ✅ Multi-akun admin dibutuhkan → tab "Akun Admin" masuk MVP (§0.2, Modul 1b).
- ✅ Produk tidak butuh varian rasa/topping → tiap varian jadi produk terpisah (§0.9).
- ✅ Masa berlaku QR verifikasi: **1x seminggu** (7×24 jam), bukan 1x24 jam seperti AyamKu (§0.10).
- ✅ Nama brand untuk sekarang: **GAGI**.
- ✅ Metode pembayaran Midtrans Snap: **tidak dibatasi ke QRIS saja** — semua metode yang diaktifkan owner di Midtrans Dashboard boleh dipakai (§0.7).
- ✅ **Tidak ada sistem voucher** — dihapus dari scope MVP (§0.4).
- ✅ **Tidak ada "titik pickup"** — diganti model "owner mengantar ke lokasi pelanggan" dengan form Lokasi 1 (wajib) & Lokasi 2 (opsional) di checkout (§0.3).

### Masih perlu dikonfirmasi
- Konfirmasi hosting frontend (asumsi Netlify, §0.13).
- ✅ **Metode Pembayaran Cash/COD ditambahkan** (2026-09-08, Modul 7d, migration `0008`) — dikonfirmasi owner via chat langsung, sudah ditest live owner (2026-09-14): checkout cash berhasil, tanpa popup Midtrans.
- ✅ **Pembatalan manual order cash ditambahkan** (2026-09-14, Modul 7e, migration `0009`) — dikonfirmasi owner via chat langsung. Lihat detail di §6 Modul 7e.