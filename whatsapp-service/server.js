// GAGI WhatsApp Notification Service
// ------------------------------------------------------------------------
// Service Node.js TERPISAH dari project GAGI utama (frontend React +
// Supabase). Tujuannya cuma satu: menjaga 1 koneksi WhatsApp Web (Baileys)
// tetap hidup pakai NOMOR KE-2 owner (login sekali via scan QR code di
// terminal, session-nya disimpan di folder `auth_info_baileys/` supaya
// tidak perlu scan ulang tiap restart), lalu mengekspos 1 endpoint HTTP
// `POST /send` yang dipanggil Supabase Edge Function (`midtrans-webhook`
// untuk order online yang baru `paid`, `public-checkout` untuk order cash)
// setiap kali ada pesanan customer yang perlu dikirimi notifikasi WA.
//
// Kenapa dipisah dari Supabase Edge Function: Baileys butuh koneksi
// WebSocket yang HIDUP TERUS + file session tersimpan di disk. Supabase
// Edge Function (Deno) sifatnya stateless & cold-start tiap request, jadi
// TIDAK BISA menjaga sesi WhatsApp tetap login di sana. Makanya sesi WA
// hidup di sini (hosting Node.js milik owner), Edge Function cuma
// nge-fetch endpoint ini.
//
// KEAMANAN:
// - Endpoint `/send` WAJIB kirim header `x-api-key` yang cocok dengan
//   `API_KEY` di .env sini (harus SAMA PERSIS dengan secret
//   `WHATSAPP_SERVICE_API_KEY` yang diset di Supabase Edge Function
//   Secrets) — tanpa ini siapa saja yang tahu URL service ini bisa pakai
//   nomor WA Anda untuk kirim pesan bebas ke siapapun.
// - Jangan expose port ini tanpa HTTPS di depannya (pakai reverse proxy /
//   platform hosting yang otomatis kasih TLS) — API key tetap kekirim
//   plain text kalau http biasa.
// - Folder `auth_info_baileys/` berisi SESI LOGIN WhatsApp Anda (setara
//   "password" akun itu) — JANGAN pernah commit ke git / upload ke tempat
//   publik. Sudah ditambahkan ke .gitignore di bawah, tapi tetap hati-hati.

import "dotenv/config";
import express from "express";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import { createClient } from "@supabase/supabase-js";
import { envMs, gapDelayMs, sleep, typingDelayMs } from "./pacing.js";
import { renderOrderCard, validateCard } from "./order-card.js";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

const PORT = Number(process.env.PORT ?? 3300);
const API_KEY = process.env.API_KEY;
// Durasi status "mengetik..." sebelum pesan benar-benar terkirim — anti-spam
// kosmetik, bikin pola kirim terasa natural. Bisa diubah lewat env var
// TYPING_DELAY_MS (dalam milidetik), default 3000 (3 detik).
const TYPING_DELAY_MS = Number(process.env.TYPING_DELAY_MS ?? 3000);

// Pola kirim "tidak seperti robot" (2026-09-20, lihat pacing.js). Semua
// bisa diubah lewat env var, tanpa ubah kode:
// - Durasi "mengetik..." sekarang TIDAK tetap: TYPING_DELAY_MS jadi
//   patokan dasar, ditambah sesuai panjang pesan dan diacak +-25%.
// - MESSAGE_GAP_MIN_MS / MESSAGE_GAP_MAX_MS: jeda ACAK antara 2 pesan
//   berurutan di antrian (default 4-10 detik).
// - OUTBOX_FLUSH_DELAY_MS: pesan tertunda (`wa_outbox`) TIDAK lagi dikirim
//   detik itu juga saat koneksi `open`, tapi ditunggu dulu (default 10
//   menit) — terutama penting tepat setelah perangkat baru ditautkan.
// - OUTBOX_FLUSH_MAX_PER_RUN: maksimal berapa pesan tertunda dikirim
//   per putaran (default 10, sebelumnya 50 sekaligus). Kalau masih ada
//   sisa, putaran berikutnya dijadwalkan otomatis.
const MESSAGE_GAP_MIN_MS = envMs(process.env.MESSAGE_GAP_MIN_MS, 4000);
const MESSAGE_GAP_MAX_MS = envMs(process.env.MESSAGE_GAP_MAX_MS, 10000);
const OUTBOX_FLUSH_DELAY_MS = envMs(process.env.OUTBOX_FLUSH_DELAY_MS, 10 * 60 * 1000);
const OUTBOX_FLUSH_MAX_PER_RUN = Math.max(
  1,
  Math.floor(envMs(process.env.OUTBOX_FLUSH_MAX_PER_RUN, 10)),
);

if (!API_KEY) {
  console.error(
    "[FATAL] Env var API_KEY belum diset (lihat .env.example). Service tidak dijalankan.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------
// Modul 15e — Antrian retry `wa_outbox` (Supabase)
// ---------------------------------------------------------------------
// Kenapa BUKAN polling terjadwal (mis. cron tiap N menit): boros
// egress/query Supabase untuk skala 1 toko (GAGI), karena polling akan
// tetap jalan terus-menerus walau tidak ada apa-apa buat diproses selama
// service ini normal/hidup. Sebagai gantinya, `flushPendingOutbox()` HANYA
// dipanggil pas event `connection.update` melaporkan `connection === "open"`
// (lihat di bawah) — yaitu PERSIS momen koneksi WA baru bisa dipakai kirim
// pesan lagi, baik setelah down beneran, restart service, maupun cuma
// jaringan putus sebentar. Jadi query ke `wa_outbox` cuma terjadi kalau
// memang ada kemungkinan ada yang perlu di-retry, bukan berkala.
//
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY opsional: kalau salah satu belum
// diset, fitur outbox ini dilewati (di-log sekali saat boot) — service WA
// tetap jalan normal seperti sebelumnya (fitur retry ini murni tambahan,
// tidak mengubah jalur kirim langsung `/send` & `/send-batch` yang sudah
// ada). `SERVICE_ROLE_KEY` (bukan anon key) WAJIB dipakai karena `wa_outbox`
// sengaja tidak punya RLS policy sama sekali (lihat migration 0010) — cuma
// service_role yang boleh baca/tulis.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Batas berapa kali 1 baris outbox dicoba ulang sebelum ditandai `failed`
// (berhenti dicoba lagi otomatis) — supaya nomor yang memang selalu gagal
// (mis. tidak terdaftar WA) tidak nyoba selamanya tiap kali service
// reconnect. Bisa diubah lewat env var, default 5.
const OUTBOX_MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

if (!supabaseAdmin) {
  console.warn(
    "[wa-outbox] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY belum diset di .env — fitur retry " +
      "otomatis (wa_outbox) dilewati. Notifikasi yang gagal saat service ini down TIDAK akan " +
      "di-retry otomatis (perilaku lama). Lihat whatsapp-service/README.md langkah 6 untuk setup.",
  );
}

let flushInProgress = false; // guard sederhana biar tidak dobel flush kalau connection.update "open" nembak beruntun

// Flush outbox sengaja DITUNDA (bukan langsung saat `open`): kalau perangkat
// baru saja ditautkan (mis. setelah hapus `auth_info_baileys` untuk scan QR
// ulang) sementara ada pesan tertunda, menembak belasan-puluhan pesan sekaligus
// dari perangkat yang baru berumur beberapa detik adalah pola yang sangat
// mencurigakan di mata WhatsApp. `open` yang beruntun (reconnect) cukup
// mereset timer, bukan menumpuk banyak timer.
let outboxFlushTimer = null;
function scheduleOutboxFlush(delayMs) {
  if (!supabaseAdmin) return; // fitur retry belum dikonfigurasi
  if (outboxFlushTimer) clearTimeout(outboxFlushTimer);
  outboxFlushTimer = setTimeout(() => {
    outboxFlushTimer = null;
    flushPendingOutbox();
  }, delayMs);
}
function cancelOutboxFlush() {
  if (outboxFlushTimer) {
    clearTimeout(outboxFlushTimer);
    outboxFlushTimer = null;
  }
}

const logger = pino({ level: "warn" }); // Baileys butuh logger pino, level dikecilkan biar log tidak berisik

let waSocket = null;
let waReady = false; // true kalau koneksi WA sudah "open" (siap kirim pesan)

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Nomor WA ke-2 login via SCAN QR CODE (bukan pairing code) — QR
    // dicetak ke terminal/log server tiap kali dibutuhkan (pertama kali
    // jalan, atau kalau sesi lama invalid/logout).
    printQRInTerminal: false, // kita cetak manual di bawah biar bisa kasih pesan tambahan
  });

  waSocket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== SCAN QR CODE INI DENGAN WHATSAPP (NOMOR KE-2) ===");
      console.log("WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat > scan QR di bawah:\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log("\n(QR berlaku ±20 detik, kalau kelewat akan otomatis muncul QR baru)\n");
    }

    if (connection === "open") {
      waReady = true;
      console.log("[whatsapp] Terhubung! Nomor WA ke-2 siap kirim notifikasi.");
      // Modul 15e: momen ini (baru `open`) adalah sinyal paling tepat buat
      // "nanti coba kirim lagi yang sempat ketunda" — dijadwalkan dari sini
      // (bukan berkala) supaya tidak ada beban query Supabase selain pas
      // memang dibutuhkan. SEJAK 2026-09-20 flush-nya DITUNDA
      // `OUTBOX_FLUSH_DELAY_MS` (default 10 menit), tidak langsung jalan:
      // lihat catatan di `scheduleOutboxFlush()`. `flushPendingOutbox()`
      // sendiri no-op kalau `supabaseAdmin` belum dikonfigurasi.
      scheduleOutboxFlush(OUTBOX_FLUSH_DELAY_MS);
    }

    if (connection === "close") {
      waReady = false;
      // Koneksi putus sebelum jadwal flush tiba -> batalkan; `open`
      // berikutnya akan menjadwalkan ulang dari awal.
      cancelOutboxFlush();
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.warn(
        "[whatsapp] Koneksi terputus. Status:",
        statusCode,
        "— reconnect otomatis?",
        shouldReconnect,
      );
      if (shouldReconnect) {
        // Reconnect otomatis (mis. jaringan sempat putus) — TIDAK perlu
        // scan ulang QR selama sesi masih valid (belum logout manual dari
        // HP dan folder auth_info_baileys masih ada & tidak rusak).
        setTimeout(startWhatsApp, 3000);
      } else {
        console.error(
          "[whatsapp] Sesi LOGOUT (dari HP, atau sesi invalid). Hapus folder " +
            "'auth_info_baileys' lalu restart service ini untuk scan QR baru.",
        );
      }
    }
  });
}

startWhatsApp().catch((err) => {
  console.error("[whatsapp] Gagal start koneksi WhatsApp:", err);
});

// ---------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------
const app = express();
app.use(express.json());

// Middleware auth sederhana — cek header x-api-key sebelum apapun.
function requireApiKey(req, res, next) {
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "API key tidak valid/tidak ada" });
  }
  next();
}

// Health check — dipakai untuk cek service ini hidup & WA sudah connect,
// bisa dipakai monitoring hosting (uptime check) tanpa perlu API key.
app.get("/health", (_req, res) => {
  res.json({ ok: true, whatsapp_ready: waReady });
});

// Endpoint utama yang dipanggil Supabase Edge Function.
// Body: { "phone": "62812xxxxxxx", "message": "teks pesan" }
// `phone` HARUS sudah dalam format 62xxxxxxxxxx (tanpa "+", tanpa "0" di
// depan) — normalisasi dilakukan di sisi Edge Function
// (`_shared/whatsapp.ts`), bukan di sini, supaya logic nomor cuma ada di
// satu tempat.

// Logic kirim 1 pesan (cek terdaftar WA -> jeda "mengetik..." -> kirim) —
// DIPINDAH ke fungsi terpisah (sebelumnya isi langsung handler `/send`)
// supaya bisa DIPAKAI BARENG oleh worker antrian batch (`processQueue()`,
// Modul 15b) tanpa duplikasi logic. Melempar Error kalau gagal — pemanggil
// (baik handler `/send` maupun `processQueue()`) yang tentukan bagaimana
// menanganinya. Error nomor tidak terdaftar ditandai `err.notRegistered`
// supaya handler `/send` tetap bisa balas 422 (beda dari 502 gagal kirim
// biasa) tanpa perlu cek isi pesan errornya.
//
// KARTU PESANAN (gambar): kalau `card` diisi, yang dikirim adalah GAMBAR PNG
// (ringkasan pesanan + QR ke `/order/:token`, dibuat `order-card.js` pakai
// Satori + resvg), bukan teks. `message` TETAP wajib dan berfungsi sebagai
// CADANGAN: kalau pembuatan gambar gagal (data rusak/error render) atau
// kirim gambarnya gagal, yang dikirim adalah `message` sebagai teks biasa
// (isinya sengaja TANPA link, lihat `buildCustomerWhatsAppFallback()` di
// `_shared/whatsapp.ts`). Gambar dirender SEBELUM jeda "mengetik...", jadi
// waktu render (~100 ms) tidak mengubah pola waktu kirim.
async function sendOneMessage(phone, message, card) {
  const jid = `${phone}@s.whatsapp.net`;

  // Cek dulu nomor itu memang terdaftar di WhatsApp — biar tidak dianggap
  // sukses padahal nomor tidak valid/tidak pakai WA.
  const [result] = await waSocket.onWhatsApp(jid);
  if (!result?.exists) {
    const err = new Error("Nomor tidak terdaftar di WhatsApp");
    err.notRegistered = true;
    throw err;
  }

  let png = null;
  if (card) {
    try {
      png = await renderOrderCard(card);
    } catch (renderErr) {
      console.error(
        "[whatsapp] gagal membuat gambar kartu pesanan, kirim teks cadangan ke",
        phone,
        "-",
        renderErr?.message ?? renderErr,
      );
    }
  }

  // Pencegahan dianggap spam bot: tunjukkan status "mengetik..." dulu
  // beberapa detik sebelum pesan benar-benar terkirim — pola pengiriman
  // jadi terasa lebih natural (mirip orang beneran ngetik), bukan bot
  // yang langsung tembak pesan instan. TYPING_DELAY_MS bisa diubah lewat
  // env var kalau owner mau durasi beda, default 3 detik. Jeda yang SAMA
  // dipakai untuk semua jalur kirim (`/send`, `/send-card`, `/send-batch`,
  // dan retry outbox) supaya perilaku "natural" ini konsisten.
  try {
    await waSocket.sendPresenceUpdate("composing", jid);
    await sleep(typingDelayMs(message, TYPING_DELAY_MS));
    await waSocket.sendPresenceUpdate("paused", jid);
  } catch (presenceErr) {
    // Best-effort — kalau gagal set status "mengetik" (jarang terjadi),
    // JANGAN batalkan pengiriman pesan sungguhan karena ini cuma
    // kosmetik anti-spam, bukan hal wajib.
    console.warn("[whatsapp] gagal set presence 'composing', lanjut kirim pesan:", presenceErr);
  }

  if (png) {
    try {
      await waSocket.sendMessage(jid, {
        image: png,
        mimetype: "image/png",
        // Caption opsional (mis. instruksi bayar cash) — TANPA link.
        ...(card.caption ? { caption: card.caption } : {}),
      });
      return;
    } catch (imageErr) {
      console.error(
        "[whatsapp] gagal kirim gambar kartu, coba kirim teks cadangan ke",
        phone,
        "-",
        imageErr?.message ?? imageErr,
      );
    }
  }

  await waSocket.sendMessage(jid, { text: message });
}

// Modul 15e — proses ulang baris `wa_outbox` berstatus 'pending', dipanggil
// dari event `connection.update` ("open") di atas. Diambil terurut dari yang
// paling lama (`order("created_at")`) supaya urutan kirim tetap masuk akal
// (mis. pesan customer yang di-insert lebih dulu daripada pesan admin di
// batch yang sama tetap coba dikirim lebih dulu). Dibatasi `.limit(50)` per
// panggilan (bukan ambil semua sekaligus) — kalau outbox-nya sangat panjang
// (jarang terjadi di skala GAGI), sisanya otomatis kepanggil lagi lain kali
// koneksi reconnect, tidak nge-block proses "open" terlalu lama.
async function flushPendingOutbox() {
  if (!supabaseAdmin) return; // fitur retry belum dikonfigurasi, lewati diam-diam
  if (flushInProgress) return; // sudah ada flush lain jalan, jangan dobel
  flushInProgress = true;

  try {
    const { data: rows, error: fetchError } = await supabaseAdmin
      .from("wa_outbox")
      // select("*") (bukan daftar kolom) supaya flush tetap jalan walau
      // migration 0013 (kolom `payload`) belum dijalankan — baris lama
      // tanpa payload otomatis dikirim sebagai teks seperti dulu.
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(OUTBOX_FLUSH_MAX_PER_RUN);

    if (fetchError) {
      console.error("[wa-outbox] gagal ambil antrian pending:", fetchError);
      return;
    }
    if (!rows || rows.length === 0) return; // tidak ada yang perlu di-retry, ini kasus normal

    console.log(`[wa-outbox] ditemukan ${rows.length} pesan pending, mencoba kirim ulang...`);

    for (const [rowIndex, row] of rows.entries()) {
      // Jeda ACAK antar pesan tertunda (bukan ditembak beruntun) — lihat
      // pacing.js. Tidak ada jeda sebelum pesan pertama.
      if (rowIndex > 0) {
        await sleep(gapDelayMs(MESSAGE_GAP_MIN_MS, MESSAGE_GAP_MAX_MS));
      }

      // Koneksi WA bisa saja putus lagi DI TENGAH proses flush (mis. baru
      // "open" lalu langsung "close" lagi) — cek ulang tiap iterasi, bukan
      // cuma sekali di awal, supaya tidak nyoba kirim ke socket yang sudah
      // tidak siap. Sisa baris yang belum sempat diproses tetap 'pending'
      // di DB, otomatis kepanggil lagi saat reconnect berikutnya.
      if (!waReady || !waSocket) {
        console.warn("[wa-outbox] koneksi WA putus lagi di tengah flush, sisanya dilanjut nanti.");
        break;
      }

      try {
        await sendOneMessage(row.phone, row.message, row.payload?.card);
        await supabaseAdmin
          .from("wa_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`[wa-outbox] pesan pending ke ${row.phone} berhasil terkirim.`);
      } catch (err) {
        const attempts = (row.attempts ?? 0) + 1;
        const giveUp = attempts >= OUTBOX_MAX_ATTEMPTS;
        await supabaseAdmin
          .from("wa_outbox")
          .update({
            attempts,
            last_error: err?.message ?? String(err),
            // Kalau nomor memang tidak terdaftar WA (`err.notRegistered`),
            // tidak ada gunanya di-retry sama sekali walau baru percobaan
            // pertama — langsung tandai 'failed'.
            status: err?.notRegistered || giveUp ? "failed" : "pending",
          })
          .eq("id", row.id);
        console.error(
          `[wa-outbox] gagal kirim ulang ke ${row.phone} (percobaan ke-${attempts}` +
            (giveUp ? ", MENYERAH, ditandai 'failed')" : ")") +
            ":",
          err?.message ?? err,
        );
      }
    }
    // Kalau jumlah baris yang diambil PAS sebesar batas per putaran, kemungkinan
    // masih ada sisa pending -> jadwalkan putaran berikutnya (jeda yang sama
    // dengan flush pertama), selama koneksi masih tersambung. Kalau koneksi
    // putus, `open` berikutnya yang menjadwalkan ulang.
    if (rows.length >= OUTBOX_FLUSH_MAX_PER_RUN && waReady) {
      scheduleOutboxFlush(OUTBOX_FLUSH_DELAY_MS);
    }
  } catch (err) {
    console.error("[wa-outbox] error tak terduga saat flush:", err);
  } finally {
    flushInProgress = false;
  }
}

app.post("/send", requireApiKey, async (req, res) => {
  const { phone, message } = req.body ?? {};

  if (!phone || typeof phone !== "string" || !/^62\d{8,13}$/.test(phone)) {
    return res.status(400).json({ error: "Field 'phone' tidak valid (harus format 62xxxxxxxxxx)" });
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Field 'message' wajib diisi (string)" });
  }
  if (!waReady || !waSocket) {
    return res.status(503).json({
      error: "Koneksi WhatsApp belum siap (belum login/sedang reconnect) — coba lagi sebentar.",
    });
  }

  try {
    await sendOneMessage(phone, message);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[whatsapp] gagal kirim pesan ke", phone, err);
    const status = err?.notRegistered ? 422 : 502;
    return res.status(status).json({ error: err?.message ?? "Gagal kirim pesan WhatsApp" });
  }
});

// Kirim KARTU PESANAN sebagai gambar ke 1 nomor (sinkron, menunggu terkirim).
// Body: {
//   "phone": "62812xxxxxxx",
//   "message": "teks cadangan TANPA link (dikirim kalau gambar gagal dibuat)",
//   "card": {
//     "namaCustomer": "Budi Santoso",
//     "items": [{ "nama_produk": "Gabin Coklat", "qty": 2 }],
//     "total": 10000,
//     "orderToken": "<uuid order_token>",
//     "orderUrl": "https://situs-anda.com/order/<uuid order_token>",  // isi QR
//     "caption": "opsional, teks di bawah gambar (tanpa link)"
//   }
// }
// Untuk kirim banyak sekaligus dengan jeda (customer + admin), pakai
// `/send-batch` dengan field `card` di item-nya — jalur itu yang dipakai
// Edge Function; endpoint ini berguna untuk tes manual.
app.post("/send-card", requireApiKey, async (req, res) => {
  const { phone, message, card } = req.body ?? {};

  if (!phone || typeof phone !== "string" || !/^62\d{8,13}$/.test(phone)) {
    return res.status(400).json({ error: "Field 'phone' tidak valid (harus format 62xxxxxxxxxx)" });
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Field 'message' wajib diisi (teks cadangan)" });
  }
  const cardError = validateCard(card);
  if (cardError) {
    return res.status(400).json({ error: `Field 'card' tidak valid: ${cardError}` });
  }
  if (!waReady || !waSocket) {
    return res.status(503).json({
      error: "Koneksi WhatsApp belum siap (belum login/sedang reconnect) — coba lagi sebentar.",
    });
  }

  try {
    await sendOneMessage(phone, message, card);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[whatsapp] gagal kirim kartu ke", phone, err);
    const status = err?.notRegistered ? 422 : 502;
    return res.status(status).json({ error: err?.message ?? "Gagal kirim kartu WhatsApp" });
  }
});

// ---------------------------------------------------------------------
// Modul 15b — Antrian batch (kirim ke banyak nomor sekaligus, BERURUTAN
// dengan jeda "mengetik..." di antaranya, diproses ASYNC di background).
//
// Kenapa perlu endpoint terpisah dari `/send` di atas (bukan Edge Function
// yang panggil `/send` berkali-kali secara berurutan): Edge Function
// (Deno, request/response singkat) yang menunggu N pesan terkirim
// satu-satu dengan jeda 3 detik masing-masing bisa membuat response
// `midtrans-webhook`/`public-checkout` lambat & berisiko timeout webhook
// Midtrans kalau nomor admin banyak (`_shared/whatsapp.ts`,
// `sendWhatsAppBatch()` — dikonfirmasi owner 2026-09-15, opsi (b)).
// Jadi endpoint ini cuma MENGANTRIKAN pesan (balas cepat, `202`), lalu
// worker di bawah (`processQueue()`) yang benar-benar mengirim satu per
// satu di background, urutan tetap sesuai urutan array yang dikirim
// (index 0 = customer, sesuai kontrak `_shared/whatsapp.ts`).
//
// Antrian ini in-memory (array biasa) — SENGAJA sederhana, bukan queue
// dengan storage/redis: skala GAGI (1 toko) tidak butuh itu, dan kalau
// service ini restart (`pm2 restart`/deploy ulang) sementara antrian
// belum habis, sisa antrian yang belum terkirim akan hilang begitu saja
// (BUKAN pending yang otomatis lanjut setelah restart) — dicatat sebagai
// keterbatasan yang disadari, bukan bug.
const messageQueue = [];
let queueProcessing = false;

function enqueueMessages(items) {
  messageQueue.push(...items);
  if (!queueProcessing) {
    queueProcessing = true;
    processQueue().finally(() => {
      queueProcessing = false;
    });
  }
}

async function processQueue() {
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    if (!waReady || !waSocket) {
      console.warn(
        "[whatsapp] antrian batch: koneksi WA belum siap, pesan ke",
        item.phone,
        "dilewati (tidak di-retry otomatis).",
      );
      continue;
    }
    try {
      await sendOneMessage(item.phone, item.message, item.card);
      console.log("[whatsapp] antrian batch: pesan ke", item.phone, "terkirim.");
    } catch (err) {
      // Best-effort per pesan — 1 nomor gagal (tidak terdaftar WA/dll)
      // TIDAK menghentikan antrian, lanjut ke pesan berikutnya.
      console.error("[whatsapp] antrian batch: gagal kirim ke", item.phone, err?.message ?? err);
    }
    // Jeda ACAK sebelum pesan berikutnya (kalau masih ada) — pesan tidak
    // ditembak beruntun rapat. Lihat pacing.js.
    if (messageQueue.length > 0) {
      await sleep(gapDelayMs(MESSAGE_GAP_MIN_MS, MESSAGE_GAP_MAX_MS));
    }
  }
}

// Body: { "messages": [{ "phone": "62xxx", "message": "teks/cadangan", "card"?: {...} }, ...] }
// `card` (opsional) = data kartu pesanan -> dikirim sebagai GAMBAR, lihat /send-card.
// Balas SEGERA setelah antrian diisi (tidak menunggu pesan benar-benar
// terkirim) — lihat catatan arsitektur di atas `messageQueue`.
app.post("/send-batch", requireApiKey, (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Field 'messages' wajib diisi (array, minimal 1 item)" });
  }

  const invalid = messages.filter(
    (m) =>
      !m ||
      typeof m.phone !== "string" ||
      !/^62\d{8,13}$/.test(m.phone) ||
      typeof m.message !== "string",
  );
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `${invalid.length} item di 'messages' tidak valid (phone harus format 62xxxxxxxxxx, message wajib string)`,
    });
  }

  // `card` yang datanya rusak TIDAK menolak seluruh batch (pesan admin di
  // batch yang sama tetap harus terkirim) — kartunya saja dibuang, pesan
  // itu dikirim sebagai teks cadangan (`message`).
  enqueueMessages(
    messages.map((m) => {
      let card;
      if (m.card !== undefined && m.card !== null) {
        const cardError = validateCard(m.card);
        if (cardError) {
          console.warn(`[whatsapp] card ke ${m.phone} tidak valid (${cardError}), kirim teks cadangan.`);
        } else {
          card = m.card;
        }
      }
      return { phone: m.phone, message: m.message, card };
    }),
  );
  return res.status(202).json({ ok: true, queued: messages.length });
});

app.listen(PORT, () => {
  console.log(`[http] GAGI WhatsApp service jalan di port ${PORT}`);
});
