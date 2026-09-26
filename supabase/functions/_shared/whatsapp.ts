// _shared/whatsapp.ts — Notifikasi WhatsApp ke CUSTOMER (bukan admin),
// ditambahkan sebagai pelengkap email konfirmasi yang sudah ada
// (`sendPaidOrderEmails` di `midtrans-webhook`, `sendCashOrderEmails` di
// `public-checkout`). Diminta owner langsung: notifikasi ke customer yang
// sudah bayar/checkout, isinya mirip email, tapi lewat WhatsApp — kirim ke
// nomor yang customer isi sendiri di form checkout (`orders.no_telp`),
// dari NOMOR KE-2 owner yang login via scan QR code.
//
// ARSITEKTUR (kenapa lewat HTTP ke service eksternal, bukan library
// WhatsApp langsung di sini): koneksi WhatsApp (Baileys) butuh WebSocket
// yang HIDUP TERUS + file sesi tersimpan di disk supaya tidak perlu scan
// ulang QR tiap kali. Supabase Edge Function (Deno) itu STATELESS & cold
// start tiap request — tidak mungkin menjaga sesi WA tetap login di sini.
// Jadi sesi WA hidup di service Node.js TERPISAH (hosting milik owner,
// lihat folder `whatsapp-service/` di root project + README-nya di sana),
// Edge Function ini cuma HTTP request "kirim pesan ke nomor X isinya Y".
//
// KEAMANAN: request diautentikasi header `x-api-key`, HARUS sama persis
// dengan `API_KEY` yang diset di `.env` service Node.js itu. Kedua secret
// (`WHATSAPP_SERVICE_URL`/`WHATSAPP_SERVICE_API_KEY`) HANYA boleh ada di
// Supabase Edge Function Secrets — tidak pernah di kode `/src` frontend
// (AGENTS.md §2/§4, sama aturan dengan semua secret lain di proyek ini).
//
// BEST-EFFORT SELALU — sama filosofi dengan `sendEmail()`: kegagalan kirim
// WA (service down/nomor invalid/dst) TIDAK BOLEH menggagalkan proses
// utama (update status order / response ke Midtrans / checkout customer).
// Pemanggil WAJIB bungkus try/catch sendiri, contoh pola sudah ada di
// `sendPaidOrderEmails` (midtrans-webhook) & `sendCashOrderEmails`
// (public-checkout) — kirim WA ditambahkan di try/catch TERPISAH dari
// kirim email supaya kegagalan salah satu tidak menghalangi yang lain.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OrderItemRow = {
  nama_produk: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
};

/**
 * Data KARTU PESANAN — dikirim ke `whatsapp-service` (`order-card.js`) yang
 * merendernya jadi gambar PNG berisi ringkasan pesanan + QR code. QR
 * berisi `orderUrl` (`/order/:order_token`), jadi link TIDAK perlu (dan
 * tidak boleh) ditulis di teks pesan ke customer.
 */
export type WhatsAppOrderCard = {
  namaCustomer: string;
  items: Array<{ nama_produk: string; qty: number }>;
  total: number;
  orderToken: string;
  orderUrl: string; // isi QR code
  caption?: string; // teks di bawah gambar, opsional (tanpa link)
};

/** 1 pesan di batch WA. `card` diisi = kirim GAMBAR; `message` = teks (cadangan kalau gambar gagal). */
export type WhatsAppBatchItem = {
  phone: string;
  message: string;
  card?: WhatsAppOrderCard;
};

function getWhatsAppServiceUrlOrNull(): string | null {
  const url = Deno.env.get("WHATSAPP_SERVICE_URL");
  if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) {
    return null;
  }
  return url.replace(/\/+$/, "");
}

/**
 * Normalisasi nomor telepon Indonesia bebas format (input mentah dari form
 * checkout: "0812...", "+62812...", "62812...", boleh ada spasi/strip/
 * kurung) jadi format JID WhatsApp `62xxxxxxxxxx` (tanpa "+", tanpa "0" di
 * depan). Return `null` kalau tidak bisa dikenali sebagai nomor Indonesia
 * yang valid — pemanggil harus melewati pengiriman WA kalau ini `null`,
 * BUKAN memaksa kirim ke nomor yang salah bentuk.
 */
export function normalizeIndonesianPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  let n = cleaned.replace(/^\+/, "");

  if (n.startsWith("0")) {
    n = "62" + n.slice(1);
  } else if (n.startsWith("8")) {
    // Customer kadang ngetik tanpa awalan 0/62 sama sekali (mis. "8123...")
    // — lebih baik ditangani di sini daripada notifikasi diam-diam gagal.
    n = "62" + n;
  }

  if (!/^62\d{8,13}$/.test(n)) return null;
  return n;
}

/** Format Rupiah sederhana untuk teks WhatsApp (plain text, tanpa HTML). */
function formatRupiahPlain(amount: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(amount));
}

/** Daftar item pesanan versi plain-text (WhatsApp tidak render HTML). */
function buildItemsTextList(items: OrderItemRow[]): string {
  if (!items || items.length === 0) return "";
  return items
    .map((it) => `- ${it.nama_produk} x${it.qty} — Rp${formatRupiahPlain(it.subtotal)}`)
    .join("\n");
}

/**
 * Susun KARTU PESANAN untuk customer (dikirim sebagai gambar + QR).
 * Cuma memetakan data order ke bentuk yang dipahami `whatsapp-service`.
 */
export function buildCustomerOrderCard(params: {
  namaCustomer: string;
  items: OrderItemRow[];
  total: number;
  orderToken: string;
  orderLink: string; // URL lengkap `/order/:order_token` -> isi QR
  caption?: string;
}): WhatsAppOrderCard {
  const { namaCustomer, items, total, orderToken, orderLink, caption } = params;
  return {
    namaCustomer,
    items: (items ?? []).map((it) => ({ nama_produk: it.nama_produk, qty: it.qty })),
    total,
    orderToken,
    orderUrl: orderLink,
    ...(caption ? { caption } : {}),
  };
}

/**
 * Teks CADANGAN ke customer — dikirim HANYA kalau kartu gambar gagal dibuat/
 * dikirim (permintaan owner: tanpa link di pesan customer, jadi versi ini
 * juga TANPA link; QR/link pesanan tetap ada di email konfirmasi). Sengaja
 * RINGKAS: status, ringkasan item, total.
 */
export function buildCustomerWhatsAppFallback(params: {
  namaCustomer: string;
  statusLine: string; // contoh: "Pembayaran kamu sudah diterima ✅"
  items: OrderItemRow[];
  total: number;
  extraLine?: string; // contoh: catatan khusus cash / adjusted_notes
}): string {
  const { namaCustomer, statusLine, items, total, extraLine } = params;
  const itemsText = buildItemsTextList(items);

  return [
    `Halo ${namaCustomer}, ini notifikasi dari *GABAR* (Gabin Ice Bar) ❄️`,
    "",
    statusLine,
    ...(extraLine ? ["", extraLine] : []),
    ...(itemsText ? ["", itemsText] : []),
    "",
    `Total: Rp${formatRupiahPlain(total)}`,
    "",
    "QR pesananmu juga ada di email konfirmasi yang kami kirim.",
  ].join("\n");
}

/**
 * Susun isi pesan WhatsApp ke ADMIN — versi WhatsApp dari email notifikasi
 * admin yang sudah ada (`midtrans-webhook`/`public-checkout`): sama
 * lengkapnya (nama, no. telp, email, Lokasi 1/2, ringkasan item, total),
 * TANPA link order (permintaan owner 2026-09-20: pesan admin teks saja;
 * detail/QR verifikasi tetap ada di email admin), BUKAN versi ringkas seperti pesan ke customer, karena admin butuh
 * info kontak & lokasi lengkap untuk mengantar (Modul 15b).
 */
export function buildAdminWhatsAppMessage(params: {
  namaCustomer: string;
  noTelp: string;
  email: string;
  lokasi1: string;
  lokasi2: string | null;
  statusLine: string; // contoh: "Ada pesanan baru yang sudah dibayar di GABAR."
  items: OrderItemRow[];
  total: number;
  extraLine?: string; // contoh: catatan cash "Total yang harus ditagih tunai"
}): string {
  const { namaCustomer, noTelp, email, lokasi1, lokasi2, statusLine, items, total, extraLine } =
    params;
  const itemsText = buildItemsTextList(items);

  return [
    statusLine,
    "",
    `Nama: ${namaCustomer}`,
    `No. Telp: ${noTelp}`,
    `Email: ${email}`,
    `Lokasi 1 (wajib): ${lokasi1}`,
    `Lokasi 2 (opsional): ${lokasi2 || "-"}`,
    ...(extraLine ? ["", extraLine] : []),
    ...(itemsText ? ["", itemsText] : []),
    "",
    `Total: Rp${formatRupiahPlain(total)}`,
  ].join("\n");
}

/**
 * Kirim SEJUMLAH pesan WhatsApp SEKALIGUS, tapi diproses BERURUTAN dengan
 * jeda di sisi service (bukan diproses satu-satu dari Edge Function ini) —
 * Modul 15b. Alasan dipisah dari `sendWhatsAppMessage()` (1 pesan): kalau
 * Edge Function yang menunggu tiap pesan terkirim SATU PER SATU dengan
 * jeda "mengetik..." 3 detik (`TYPING_DELAY_MS`), response
 * `midtrans-webhook`/`public-checkout` bisa jadi lambat kalau nomor admin
 * banyak (mis. 5 nomor × ~3 detik = ~15 detik tambahan) — berisiko bikin
 * Midtrans retry webhook (dianggap tidak dibalas cepat) atau UX checkout
 * customer nunggu lama. **Dikonfirmasi owner (2026-09-15, opsi (b))**: jadi
 * di sini Edge Function cuma kirim SATU request `POST /send-batch` berisi
 * SEMUA pesan (urutan array = urutan kirim, taruh pesan customer di indeks
 * 0 SEBELUM pesan-pesan admin, sesuai permintaan eksplisit owner — WA ke
 * customer harus terkirim duluan), lalu service Node.js (`server.js`) yang
 * mengantrikan & memprosesnya berurutan secara ASYNC di background
 * (masing-masing tetap pakai jeda "mengetik..." yang sama) — endpoint ini
 * balas cepat (202, langsung setelah antrian diisi), TIDAK menunggu semua
 * pesan benar-benar terkirim. Konsekuensinya: fungsi ini SENGAJA tidak bisa
 * melaporkan per-pesan mana yang akhirnya gagal terkirim (mis. nomor tidak
 * terdaftar WA) — itu cuma tercatat di log service Node.js sendiri, bukan
 * di log Supabase Edge Function. Best-effort seperti biasa: throw kalau
 * request AWAL ke service gagal (service down/`WHATSAPP_SERVICE_URL` belum
 * diset/dll), pemanggil tetap wajib bungkus try/catch.
 */
export async function sendWhatsAppBatch(
  items: WhatsAppBatchItem[],
  opts?: { supabase?: SupabaseClient; orderId?: string },
): Promise<void> {
  if (!items.length) return;

  // Normalisasi & buang tujuan dengan nomor tidak valid DI SINI (bukan di
  // service) — supaya nomor yang jelas salah format tidak ikut masuk
  // antrian sama sekali, dan supaya `normalizeIndonesianPhone()` (satu
  // tempat, pola dari komentar file ini) tetap jadi sumber kebenaran
  // normalisasi nomor untuk seluruh proyek.
  const validItems = items
    .map((it) => {
      const phone = normalizeIndonesianPhone(it.phone);
      return phone ? { phone, message: it.message, card: it.card } : null;
    })
    .filter((it): it is WhatsAppBatchItem => it !== null);

  try {
    const serviceUrl = getWhatsAppServiceUrlOrNull();
    const apiKey = Deno.env.get("WHATSAPP_SERVICE_API_KEY");

    if (!serviceUrl || !apiKey) {
      throw new Error(
        "WHATSAPP_SERVICE_URL/WHATSAPP_SERVICE_API_KEY belum diset di Edge Function Secrets " +
          "(lihat whatsapp-service/README.md langkah 4) — notifikasi WA batch dilewati.",
      );
    }

    if (!validItems.length) {
      throw new Error("Tidak ada nomor tujuan yang valid di batch WA ini — semua dilewati.");
    }

    const res = await fetch(`${serviceUrl}/send-batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ messages: validItems }),
      // Timeout pendek — endpoint ini cuma perlu waktu untuk MENGANTRIKAN
      // pesan (bukan menunggu semua terkirim), jadi tidak butuh timeout
      // sepanjang `sendWhatsAppMessage()` (yang menunggu 1 kiriman selesai).
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`WA service (batch) membalas HTTP ${res.status}: ${text}`);
    }
  } catch (err) {
    // Modul 15e: kalau request ke whatsapp-service gagal (service down/
    // unreachable/HTTP error) dan pemanggil kasih `opts.supabase`, simpan
    // batch ini ke `wa_outbox` supaya di-retry otomatis nanti — bukan
    // hilang begitu saja seperti sebelumnya. Cuma jalan kalau ada minimal
    // 1 nomor valid (batch yang semua nomornya invalid tidak ada gunanya
    // disimpan untuk di-retry juga).
    if (opts?.supabase && validItems.length > 0) {
      await enqueueWhatsAppOutbox(opts.supabase, validItems, opts.orderId, err);
    }
    throw err;
  }
}

/**
 * Simpan batch pesan yang gagal terkirim ke `wa_outbox` (Modul 15e) supaya
 * bisa di-retry otomatis nanti oleh `whatsapp-service` sendiri, persis saat
 * koneksi WA-nya reconnect (lihat `flushPendingOutbox()` di
 * `whatsapp-service/server.js`). Kegagalan INSERT ke outbox cuma di-log
 * (tidak dilempar ulang) — pemanggil (`sendWhatsAppBatch`) tetap melempar
 * error ASLI-nya ke atas seperti biasa, bukan error insert ini.
 */
async function enqueueWhatsAppOutbox(
  supabase: SupabaseClient,
  items: WhatsAppBatchItem[],
  orderId: string | undefined,
  originalError: unknown,
): Promise<void> {
  const errorMessage =
    originalError instanceof Error ? originalError.message : String(originalError);

  const rows = items.map((it) => ({
    order_id: orderId ?? null,
    phone: it.phone,
    message: it.message,
    // Data kartu disimpan supaya retry tetap mengirim GAMBAR (bukan cuma
    // teks cadangan). Kolom dibuat migration 0013; null untuk pesan teks biasa.
    payload: it.card ? { card: it.card } : null,
    status: "pending" as const,
    last_error: errorMessage,
  }));

  const { error } = await supabase.from("wa_outbox").insert(rows);
  if (error) {
    console.error(
      "[whatsapp] GAGAL simpan batch ke wa_outbox — notifikasi WA ini benar-benar hilang " +
        "(tidak akan pernah di-retry), bukan cuma tertunda:",
      error,
    );
  } else {
    console.warn(
      `[whatsapp] whatsapp-service tidak bisa dihubungi, ${rows.length} pesan disimpan ke ` +
        "wa_outbox — akan otomatis di-retry begitu koneksi WA reconnect.",
    );
  }
}

/**
 * Kirim pesan WhatsApp ke 1 nomor. Melempar error kalau gagal (service
 * belum dikonfigurasi, nomor tidak valid, atau service Node.js membalas
 * error) — SENGAJA melempar (bukan menelan diam-diam) supaya pemanggil
 * yang menentukan bagaimana menanganinya (biasanya: tangkap di try/catch,
 * log, lanjut — lihat catatan best-effort di atas file ini).
 */
export async function sendWhatsAppMessage(phoneRaw: string, message: string): Promise<void> {
  const serviceUrl = getWhatsAppServiceUrlOrNull();
  const apiKey = Deno.env.get("WHATSAPP_SERVICE_API_KEY");

  if (!serviceUrl || !apiKey) {
    throw new Error(
      "WHATSAPP_SERVICE_URL/WHATSAPP_SERVICE_API_KEY belum diset di Edge Function Secrets " +
        "(lihat whatsapp-service/README.md langkah 4) — notifikasi WA dilewati.",
    );
  }

  const phone = normalizeIndonesianPhone(phoneRaw);
  if (!phone) {
    throw new Error(`Nomor telepon tidak valid untuk kirim WA: "${phoneRaw}"`);
  }

  const res = await fetch(`${serviceUrl}/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ phone, message }),
    // Jangan sampai request WA yang lambat/nyangkut bikin webhook Midtrans
    // (atau public-checkout, yang punya sensitivitas UX beda) ikut lambat.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WA service membalas HTTP ${res.status}: ${text}`);
  }
}
