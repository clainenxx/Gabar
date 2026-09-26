// Edge Function: get-order (anon) — Modul 7 (ARCHITECTURE.md §6).
// Lookup order by `order_token` pakai SERVICE ROLE, BUKAN RLS publik —
// `orders` sengaja tidak punya policy SELECT untuk anon sama sekali
// (ARCHITECTURE.md §5.1). Endpoint ini jadi satu-satunya jalur publik untuk
// melihat detail order milik sendiri, dijaga oleh `order_token` yang tidak
// bisa ditebak (UUID v4 random, §5.5) — bukan oleh RLS.
//
// Dipakai halaman `/order/:order_token` (OrderQr.jsx) untuk tampilkan QR +
// status order, dan disegarkan lagi lewat Realtime Postgres Changes
// (subscribeOrderStatus, lib/realtime.js) saat status berubah.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getClientIp } from "../_shared/ip.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Rate limit per IP (ditambahkan 2026-09-18, temuan security review owner)
  // — sebelumnya endpoint ini (anon, tanpa JWT) bisa ditembak berkali-kali
  // tanpa batas sama sekali. Data tetap aman (dijaga UUID v4 order_token
  // yang praktis tidak bisa ditebak, BUKAN oleh rate limit ini), tapi tanpa
  // batas begini endpoint bisa disalahgunakan buat spam request (biaya
  // Supabase invocation + beban server) — bukan celah pencurian data, murni
  // hardening cost/abuse. Limit dibuat LEBIH LONGGAR dari resume-payment
  // (30 vs 10 per menit) karena endpoint ini juga dipanggil otomatis oleh
  // realtime/polling normal saat customer legitimate buka halaman
  // `/order/:token` berkali-kali (refresh, dsb) — bukan cuma 1x klik.
  const ip = getClientIp(req);
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
    p_key: `get-order:${ip}`,
    p_max_attempts: 30,
    p_window_seconds: 60,
  });
  if (rateLimitError) {
    console.error("[get-order] rate limit check gagal:", rateLimitError);
    return jsonResponse(500, { error: "Gagal memproses, coba lagi" });
  }
  if (!allowed) {
    return jsonResponse(429, { error: "Terlalu banyak percobaan, coba lagi sebentar lagi" });
  }

  // `id` ikut dikirim supaya frontend bisa subscribe Realtime Postgres
  // Changes (filter `id=eq.<id>`, lib/realtime.js `subscribeOrderStatus`).
  // Sengaja TIDAK ikut kirim `no_telp`/`email` di respons publik ini —
  // halaman QR cuma butuh nama, lokasi, status, dan rincian item, tidak
  // perlu expose kontak customer ke siapapun yang kebetulan tahu link.
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      // `payment_method` ditambahkan (Fitur Pembayaran Cash, migration 0008)
      // supaya halaman `/order/:order_token` (OrderQr.jsx) bisa menampilkan
      // teks status yang berbeda untuk order cash (mis. "Menunggu Di-scan"
      // untuk status 'paid' + 'cash', bukan "Sudah Dibayar") — bukan data
      // sensitif, aman ikut disertakan di respons publik ini.
      "id, order_token, status, payment_method, nama_customer, lokasi_1, lokasi_2, subtotal, total, created_at, order_items(nama_produk, qty, harga_satuan, subtotal)",
    )
    .eq("order_token", orderToken)
    .single();

  if (error || !order) {
    return jsonResponse(404, { error: "Order tidak ditemukan" });
  }

  return jsonResponse(200, order);
});
