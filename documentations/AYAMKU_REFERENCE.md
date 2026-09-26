# AYAMKU_REFERENCE.md — Ringkasan Mandiri Proyek Asal "AyamKu" (Fried Chicken)

> **Kenapa file ini ada**: Dokumen GAGI lain (`PRD.md`, `ARCHITECTURE.md`, `AGENTS.md`, `SKILL.md`, `TODO.md`) berulang kali merujuk pola/keputusan dari proyek asal "AyamKu" (nama file upload: `Fried_Cichken.zip`) — misal "sama seperti pola AyamKu Modul 12", "beda dari AyamKu yang...", "pelajaran dari AyamKu Modul 18". Supaya **AI lain yang HANYA dibaca file-file dokumentasi GAGI** (tanpa akses ke zip/project AyamKu) tetap bisa memahami rujukan itu, semua konteks yang dibutuhkan dirangkum mandiri di sini. **Baca file ini kalau ada rujukan "AyamKu §X" di dokumen GAGI lain dan konteksnya tidak jelas dari kalimat sekitarnya.**
>
> Ini rangkuman, bukan salinan lengkap — cukup detail untuk membandingkan keputusan GAGI vs AyamKu tanpa perlu buka project AyamKu aslinya lagi.

## 1. Apa itu AyamKu
Website fried chicken dengan **sistem kasir dual-screen (POS) + pre-order online & self pickup**. Dipakai di sebuah toko fisik dengan meja kasir. Stack: React + Vite (Netlify), Supabase (Postgres + Auth + Realtime + Edge Functions), Cloudflare R2 (media), Midtrans (Snap + Core API QRIS), Gmail SMTP + App Password (`denomailer`).

## 2. Fitur yang DIMILIKI AyamKu tapi TIDAK ADA di GAGI
Ini beda paling besar dan alasan kenapa banyak bagian ARCHITECTURE.md GAGI ditulis "disederhanakan dari AyamKu":

- **Sistem Kasir/POS (`/kasir`)**: pegawai kasir input pesanan walk-in langsung di toko — pilih produk, rasa, qty, keranjang, bayar cash/QRIS.
- **Customer Display (`/display`)**: layar kedua (device terpisah) yang mirroring real-time keranjang kasir, tempat munculnya QR pembayaran QRIS saat checkout. Butuh login kasir/admin untuk dibuka.
- **Realtime Broadcast channel tetap bernama `store-main-channel`**: dipakai khusus untuk sinkron kasir↔display (data sementara, bukan tersimpan tiap keystroke ke DB). Event-event yang lewat channel ini: perubahan keranjang, `payment_success`, `qr_expired` (QRIS 15 menit habis), `order_completed` (QR pickup baru di-scan kasir). Model "1 toko = 1 channel tetap" ini disebut **single-counter assumption** — kalau butuh 2+ counter aktif bersamaan perlu fitur "Counter ID" terpisah (belum ada di AyamKu).
- **Role `kasir`** terpisah dari `admin`, dengan hak akses berbeda (kasir akses `/kasir`+`/display`, admin akses semua termasuk `/admin`).
- **Sistem voucher/kode diskon**: tabel `vouchers` (code, persen_diskon, aktif, tanggal_expired, min_belanja), RPC `validate_voucher(p_code, p_subtotal)` (SECURITY DEFINER, tidak ada SELECT publik ke tabel supaya kode tidak bisa dienumerasi), kolom `voucher_id`/`diskon` di `orders`. Kasir & customer online sama-sama bisa input kode voucher.
- **Field varian/rasa produk**: kolom `flavors` (jsonb, default `["Original","Pedas"]`) di tabel `products`, kolom `rasa` di `order_items` — 1 produk bisa punya beberapa pilihan rasa dipilih saat checkout.
- **Kolom order tambahan**: `tipe` (`walkin`/`online`), `kasir_id` (siapa yang proses transaksi walk-in), `sudah_diambil` (boolean terpisah dari `status`, dipakai untuk anti double-redeem QR pickup — beda dari GAGI yang cukup pakai `status='completed'` langsung karena semua order GAGI online, tidak ada state "paid tapi diproses kasir dulu").
- **Model pickup "self pickup"**: customer sendiri yang datang ke toko membawa QR, ditunjukkan ke kasir untuk discan di meja kasir — bukan diantar seperti model GAGI.
- **QR pickup berlaku 1×24 jam** sejak `created_at` (fried chicken harus cepat diambil) — GAGI mengubah ini jadi 1×seminggu karena produk gabin lebih awet.
- **QRIS di Customer Display berlaku 15 menit** (`custom_expiry` eksplisit di Midtrans charge) — tidak relevan di GAGI karena tidak ada kasir/QRIS-di-display sama sekali (GAGI cuma pakai Midtrans Snap untuk online, bukan cash).
- **Manajemen kategori produk (Modul 19 AyamKu)**: awalnya kategori hardcode di frontend (Paha Atas/Paha Bawah/Dada/Sayap/Lainnya), lalu diubah jadi tabel `categories` (id, nama unique, urutan) dengan `products.category_id` FK `on delete restrict`, default seed Ayam/Nasi/Saus — GAGI **mewarisi pola tabel `categories` ini langsung** dari awal (tidak lewat fase hardcode dulu).
- **Stok produk (Modul 17 AyamKu)**: awalnya di luar scope MVP, ditambahkan belakangan atas permintaan owner AyamKu — kolom `stock` di `products`, RPC `update_product_stock` (manual, admin/kasir), `decrement_product_stock`/`restore_product_stock` (service-role only, dipanggil checkout). Realtime pakai Postgres Changes (bukan Broadcast) karena dua sumber perubahan (manual + otomatis checkout) sama-sama perlu tertangkap tanpa broadcast manual di tiap jalur. **GAGI mewarisi pola stok ini persis** (§Modul 6 `ARCHITECTURE.md` GAGI) — bedanya di GAGI ini sudah masuk MVP dari awal, bukan tambahan belakangan.
- **Manajemen Akun Kasir**: Edge Function `manage-staff` (pakai `supabase.auth.admin.createUser()` service role, bukan self sign-up publik) — GAGI mewarisi pola Edge Function ini untuk kebutuhan berbeda: `manage-admin` (multi-akun admin, bukan kasir vs admin).
- **Tema visual**: glassmorphism, palet 60% merah / 30% putih / 10% kuning — GAGI sengaja pakai tema total berbeda (musim salju, biru muda/biru tua/putih, minimalis+imut, bukan glassmorphism berat).

## 3. Keputusan/Pelajaran AyamKu yang DIWARISI GAGI (pola sama, tanpa perlu diulang review-nya)
Ini kenapa banyak keputusan keamanan GAGI ditulis "sejak awal, bukan temuan review belakangan" — karena polanya sudah pernah "ditemukan lewat jalan sulit" di AyamKu:

- **QR code isi**: URL unik `https://domain.com/order/{order_token}`, `order_token` = UUID v4 random (bukan sekuensial/auto-increment) supaya tidak bisa ditebak/dienumerasi.
- **Payment tidak pernah dipercaya dari client** — status `paid` hanya berubah dari Edge Function webhook Midtrans setelah verifikasi signature key.
- **Email transaksional pakai Gmail SMTP + App Password** (via `denomailer`, port 465/TLS), bukan Resend, karena owner belum punya domain sendiri (Resend tanpa domain terverifikasi cuma bisa kirim ke alamat akun sendiri). Limit ~500 email/hari akun Gmail biasa — cukup untuk skala 1 toko.
- **R2 upload via presigned URL** — kredensial R2 (access key/secret) hanya ada di Edge Function, tidak pernah di frontend.
- **Struktur admin**: 1 halaman `/admin` dengan sidebar tab (bukan banyak route terpisah) — supaya semua menu ada di 1 URL, diputuskan setelah desain awal AyamKu pakai 7 route terpisah lalu diubah atas permintaan owner.
- **Environment variable rahasia** (service role key, Midtrans server key, R2 secret) HANYA boleh di Edge Function, tidak pernah di kode `/src` frontend yang di-bundle ke browser.

## 4. Temuan Security Review AyamKu (Modul 18) — kenapa penting untuk GAGI
AyamKu awalnya desain RLS-nya row-level saja (Modul 2), lalu security review (diminta owner setelah Modul 17 selesai) menemukan celah serius:

1. **Temuan #1 (risiko tinggi)**: policy RLS `orders_update_staff` tidak membatasi KOLOM — kasir bisa `UPDATE orders SET status='paid', total=0` langsung dari console browser lewat `supabase-js`, melewati validasi server-side. **Fix**: cabut total policy `UPDATE orders` untuk client manapun, pindah 2 mutasi legit (`verify_order_pickup`, `cancel_pending_order`) ke RPC SECURITY DEFINER dengan guard atomic.
2. **Temuan #2**: stok yang sudah dipotong saat order dibuat (checkout anon, sebelum `paid`) tidak pernah dikembalikan kalau order batal/expired — celah DoS stok (checkout berulang tanpa bayar bisa menghabiskan stok). **Fix**: `cancel_pending_order`/webhook `deny`/`cancel`/`expire` memanggil `restore_product_stock`, idempotent lewat guard `.eq('status','pending')`.
3. **Temuan #5**: 3 policy lain (`orders_insert_staff`, `order_items_insert_staff`, `order_items_update_staff`) ternyata tidak pernah dipakai kode aplikasi sama sekali (semua jalur legit sudah lewat Edge Function/RPC) — **dicabut langsung**, tidak perlu RPC pengganti.
4. **Temuan #8**: setting "Allow new users to sign up" di Supabase Auth (default menyala) memungkinkan siapapun bikin akun `auth.users` lewat Auth API pakai anon key (bukan lewat UI aplikasi) — bukan celah data (tidak ada trigger bikin baris `profiles`, RLS/RPC selalu cek role dari `profiles`), tapi berpotensi disalahgunakan untuk spam. **Fix**: matikan toggle itu manual di dashboard.

**Konsekuensi ke GAGI**: keputusan-keputusan ini (RPC SECURITY DEFINER untuk mutasi `orders`, restore stok pada pembatalan, matikan public sign-up, CORS lewat env var) **langsung diterapkan sejak Modul 0/2 GAGI**, bukan ditunggu sampai ada security review terpisah yang menemukan ulang masalah yang sama. Ini yang dimaksud `AGENTS.md` GAGI ketika bilang "proyek asal (AyamKu) sempat punya celah persis ini dan perlu security review terpisah untuk menambalnya, jangan diulang di sini".

**Belum sempat dikerjakan di AyamKu** (dicatat sebagai temuan risiko menengah, relevan untuk dicek juga di GAGI): CORS `Access-Control-Allow-Origin: '*'` idealnya dibatasi ke origin production; rate limiting endpoint publik (`validate_voucher`/`public-checkout`) butuh Edge Function/Cloudflare karena di luar kemampuan RPC Postgres saja; tidak ada validasi kekuatan password custom di pembuatan akun staff (andalkan default Supabase Auth).

## 5. Pelajaran Performa & UX AyamKu yang diwariskan ke desain UI GAGI
- Jangan pakai `background-attachment: fixed` di body — penyebab utama browser HP repaint seluruh background tiap frame scroll.
- Batasi `backdrop-filter`/blur cuma untuk elemen sedikit di layar (navbar, cart drawer) — bukan tiap kartu produk (kartu produk pakai solid semi-transparan tanpa blur, bukan glass effect penuh).
- Ganti listener `scroll` polos dengan `IntersectionObserver` untuk reveal-on-scroll/sticky detection (re-render cuma sekali saat kondisi berubah, bukan tiap pixel).
- Hormati `prefers-reduced-motion` untuk animasi (salju di GAGI, setara efek dekoratif AyamKu).

## 6. Cara pakai referensi ini
Kalau owner atau AI sedang bandingkan keputusan GAGI vs AyamKu (atau menemukan rujukan "seperti AyamKu Modul X" di dokumen GAGI lain yang tidak jelas maksudnya), cek bagian di atas dulu sebelum bertanya ke owner atau minta upload ulang project AyamKu. Kalau detail yang dibutuhkan ternyata tidak ada di sini (rangkuman ini tidak lengkap 100%), baru minta owner upload ulang project AyamKu (`Fried_Cichken.zip`) untuk detail spesifik itu — bukan untuk konteks umum yang harusnya sudah cukup dari sini.
