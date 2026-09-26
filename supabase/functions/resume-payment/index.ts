// Edge Function: resume-payment (anon) — Modul 7b (Lanjutkan Pembayaran dari
// halaman QR, ARCHITECTURE.md §6, ditambahkan 2026-09-08).
//
// Dipakai tombol "Lanjutkan Pembayaran" di `/order/:order_token` (OrderQr.jsx)
// waktu customer belum sempat bayar tapi sudah terlanjur (atau sengaja)
// membuka halaman QR-nya.
//
// VERSI 2 (TODO.md Bug/Isu #9) — desain awal function ini SALAH: dikira
// perlu minta Snap token BARU ke Midtrans tiap kali tombol ini diklik.
// Sudah dicoba 2x fix (idempotent create biasa, lalu cancel-then-recreate)
// dan keduanya GAGAL karena begitu customer sempat pilih metode
// pembayaran, `order_id` terkunci permanen di sisi Midtrans — request
// create/cancel-lalu-create SELALU berujung "order_id sudah digunakan".
//
// SOLUSI YANG BENAR (dokumentasi resmi Midtrans, Snap.js reference):
// `window.snap.pay(token)` "is also useful if you want to re-open that
// same payment page again e.g. when you allow another attempt of payment
// for that same Order ID, in case of closed earlier" — jadi TIDAK PERLU
// minta transaksi baru ke Midtrans sama sekali. Snap token dari transaksi
// PERTAMA (disimpan `public-checkout` ke `orders.snap_token`, migration
// 0005) dipakai ULANG apa adanya untuk buka lagi popup Snap yang SAMA
// (termasuk VA number/QRIS yang sudah digenerate, kalau ada). Function ini
// sekarang cuma "ambilkan token yang sudah tersimpan", BUKAN "minta token
// baru" — jauh lebih sederhana & tidak pernah menyentuh Midtrans API sama
// sekali di jalur normal.
//
// Fallback tetap ada untuk order LAMA (dibuat sebelum migration 0005,
// `snap_token` masih NULL): minta token baru sekali seperti biasa (order_id
// itu belum pernah "dipakai" ke Midtrans dari kolom ini, jadi create biasa
// tetap valid untuk kasus spesifik ini), lalu simpan supaya percobaan
// berikutnya tidak perlu create lagi.
//
// Order yang statusnya BUKAN `pending` (`paid`/`completed`/`cancelled`)
// ditolak dengan pesan jelas — tidak ada gunanya (dan berisiko membingungkan
// customer) menawarkan lanjut bayar untuk order yang sudah selesai/batal.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getClientIp } from "../_shared/ip.ts";
import { createSnapTransaction } from "../_shared/midtrans.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_MESSAGES: Record<string, string> = {
  paid: "Pesanan ini sudah dibayar — tidak perlu bayar ulang, silakan refresh halaman.",
  completed: "Pesanan ini sudah selesai diverifikasi/diambil.",
  cancelled: "Pesanan ini sudah dibatalkan/kedaluwarsa. Silakan checkout ulang dari awal.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body: { order_token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const orderToken = body.order_token;
  if (!orderToken || !UUID_REGEX.test(orderToken)) {
    return jsonResponse(400, { error: "order_token tidak valid" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Rate limit per IP — cukup longgar (bukan bikin order/potong stok baru),
  // tapi tetap dibatasi supaya endpoint ini tidak dipakai spam-request.
  const ip = getClientIp(req);
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
    p_key: `resume-payment:${ip}`,
    p_max_attempts: 10,
    p_window_seconds: 60,
  });
  if (rateLimitError) {
    console.error("[resume-payment] rate limit check gagal:", rateLimitError);
    return jsonResponse(500, { error: "Gagal memproses, coba lagi" });
  }
  if (!allowed) {
    return jsonResponse(429, { error: "Terlalu banyak percobaan, coba lagi sebentar lagi" });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, status, snap_token, nama_customer, no_telp, email, total, order_items(id, product_id, nama_produk, qty, harga_satuan)",
    )
    .eq("order_token", orderToken)
    .single();

  if (orderError || !order) {
    return jsonResponse(404, { error: "Pesanan tidak ditemukan" });
  }

  if (order.status !== "pending") {
    return jsonResponse(409, {
      error: STATUS_MESSAGES[order.status] ?? "Pesanan ini tidak bisa dibayar ulang.",
      status: order.status,
    });
  }

  // Jalur normal (order dibuat setelah migration 0005): tinggal kembalikan
  // token yang sudah tersimpan dari transaksi PERTAMA — TIDAK ada panggilan
  // ke Midtrans sama sekali di sini.
  if (order.snap_token) {
    return jsonResponse(200, { snap_token: order.snap_token });
  }

  // Fallback untuk order lama (dibuat sebelum migration 0005, kolom masih
  // kosong) — order_id ini belum pernah tersimpan sebagai "sudah dipakai"
  // dari sisi kita, jadi create sekali di sini tetap valid. Kalau order_id
  // ini TERNYATA sudah dipakai di Midtrans (mis. race condition langka),
  // createSnapTransaction akan gagal dengan pesan Midtrans apa adanya —
  // tidak ditangani khusus, customer diarahkan lewat pesan error generik di
  // bawah untuk checkout ulang.
  type OrderItemRow = {
    id: string;
    product_id: string | null;
    nama_produk: string;
    qty: number;
    harga_satuan: number;
  };

  try {
    const snap = await createSnapTransaction({
      orderId: order.id,
      grossAmount: order.total,
      customer: {
        name: order.nama_customer,
        phone: order.no_telp,
        email: order.email,
      },
      items: ((order.order_items ?? []) as OrderItemRow[]).map((it) => ({
        id: it.product_id ?? it.id,
        name: it.nama_produk,
        price: it.harga_satuan,
        quantity: it.qty,
      })),
    });

    // Simpan supaya percobaan "Lanjutkan Pembayaran" BERIKUTNYA untuk order
    // lama ini juga lewat jalur normal (tidak create lagi).
    const { error: saveTokenError } = await supabase
      .from("orders")
      .update({ snap_token: snap.token })
      .eq("id", order.id);
    if (saveTokenError) {
      console.warn("[resume-payment] gagal simpan snap_token (non-fatal):", saveTokenError);
    }

    return jsonResponse(200, { snap_token: snap.token });
  } catch (err) {
    console.error("[resume-payment] gagal minta Snap token (fallback order lama):", err);
    return jsonResponse(500, {
      error:
        "Gagal melanjutkan pembayaran untuk pesanan ini. Silakan checkout ulang dari awal, atau hubungi admin.",
    });
  }
});
