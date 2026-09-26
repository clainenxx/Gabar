// Edge Function: public-checkout (anon) — Modul 7 (Checkout Online +
// Midtrans + Form Lokasi Pengantaran, ARCHITECTURE.md §6).
//
// Alur (ARCHITECTURE.md §4.1, §5):
// 1. Rate limit per IP (`check_rate_limit` RPC, §0.12) — cegah spam checkout.
// 2. Validasi & sanitasi input (nama, no telp, email, Lokasi 1 wajib,
//    Lokasi 2 opsional, daftar item). Nama & lokasi juga dibatasi karakternya
//    dan ditolak kalau menyerupai link (`_shared/checkout-guards.ts`).
// 2b. Verifikasi Cloudflare Turnstile (anti-bot) — fail-closed.
// 2c. Rate limit per nomor telepon & per email (+ global khusus cash).
// 3. Hitung ulang harga SERVER-SIDE dari tabel `products` — tidak pernah
//    percaya harga/subtotal dari client (AGENTS.md §4).
// 4. Potong stok per item via RPC `decrement_product_stock` (atomic). Kalau
//    qty di keranjang > stok tersisa, jumlah yang diproses OTOMATIS
//    dibatasi ke stok tersisa (PRD.md §4.1, diubah owner 2026-09-08) —
//    bukan menolak seluruh order.
// 5. Insert `orders` + `order_items` (snapshot nama & harga saat transaksi).
//    Status awal tergantung `payment_method` (Fitur Pembayaran Cash,
//    migration 0008, dikonfirmasi owner 2026-09-08 — lihat komentar
//    lengkap di migration itu):
//      - 'online' (default, perilaku lama TIDAK BERUBAH): status 'pending',
//        lanjut ke langkah 6 (minta Snap token).
//      - 'cash': status LANGSUNG 'paid' (tidak ada Midtrans yang perlu
//        ditunggu — dibayar tunai ke admin saat serah terima, bersamaan
//        dengan scan QR `verify_order_pickup` yang sudah ada, TIDAK
//        diubah). Langkah 6 (Snap) dilewati sama sekali, dan email
//        konfirmasi (Modul 9) dikirim di SINI juga (bukan dari
//        `midtrans-webhook`, yang tidak akan pernah terpanggil untuk cash
//        karena tidak ada transaksi Midtrans).
// 6. (Hanya jalur 'online') Minta Snap token ke Midtrans
//    (`_shared/midtrans.ts`). Kalau gagal di langkah manapun setelah stok
//    terpotong, rollback: hapus order (cascade hapus order_items) +
//    `restore_product_stock` untuk semua item yang sudah dipotong — supaya
//    tidak ada stok "hilang" akibat request yang gagal di tengah jalan.
//
// Semua akses DB di sini pakai SERVICE ROLE (bukan RLS) karena Edge
// Function ini memang satu-satunya jalur legit untuk insert
// `orders`/`order_items` — sengaja tidak ada policy INSERT untuk anon/admin
// sama sekali (ARCHITECTURE.md §5.1).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getClientIp } from "../_shared/ip.ts";
import { createSnapTransaction } from "../_shared/midtrans.ts";
import {
  emailRateKey,
  isSafeLokasi,
  isSafeNama,
  phoneRateKey,
  sha256Hex,
  verifyTurnstile,
} from "../_shared/checkout-guards.ts";
import {
  sendEmail,
  escapeHtml,
  formatRupiah,
  buildItemsTableHtml,
  getSiteUrlOrNull,
  type OrderItemRow,
} from "../_shared/email.ts";
import {
  sendWhatsAppBatch,
  buildCustomerOrderCard,
  buildCustomerWhatsAppFallback,
  buildAdminWhatsAppMessage,
  type WhatsAppBatchItem,
} from "../_shared/whatsapp.ts";

const PAYMENT_METHODS = ["online", "cash"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Email untuk order CASH (Fitur Pembayaran Cash, migration 0008) — dikirim
// LANGSUNG di sini saat checkout submit, best-effort (kegagalan kirim email
// TIDAK menggagalkan response checkout ke customer, sama filosofi dengan
// `sendPaidOrderEmails` di `midtrans-webhook` untuk order online). Isinya
// SENGAJA beda dari email order online: minta customer siapkan uang cash,
// BUKAN "pembayaran sudah diterima" (karena memang belum — uangnya baru
// diterima admin saat serah terima/scan QR).
async function sendCashOrderEmails(
  supabase: ReturnType<typeof createClient>,
  order: {
    id: string;
    order_token: string;
    nama_customer: string;
    no_telp: string;
    email: string;
    lokasi_1: string;
    lokasi_2: string | null;
    total: number;
  },
  items: OrderItemRow[],
): Promise<void> {
  const siteUrl = getSiteUrlOrNull();
  if (!siteUrl) {
    console.error(
      "[public-checkout] SITE_URL belum diset / tidak berawalan http(s):// — email order cash dilewati untuk order_token",
      order.order_token,
      "- set secret SITE_URL dulu (Edge Function Secrets), lalu email akan otomatis terkirim untuk order berikutnya.",
    );
    return;
  }

  const orderLink = `${siteUrl}/order/${order.order_token}`;
  const itemsHtml = buildItemsTableHtml(items);
  const totalFormatted = formatRupiah(order.total);

  // Email ke customer — beda dari template online: minta siapkan uang cash.
  try {
    await sendEmail({
      to: order.email,
      subject: "Pesanan GABAR Kamu Sudah Tercatat — Bayar Cash 💵",
      html: `
        <div style="font-family:sans-serif;color:#1e293b;">
          <p>Halo ${escapeHtml(order.nama_customer)},</p>
          <p>Pesanan GABAR (Gabin Ice Bar) kamu (bayar cash/tunai) sudah tercatat &amp; stoknya sudah kami siapkan. Berikut ringkasannya:</p>
          ${itemsHtml}
          <p><strong>Total yang perlu disiapkan (cash): Rp${totalFormatted}</strong></p>
          <p>Siapkan uang pas sejumlah di atas — admin akan mengantar pesanan ke lokasimu dan menerima pembayaran tunai LANGSUNG di tempat, bersamaan saat QR pesananmu di-scan sebagai bukti serah terima.</p>
          <p>Tunjukkan QR di halaman berikut ke admin saat pesanan diantar (QR berlaku 1×seminggu sejak pesanan dibuat):</p>
          <p><a href="${orderLink}" style="color:#1e3a8a;">${orderLink}</a></p>
          <p>Terima kasih sudah pesan di GABAR! ❄️</p>
        </div>`,
    });
  } catch (err) {
    console.error(
      "[public-checkout] gagal kirim email konfirmasi cash ke customer, order_token",
      order.order_token,
      err,
    );
  }

  // Notifikasi WhatsApp ke customer + admin (Modul 9b + Modul 15b) — sama
  // pola dengan jalur online di `midtrans-webhook`. Pesan customer WAJIB
  // di indeks 0 batch (terkirim duluan), diikuti pesan ke tiap nomor admin
  // dari `settings.whatsapp_admin_numbers` (Modul 15a) — antrian &
  // jeda "mengetik..." diproses di `whatsapp-service/` (opsi (b),
  // dikonfirmasi owner 2026-09-15), jadi panggilan ini balas cepat.
  // Dibungkus try/catch TERPISAH dari email — best-effort, tidak
  // menghalangi email atau response checkout ke customer.
  try {
    // Pesan customer = KARTU GAMBAR (ringkasan + QR ke `orderLink`), TANPA
    // link di teks. Instruksi bayar cash ikut sebagai caption gambar (kartu
    // sendiri tidak memuatnya); `message` cuma cadangan tanpa link kalau
    // pembuatan gambar gagal.
    const cashStatusLine = "Pesananmu sudah tercatat — bayar CASH ke admin saat pesanan diantar 💵";
    const cashExtraLine = `Siapkan uang pas: Rp${totalFormatted}`;
    const waMessages: WhatsAppBatchItem[] = [
      {
        phone: order.no_telp,
        message: buildCustomerWhatsAppFallback({
          namaCustomer: order.nama_customer,
          statusLine: cashStatusLine,
          items,
          total: order.total,
          extraLine: cashExtraLine,
        }),
        card: buildCustomerOrderCard({
          namaCustomer: order.nama_customer,
          items,
          total: order.total,
          orderToken: order.order_token,
          orderLink,
          caption: `${cashStatusLine}\n${cashExtraLine}`,
        }),
      },
    ];

    const { data: waAdminRow, error: waAdminError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "whatsapp_admin_numbers")
      .maybeSingle();

    if (waAdminError) {
      console.error(
        "[public-checkout] gagal ambil settings.whatsapp_admin_numbers, order_token",
        order.order_token,
        waAdminError,
      );
    } else if (waAdminRow?.value) {
      let adminNumbers: string[] = [];
      try {
        const parsed = JSON.parse(waAdminRow.value);
        adminNumbers = Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string" && n) : [];
      } catch {
        console.error(
          "[public-checkout] settings.whatsapp_admin_numbers bukan JSON array valid, order_token",
          order.order_token,
        );
      }

      const adminMessage = buildAdminWhatsAppMessage({
        namaCustomer: order.nama_customer,
        noTelp: order.no_telp,
        email: order.email,
        lokasi1: order.lokasi_1,
        lokasi2: order.lokasi_2,
        statusLine: "Ada pesanan baru di GABAR dengan metode BAYAR CASH — tagih tunai saat mengantar.",
        items,
        total: order.total,
        extraLine: `Total yang harus ditagih tunai: Rp${totalFormatted}`,
      });

      for (const phone of adminNumbers) {
        waMessages.push({ phone, message: adminMessage });
      }
    }

    // `opts.supabase` + `opts.orderId` (Modul 15e) — sama pola dengan
    // `midtrans-webhook`: kalau whatsapp-service down, batch ini otomatis
    // disimpan ke `wa_outbox` di dalam `sendWhatsAppBatch()` sebelum
    // error-nya dilempar ke sini, jadi otomatis di-retry nanti.
    await sendWhatsAppBatch(waMessages, { supabase, orderId: order.id });
  } catch (err) {
    console.error(
      "[public-checkout] gagal kirim notifikasi WhatsApp cash (customer/admin), order_token",
      order.order_token,
      err,
    );
  }

  // Email notifikasi ke admin — sama pola dengan jalur online, cuma
  // ditandai jelas ini order CASH supaya admin tahu perlu bawa uang
  // kembalian & menagih tunai saat mengantar (bukan sekadar mengantar).
  try {
    const { data: settingRow, error: settingError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "notification_email")
      .maybeSingle();

    if (settingError) {
      console.error(
        "[public-checkout] gagal ambil settings.notification_email, order_token",
        order.order_token,
        settingError,
      );
    } else if (settingRow?.value) {
      await sendEmail({
        to: settingRow.value,
        subject: `Pesanan Baru (Bayar Cash) — ${order.nama_customer}`,
        html: `
          <div style="font-family:sans-serif;color:#1e293b;">
            <p>Ada pesanan baru di GABAR dengan metode <strong>BAYAR CASH</strong> — tagih tunai saat mengantar.</p>
            <p>
              <strong>Nama:</strong> ${escapeHtml(order.nama_customer)}<br />
              <strong>No. Telp:</strong> ${escapeHtml(order.no_telp)}<br />
              <strong>Email:</strong> ${escapeHtml(order.email)}<br />
              <strong>Lokasi 1 (wajib):</strong> ${escapeHtml(order.lokasi_1)}<br />
              <strong>Lokasi 2 (opsional):</strong> ${order.lokasi_2 ? escapeHtml(order.lokasi_2) : "-"}
            </p>
            ${itemsHtml}
            <p><strong>Total yang harus ditagih tunai: Rp${totalFormatted}</strong></p>
            <p>Detail &amp; QR verifikasi: <a href="${orderLink}" style="color:#1e3a8a;">${orderLink}</a></p>
          </div>`,
      });
    } else {
      console.log(
        "[public-checkout] settings.notification_email belum diisi admin — email notifikasi admin dilewati untuk order_token cash",
        order.order_token,
      );
    }
  } catch (err) {
    console.error(
      "[public-checkout] gagal kirim email notifikasi admin (cash), order_token",
      order.order_token,
      err,
    );
  }
}

const MAX_NAMA_LENGTH = 100;
const MAX_LOKASI_LENGTH = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+\-\s]{8,20}$/;

// Batas checkout per NOMOR TELEPON dan per EMAIL (ditambahkan 2026-09-19,
// lapis tambahan di atas rate limit per-IP): mencegah 1 nomor/email dipakai
// berulang untuk membanjiri notifikasi WA/email, walau IP-nya berganti-ganti.
// Angka ini asumsi awal, BELUM dikonfirmasi owner untuk trafik nyata sekolah —
// naikkan kalau ada pelanggan sah yang sering kena batas.
const MAX_CHECKOUT_PER_CONTACT = 3;
const CONTACT_WINDOW_SECONDS = 3600; // 1 jam

// Batas GLOBAL khusus order cash per jam (semua pelanggan digabung) — jaring
// pengaman terakhir kalau Turnstile berhasil dilewati (mis. solver berbayar).
// Bisa diubah tanpa deploy ulang kode lewat secret CASH_GLOBAL_LIMIT_PER_HOUR.
// Default 100 sengaja longgar supaya jam istirahat sekolah yang ramai tidak
// terblokir; turunkan kalau trafik nyata ternyata jauh lebih kecil.
const DEFAULT_CASH_GLOBAL_LIMIT_PER_HOUR = 100;
function cashGlobalLimitPerHour(): number {
  const n = Number(Deno.env.get("CASH_GLOBAL_LIMIT_PER_HOUR"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CASH_GLOBAL_LIMIT_PER_HOUR;
}

// Sanitasi dasar (ARCHITECTURE.md §5.4): trim + buang karakter "<"/">" biar
// data mentah di DB tidak mengandung markup, sebagai lapisan tambahan di
// luar auto-escape React saat render ulang di panel admin.
function sanitizeText(value: string): string {
  return value.trim().replace(/[<>]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // 1. Rate limit — 5 percobaan checkout per 60 detik per IP (ARCHITECTURE.md
  // §0.12). Angka ini asumsi awal AI, BELUM dikonfirmasi owner untuk
  // trafik nyata sekolah — gampang diubah kalau ternyata kekecilan/
  // kebesaran (dicatat sebagai catatan di TODO.md).
  const ip = getClientIp(req);
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
    p_key: `public-checkout:${ip}`,
    p_max_attempts: 5,
    p_window_seconds: 60,
  });
  if (rateLimitError) {
    console.error("[public-checkout] rate limit check gagal:", rateLimitError);
    return jsonResponse(500, { error: "Gagal memproses checkout, coba lagi" });
  }
  if (!allowed) {
    return jsonResponse(429, {
      error: "Terlalu banyak percobaan checkout, coba lagi sebentar lagi",
    });
  }

  // 2. Parse & validasi body.
  let body: {
    nama_customer?: string;
    no_telp?: string;
    email?: string;
    lokasi_1?: string;
    lokasi_2?: string;
    items?: { product_id?: string; qty?: number }[];
    payment_method?: string;
    turnstile_token?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const namaCustomer = sanitizeText(body.nama_customer ?? "");
  const noTelp = sanitizeText(body.no_telp ?? "");
  const email = sanitizeText(body.email ?? "").toLowerCase();
  const lokasi1 = sanitizeText(body.lokasi_1 ?? "");
  const lokasi2Raw = body.lokasi_2 ? sanitizeText(body.lokasi_2) : "";
  // Fitur Pembayaran Cash (migration 0008, dikonfirmasi owner 2026-09-08).
  // Default 'online' kalau field tidak dikirim sama sekali — supaya client
  // lama (belum update) tetap jalan persis seperti sebelumnya.
  const paymentMethod = (body.payment_method ?? "online") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return jsonResponse(400, { error: "Metode pembayaran tidak valid" });
  }

  if (!namaCustomer || namaCustomer.length > MAX_NAMA_LENGTH) {
    return jsonResponse(400, { error: "Nama wajib diisi (maks 100 karakter)" });
  }
  // Nama ikut masuk ke pesan WhatsApp & email — tolak karakter/format yang
  // dipakai untuk menyisipkan link (lihat _shared/checkout-guards.ts).
  if (!isSafeNama(namaCustomer)) {
    return jsonResponse(400, {
      error: "Nama hanya boleh huruf, angka, spasi, dan tanda baca umum (tanpa link atau simbol @ * _)",
    });
  }
  if (!PHONE_REGEX.test(noTelp)) {
    return jsonResponse(400, { error: "Nomor telepon tidak valid" });
  }
  // Kunci rate limit per nomor — null berarti jumlah digit tidak masuk akal.
  const phoneKey = phoneRateKey(noTelp);
  if (!phoneKey) {
    return jsonResponse(400, { error: "Nomor telepon tidak valid" });
  }
  if (!EMAIL_REGEX.test(email)) {
    return jsonResponse(400, { error: "Email tidak valid" });
  }
  // Lokasi 1 WAJIB (PRD.md §4.1) — pesan error jelas kalau kosong.
  if (!lokasi1 || lokasi1.length > MAX_LOKASI_LENGTH) {
    return jsonResponse(400, { error: "Lokasi 1 wajib diisi (maks 200 karakter)" });
  }
  if (!isSafeLokasi(lokasi1)) {
    return jsonResponse(400, {
      error: "Lokasi 1 hanya boleh huruf, angka, spasi, dan tanda baca umum (tanpa link atau simbol @ * _)",
    });
  }
  // Lokasi 2 OPSIONAL — kosong tetap lolos, cuma dibatasi panjangnya.
  if (lokasi2Raw.length > MAX_LOKASI_LENGTH) {
    return jsonResponse(400, { error: "Lokasi 2 maksimal 200 karakter" });
  }
  if (lokasi2Raw && !isSafeLokasi(lokasi2Raw)) {
    return jsonResponse(400, {
      error: "Lokasi 2 hanya boleh huruf, angka, spasi, dan tanda baca umum (tanpa link atau simbol @ * _)",
    });
  }
  const lokasi2 = lokasi2Raw || null;

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return jsonResponse(400, { error: "Keranjang kosong" });
  }

  // Gabungkan qty kalau product_id yang sama muncul dua kali di request.
  const requestedQtyByProduct = new Map<string, number>();
  for (const it of rawItems) {
    if (!it.product_id || typeof it.product_id !== "string") {
      return jsonResponse(400, { error: "Item keranjang tidak valid" });
    }
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      return jsonResponse(400, { error: "Qty item harus bilangan bulat > 0" });
    }
    requestedQtyByProduct.set(
      it.product_id,
      (requestedQtyByProduct.get(it.product_id) ?? 0) + qty,
    );
  }

  // 2b. Verifikasi Cloudflare Turnstile (anti-bot). Dicek SETELAH validasi
  // field (supaya request sampah ditolak murah tanpa memanggil Cloudflare)
  // dan SEBELUM rate limit per nomor/email — supaya bot tanpa token tidak
  // bisa menghabiskan jatah nomor/email milik orang lain. Token Turnstile
  // sekali pakai: frontend wajib minta token baru tiap kali submit.
  const turnstile = await verifyTurnstile(body.turnstile_token, ip);
  if (turnstile === "not_configured") {
    console.error(
      "[public-checkout] secret TURNSTILE_SECRET_KEY belum diset — semua checkout ditolak (fail-closed). Set dulu: supabase secrets set TURNSTILE_SECRET_KEY=...",
    );
    return jsonResponse(500, { error: "Verifikasi keamanan belum dikonfigurasi di server" });
  }
  if (turnstile === "unavailable") {
    return jsonResponse(503, { error: "Layanan verifikasi sedang bermasalah, coba lagi sebentar lagi" });
  }
  if (turnstile === "failed") {
    return jsonResponse(400, { error: "Verifikasi keamanan gagal, silakan coba lagi" });
  }

  // 2c. Rate limit per nomor telepon & per email (dan global untuk cash).
  // Kunci di-hash supaya tabel `rate_limits` tidak menyimpan nomor/email
  // mentah. Blokir tidak menambah counter (lihat check_rate_limit), jadi
  // pelanggan yang kena batas cukup menunggu jendela 1 jam-nya lewat.
  const limitChecks: { key: string; max: number; windowSeconds: number; message: string }[] = [
    {
      key: `checkout-phone:${await sha256Hex(phoneKey)}`,
      max: MAX_CHECKOUT_PER_CONTACT,
      windowSeconds: CONTACT_WINDOW_SECONDS,
      message: "Terlalu banyak pesanan dari nomor telepon ini. Coba lagi dalam 1 jam.",
    },
    {
      key: `checkout-email:${await sha256Hex(emailRateKey(email))}`,
      max: MAX_CHECKOUT_PER_CONTACT,
      windowSeconds: CONTACT_WINDOW_SECONDS,
      message: "Terlalu banyak pesanan dari email ini. Coba lagi dalam 1 jam.",
    },
  ];
  if (paymentMethod === "cash") {
    limitChecks.push({
      key: "checkout-cash-global",
      max: cashGlobalLimitPerHour(),
      windowSeconds: CONTACT_WINDOW_SECONDS,
      message: "Pesanan cash sedang dibatasi sementara karena terlalu ramai. Coba lagi nanti atau pilih Bayar Online.",
    });
  }
  for (const check of limitChecks) {
    const { data: ok, error: limitError } = await supabase.rpc("check_rate_limit", {
      p_key: check.key,
      p_max_attempts: check.max,
      p_window_seconds: check.windowSeconds,
    });
    if (limitError) {
      console.error("[public-checkout] rate limit check gagal:", limitError);
      return jsonResponse(500, { error: "Gagal memproses checkout, coba lagi" });
    }
    if (!ok) {
      return jsonResponse(429, { error: check.message });
    }
  }

  // 3. Ambil data produk terkini (harga & stok SELALU dari DB, bukan dari
  // client) — sekaligus jadi pengecekan produk masih aktif.
  const productIds = Array.from(requestedQtyByProduct.keys());
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, nama, harga, stock, aktif")
    .in("id", productIds);
  if (productsError) {
    console.error("[public-checkout] gagal ambil data produk:", productsError);
    return jsonResponse(500, { error: "Gagal memproses checkout, coba lagi" });
  }

  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  // 4. Potong stok per item (atomic via RPC).
  const orderItemsToInsert: {
    product_id: string;
    nama_produk: string;
    qty: number;
    harga_satuan: number;
    subtotal: number;
  }[] = [];
  const decrementedForRollback: { product_id: string; qty: number }[] = [];
  const adjustedNotes: string[] = [];

  for (const [productId, qtyRequested] of requestedQtyByProduct) {
    const product = productById.get(productId);
    if (!product || !product.aktif) {
      adjustedNotes.push("Salah satu produk sudah tidak tersedia lagi, dilewati dari pesanan.");
      continue;
    }

    // Jalur normal: langsung coba potong sejumlah qty yang diminta.
    let actualQty = qtyRequested;
    let decremented = await supabase.rpc("decrement_product_stock", {
      p_product_id: productId,
      p_qty: qtyRequested,
    });

    if (decremented.error) {
      // Stok tidak cukup untuk qty yang diminta — cek stok TERKINI (bisa
      // saja berubah karena checkout lain bersamaan) lalu potong sebanyak
      // yang tersisa saja (PRD.md §4.1: disesuaikan, bukan ditolak total).
      const { data: freshProduct, error: freshError } = await supabase
        .from("products")
        .select("stock")
        .eq("id", productId)
        .single();

      if (freshError || !freshProduct || freshProduct.stock <= 0) {
        adjustedNotes.push(`"${product.nama}" stok habis, dilewati dari pesanan.`);
        continue;
      }

      actualQty = freshProduct.stock;
      decremented = await supabase.rpc("decrement_product_stock", {
        p_product_id: productId,
        p_qty: actualQty,
      });

      if (decremented.error) {
        // Race condition ekstrem (stok berubah lagi persis di antara 2
        // pengecekan) — daripada gagal total, lewati produk ini saja.
        adjustedNotes.push(`"${product.nama}" stok berubah saat diproses, dilewati dari pesanan.`);
        continue;
      }

      adjustedNotes.push(
        `"${product.nama}" jumlah disesuaikan jadi ${actualQty} (stok tersisa tidak cukup untuk ${qtyRequested}).`,
      );
    }

    decrementedForRollback.push({ product_id: productId, qty: actualQty });
    orderItemsToInsert.push({
      product_id: productId,
      nama_produk: product.nama,
      qty: actualQty,
      harga_satuan: product.harga,
      subtotal: product.harga * actualQty,
    });
  }

  if (orderItemsToInsert.length === 0) {
    return jsonResponse(400, {
      error: "Semua produk di keranjang sudah tidak tersedia/stok habis",
    });
  }

  const subtotal = orderItemsToInsert.reduce((sum, it) => sum + it.subtotal, 0);
  const total = subtotal; // Tidak ada voucher/diskon (ARCHITECTURE.md §0.4).

  // Dipakai kalau langkah SESUDAH potong stok gagal (insert order, insert
  // order_items, atau panggil Midtrans) — supaya stok yang sudah dipotong
  // tidak "hilang" percuma akibat request yang gagal di tengah jalan.
  async function rollbackStock() {
    for (const item of decrementedForRollback) {
      const { error } = await supabase.rpc("restore_product_stock", {
        p_product_id: item.product_id,
        p_qty: item.qty,
      });
      if (error) {
        console.error(
          "[public-checkout] rollback stok gagal untuk produk",
          item.product_id,
          error,
        );
      }
    }
  }

  // 5. Insert order + order_items. Status awal tergantung `paymentMethod`
  // (Fitur Pembayaran Cash, migration 0008) — 'online' tetap 'pending'
  // seperti sebelumnya (perilaku TIDAK berubah), 'cash' LANGSUNG 'paid'
  // (lihat komentar panjang di migration 0008 & bagian atas file ini).
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      nama_customer: namaCustomer,
      no_telp: noTelp,
      email,
      lokasi_1: lokasi1,
      lokasi_2: lokasi2,
      subtotal,
      total,
      status: paymentMethod === "cash" ? "paid" : "pending",
      payment_method: paymentMethod,
    })
    .select("id, order_token, nama_customer, no_telp, email, lokasi_1, lokasi_2, total")
    .single();

  if (orderError || !order) {
    console.error("[public-checkout] gagal insert order:", orderError);
    await rollbackStock();
    return jsonResponse(500, { error: "Gagal membuat pesanan, coba lagi" });
  }

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItemsToInsert.map((it) => ({ ...it, order_id: order.id })));

  if (itemsError) {
    console.error("[public-checkout] gagal insert order_items:", itemsError);
    // Hapus order yang sudah terlanjur dibuat (cascade hapus order_items
    // kalau ada sebagian sempat masuk) + restore stok.
    await supabase.from("orders").delete().eq("id", order.id);
    await rollbackStock();
    return jsonResponse(500, { error: "Gagal membuat pesanan, coba lagi" });
  }

  // 5b. Jalur CASH selesai di sini — tidak ada Midtrans yang perlu diminta
  // sama sekali. Order sudah `paid`, stok sudah terpotong (langkah 4 di
  // atas, SAMA untuk kedua metode), tinggal kirim email konfirmasi
  // (best-effort, lihat `sendCashOrderEmails`) lalu balas ke customer
  // supaya frontend langsung redirect ke halaman QR (tanpa buka Snap sama
  // sekali — lihat `snap_token: null` di response).
  if (paymentMethod === "cash") {
    await sendCashOrderEmails(supabase, order, orderItemsToInsert);
    return jsonResponse(200, {
      order_token: order.order_token,
      payment_method: "cash",
      snap_token: null,
      redirect_url: null,
      adjusted_notes: adjustedNotes,
    });
  }

  // 6. (Jalur ONLINE) Minta Snap token ke Midtrans. `order.id` (UUID, baru
  // saja dibuat)
  // dipakai sebagai Midtrans order_id — dijamin unik.
  try {
    const snap = await createSnapTransaction({
      orderId: order.id,
      grossAmount: total,
      customer: { name: namaCustomer, phone: noTelp, email },
      items: orderItemsToInsert.map((it) => ({
        id: it.product_id,
        name: it.nama_produk,
        price: it.harga_satuan,
        quantity: it.qty,
      })),
    });

    // Simpan snap_token — dipakai "Lanjutkan Pembayaran" (resume-payment)
    // untuk buka ulang popup Snap yang SAMA tanpa minta transaksi baru ke
    // Midtrans (TODO.md Bug/Isu #9). Best-effort: kalau update ini gagal,
    // tetap lanjut balas ke customer (pembayaran PERTAMA ini tidak
    // terpengaruh sama sekali, cuma "Lanjutkan Pembayaran" nanti yang akan
    // fallback minta token baru — lihat resume-payment/index.ts).
    const { error: saveTokenError } = await supabase
      .from("orders")
      .update({ snap_token: snap.token })
      .eq("id", order.id);
    if (saveTokenError) {
      console.warn("[public-checkout] gagal simpan snap_token (non-fatal):", saveTokenError);
    }

    return jsonResponse(200, {
      order_token: order.order_token,
      payment_method: "online",
      snap_token: snap.token,
      redirect_url: snap.redirect_url,
      adjusted_notes: adjustedNotes,
    });
  } catch (err) {
    console.error("[public-checkout] gagal minta Snap token:", err);
    await supabase.from("orders").delete().eq("id", order.id);
    await rollbackStock();
    return jsonResponse(500, { error: "Gagal menghubungi layanan pembayaran, coba lagi" });
  }
});
