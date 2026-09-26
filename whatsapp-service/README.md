# GAGI WhatsApp Service

Service Node.js kecil untuk kirim notifikasi WhatsApp ke customer GAGI
begitu pesanannya `paid` (online) atau tercatat cash — pakai nomor WA ke-2
(login via scan QR, library [Baileys](https://github.com/WhiskeySockets/Baileys)).

Ini **project terpisah** dari `gagi/` (frontend React + Supabase) — dijalankan
di hosting Node.js Anda sendiri, BUKAN di Netlify/Supabase.

## 1. Setup awal

```bash
cd whatsapp-service
npm install
cp .env.example .env
```

Edit `.env`:
- `API_KEY` — isi string acak yang panjang, mis. hasil `openssl rand -hex 32`.
  **Simpan baik-baik**, nanti dipasang juga sebagai secret
  `WHATSAPP_SERVICE_API_KEY` di Supabase (lihat langkah 4).
- `PORT` — port yang mau dipakai (default 3300), sesuaikan kalau hosting
  Anda sudah menentukan port tertentu.

## 2. Jalankan & scan QR

```bash
npm start
```

Begitu pertama kali jalan (atau kalau sesi lama invalid), QR code akan
muncul di terminal/log server:

```
=== SCAN QR CODE INI DENGAN WHATSAPP (NOMOR KE-2) ===
WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat > scan QR di bawah:

[QR code ASCII di sini]
```

Buka WhatsApp di HP nomor ke-2 → **Perangkat Tertaut** → **Tautkan
Perangkat** → scan QR itu. Setelah berhasil, akan muncul log:

```
[whatsapp] Terhubung! Nomor WA ke-2 siap kirim notifikasi.
```

Sesi login tersimpan di folder `auth_info_baileys/` — **selama folder ini
tidak dihapus dan Anda tidak logout manual dari HP**, restart service
(`npm start` lagi / server reboot) TIDAK perlu scan ulang QR.

> **Jangan** commit folder `auth_info_baileys/` ke git atau upload ke
> tempat publik manapun — isinya setara kredensial login WhatsApp Anda.

## 3. Jaga service tetap jalan (jangan cuma `npm start` di terminal biasa)

Supaya tidak mati kalau terminal/SSH ditutup, pakai process manager, contoh
dengan `pm2` (paling umum untuk hosting Node.js VPS):

```bash
npm install -g pm2
pm2 start server.js --name gagi-whatsapp
pm2 save
pm2 startup   # ikuti instruksi yang muncul supaya auto-start saat server reboot
```

Kalau hosting Anda berupa platform PaaS (Railway/Render/dst), biasanya
sudah otomatis menjaga proses tetap jalan & restart kalau crash — tinggal
deploy folder ini sebagai 1 service, pastikan `PORT` env var-nya dibaca
platform dengan benar (banyak platform PaaS set `PORT` otomatis, kode di
`server.js` sudah baca `process.env.PORT`).

## 4. Sambungkan ke Supabase (Edge Function Secrets)

Service ini harus bisa diakses lewat URL publik (HTTPS) oleh Supabase Edge
Function. Set 2 secret berikut di project Supabase (`supabase secrets set`
atau lewat Dashboard → Project Settings → Edge Functions → Secrets):

```bash
supabase secrets set WHATSAPP_SERVICE_URL=https://domain-hosting-anda.com
supabase secrets set WHATSAPP_SERVICE_API_KEY=<isi sama persis dengan API_KEY di .env service ini>
```

Lalu redeploy 2 function yang memanggilnya (kodenya berubah, wajib redeploy):

```bash
supabase functions deploy midtrans-webhook
supabase functions deploy public-checkout
```

## 5. Test manual

```bash
curl -X POST https://domain-hosting-anda.com/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY Anda>" \
  -d '{"phone":"6281234567890","message":"Tes notifikasi GAGI"}'
```

Kalau berhasil, muncul `{"ok":true}` dan pesan masuk ke WhatsApp nomor
tersebut dari nomor WA ke-2 Anda.

Cek juga `GET /health` (tanpa perlu API key) untuk lihat status koneksi:

```bash
curl https://domain-hosting-anda.com/health
# {"ok":true,"whatsapp_ready":true}
```

## 6. (Opsional, disarankan) Nyalakan retry otomatis kalau service ini down

Tanpa langkah ini, kalau service WA sedang down/tidak bisa diakses pas ada
order baru, notifikasinya **hilang permanen** — tidak pernah dicoba lagi.
Dengan setup ini, notifikasi yang gagal kirim disimpan sementara di database
(tabel `wa_outbox`, dibuat lewat migration `0010_wa_outbox.sql` di project
utama), lalu **otomatis dikirim ulang oleh service ini sendiri** persis pas
koneksi WhatsApp-nya balik hidup lagi (bukan dicoba berkala tiap sekian
menit — jadi tidak nambah beban database selama service normal).

Langkah:

1. Jalankan migration `0010_wa_outbox.sql` di project Supabase utama kalau
   belum (`supabase db push`, atau lewat Dashboard > SQL Editor).
2. Ambil `SUPABASE_URL` dan `service_role` key dari Dashboard Supabase >
   Project Settings > API.
3. Isi keduanya di `.env` service ini (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`) — lihat penjelasan lengkap & peringatan
   keamanan di `.env.example`.
4. Restart service ini (`pm2 restart gagi-whatsapp` atau setara).

Cek log saat boot:

```
[wa-outbox] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY belum diset ...
```

Kalau pesan itu **tidak muncul**, berarti fitur retry sudah aktif. Cara
tes: matikan sementara internet/proses service ini, buat 1 order baru di
website (sampai muncul log gagal kirim WA di sisi Edge Function/Supabase
karena service tidak terjangkau), lalu nyalakan lagi service ini — dalam
beberapa detik setelah muncul log `[whatsapp] Terhubung!`, harusnya langsung
muncul log `[wa-outbox] ditemukan N pesan pending, mencoba kirim ulang...`
dan pesan yang tadi gagal otomatis terkirim.

## 7. Kenapa nomor bisa ter-logout sendiri (dan apa yang bisa/tidak bisa dilakukan)

Kalau log menampilkan `401` + `conflict` + `device_removed` padahal kamu tidak
mencabut perangkat dari HP, itu artinya **server WhatsApp yang memutus
perangkat tertaut itu**. Service ini memakai Baileys (library tidak resmi), jadi
hal seperti ini bisa terjadi dan tidak sepenuhnya bisa dicegah dari sisi kode.
Yang sudah diketahui:

- **Error `463` = pembatasan "reach-out" dari WhatsApp**: pesan ke kontak yang
  belum pernah berinteraksi dengan nomor pengirim (kontak "dingin") dibatasi
  di sisi server, terutama untuk nomor/perangkat yang baru. Token yang
  melonggarkannya hanya datang dari si penerima (mis. dia yang chat duluan).
  **Jeda acak tidak menghilangkan ini.** Cara paling ampuh: biarkan
  customer/admin chat ke nomor toko lebih dulu, atau simpan nomor toko di
  kontak mereka dan pernah saling berbalas.
- **`device_removed` juga banyak dilaporkan di Baileys** pada berbagai nomor,
  kadang beberapa menit setelah pairing tanpa ada pengiriman apa pun. Kalau
  sesi tetap mati padahal service TIDAK mengirim pesan sama sekali selama
  1-2 jam setelah scan QR, penyebabnya kemungkinan versi library/protokol,
  bukan pola kirim. Coba `npm install @whiskeysockets/baileys@latest`.

Yang dilakukan kode ini untuk mengurangi risiko (bukan jaminan):

| Pengaturan | Default | Fungsi |
| --- | --- | --- |
| `TYPING_DELAY_MS` | 3000 | Patokan dasar durasi "mengetik...", ditambah sesuai panjang pesan dan diacak +-25% |
| `MESSAGE_GAP_MIN_MS` / `MESSAGE_GAP_MAX_MS` | 4000 / 10000 | Jeda ACAK antar pesan di antrian |
| `OUTBOX_FLUSH_DELAY_MS` | 600000 | Pesan tertunda (`wa_outbox`) baru dikirim ulang 10 menit setelah koneksi tersambung, bukan langsung |
| `OUTBOX_FLUSH_MAX_PER_RUN` | 10 | Maksimal pesan tertunda per putaran (dulu 50 sekaligus) |

Tips operasional setelah scan QR baru:

1. **Jangan langsung kirim apa pun.** Biarkan tersambung tenang 1-2 jam.
2. **Tes pertama hanya ke nomor milikmu sendiri** yang sudah pernah chat dengan
   nomor toko, jangan langsung ke customer.
3. **Jangan berkali-kali hapus `auth_info_baileys` lalu scan ulang** dalam waktu
   dekat. Kalau logout terus, hentikan 24 jam dulu.
4. Untuk volume yang serius/andal, satu-satunya jalur bebas risiko banned adalah
   **WhatsApp Business Cloud API resmi** (berbayar per percakapan).

## 8. Kartu pesanan (gambar + QR) untuk customer

Pesan ke **customer** dikirim sebagai **gambar** (kartu bermerek berisi
ringkasan pesanan + QR code), bukan teks berisi link. QR-nya membuka
`/order/:order_token` milik customer itu; di pesan **tidak ada link mentah**.
Pesan ke admin teks saja (tanpa link).

Gambar dibuat di service ini oleh `order-card.js` memakai
[Satori](https://github.com/vercel/satori) (layout → SVG) +
[resvg-js](https://github.com/yisibl/resvg-js) (SVG → PNG) + `qrcode`. Tidak
butuh browser headless; font Poppins dibaca dari folder `fonts/`, jadi tidak
perlu font terpasang di server. Satu kartu ±100 ms, PNG ±220-250 KB (2000x1000 px).

### Caption (teks di bawah gambar)

Field `card.caption` (opsional) dikirim sebagai teks di bawah gambar, tanpa link. Isinya ditentukan Edge Function pemanggil, bukan service ini:

- **Order online** (`midtrans-webhook`): sapaan "Halo {nama customer}", konfirmasi pembayaran, dan penjelasan bahwa QR pada gambar membuka halaman pesanan di website, sedangkan yang ditunjukkan ke admin saat pesanan diantar adalah QR yang ada di halaman website tersebut.
- **Order cash** (`public-checkout`): instruksi bayar tunai.

Kalau `caption` tidak diisi, gambar terkirim polos tanpa teks. Batas caption WhatsApp 1024 karakter. Untuk mengubah kalimatnya, edit argumen `caption` di Edge Function terkait lalu redeploy function itu (service ini tidak perlu diubah).

### Lihat / ubah tampilan

```bash
npm run card:preview   # hasil PNG di folder card-preview/ (tanpa perlu WhatsApp)
```

Semua yang biasa diubah ada di objek `CARD_CONFIG` paling atas
`order-card.js`: nama brand, kalimat sapaan (`{nama}` diganti nama customer),
label "Product:"/"Total:", teks di bawah QR, jumlah produk yang ditampilkan
(`maxItemsShown`, sisanya jadi "+N produk lainnya"), dan warna gradien/teks/QR.
Ubah layout = ubah fungsi `buildCardTree()`. Ukuran font daftar produk mengecil
otomatis kalau baris banyak, nama produk/customer yang terlalu panjang dipotong
dengan "…". Font lain: taruh file `.ttf`/`.otf`/`.woff` (bukan `.woff2`) di
`fonts/` dan daftarkan di array `fonts` pada `order-card.js`.

### Endpoint

- `POST /send-card` — 1 nomor, sinkron (berguna untuk tes manual).
- `POST /send-batch` — item boleh punya field `card`; itulah yang dipakai
  Edge Function (customer di indeks 0 dengan `card`, admin teks biasa).

Kontrak `card`: `{ namaCustomer, items: [{nama_produk, qty}], total,
orderToken, orderUrl, caption? }`. `orderUrl` = isi QR. `message` di request
**wajib** dan berfungsi sebagai teks cadangan (tanpa link).

```bash
curl -X POST https://domain-hosting-anda.com/send-card \
  -H "Content-Type: application/json" -H "x-api-key: <API_KEY Anda>" \
  -d '{
    "phone": "6281234567890",
    "message": "Halo Budi, pesananmu sudah kami terima. Total: Rp10.000",
    "card": {
      "namaCustomer": "Budi Santoso",
      "items": [{"nama_produk": "Gabin Coklat", "qty": 2}],
      "total": 10000,
      "orderToken": "3f2a9c1e-1111-4222-8333-444455556666",
      "orderUrl": "https://situs-anda.com/order/3f2a9c1e-1111-4222-8333-444455556666"
    }
  }'
```

### Kalau gambar gagal

Kalau gambar gagal dibuat (data rusak/error render) atau gagal terkirim,
service mengirim `message` sebagai teks biasa (tanpa link; QR/link pesanan
tetap ada di email konfirmasi). `card` yang datanya tidak valid di
`/send-batch` tidak menolak seluruh batch — hanya pesan itu yang jatuh ke teks.
Pesan yang tertunda di `wa_outbox` juga tetap dikirim sebagai gambar
(data kartunya disimpan di kolom `payload`, **migration `0013`**).

### Deploy

1. Jalankan migration `0013_wa_outbox_payload.sql` **lebih dulu**.
2. Unggah `server.js`, `order-card.js`, `preview-card.js`, `package.json`, dan
   folder `fonts/`, lalu `npm install` (dependency baru: `satori`,
   `@resvg/resvg-js`, `qrcode`) dan restart service.
3. Redeploy `midtrans-webhook` dan `public-checkout`.

> `@resvg/resvg-js` membawa binary bawaan per OS/CPU lewat npm (bukan
> kompilasi di server). Kalau hosting memakai Alpine/musl atau arsitektur
> tidak umum dan `npm install` gagal memasang binary-nya, sebutkan OS/CPU
> hosting Anda — ada varian paket yang sesuai.

## Catatan penting

- **Ini pakai protokol WhatsApp Web tidak resmi (Baileys)**, bukan
  WhatsApp Business API resmi — risiko: nomor bisa kena banned WhatsApp
  kalau kirim pesan dalam volume besar/terlalu cepat/terindikasi spam.
  Untuk skala 1 toko/sekolah (GAGI) risikonya rendah, tapi tetap disadari
  ini bukan jalur resmi Meta.
- Kalau nomor ke-2 logout (dari HP, atau WhatsApp mendeteksi sesi
  bermasalah), notifikasi WA akan gagal terus sampai di-scan ulang — cek
  log service (`pm2 logs gagi-whatsapp`) untuk lihat status.
- Kegagalan kirim WA (service down/nomor invalid) **tidak menggagalkan**
  checkout maupun email konfirmasi — keduanya tetap jalan seperti biasa
  (lihat komentar `_shared/whatsapp.ts` di project utama).
