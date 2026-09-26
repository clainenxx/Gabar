// Edge Function: wa-broadcast-notify — Fitur BARU "Broadcast WA Belum Scan"
// (tab admin baru, lihat src/components/admin/BroadcastWaTab.jsx).
//
// Kenapa harus lewat Edge Function (bukan admin panel manggil
// whatsapp-service langsung dari browser): secret `WHATSAPP_SERVICE_URL` /
// `WHATSAPP_SERVICE_API_KEY` HARUS tetap hanya ada di Edge Function
// Secrets (ARCHITECTURE.md §5.9/§9b) — kalau admin panel (kode /src,
// jalan di browser customer... eh, admin) memanggil whatsapp-service
// langsung, API key WA harus ikut dikirim ke bundle frontend, yang artinya
// SIAPA SAJA yang buka devtools bisa mencuri API key itu dan pakai nomor
// WA ke-2 owner untuk kirim spam bebas. Jadi pola di sini SAMA PERSIS
// dengan `midtrans-webhook`/`public-checkout`: Edge Function yang pegang
// kedua secret itu, admin panel cuma panggil Edge Function ini (bawa JWT
// admin yang login).
//
// Beda dari `sendWhatsAppBatch()` (_shared/whatsapp.ts, dipakai order
// masuk): endpoint ini SATU PESAN TEKS PLAIN per panggilan (proxy ke
// `/send` whatsapp-service, BUKAN `/send-batch`) — sengaja begitu, karena
// pacing (jeda 5 detik + animasi "mengetik" per pesan, jeda 10 detik per
// nomor) di fitur broadcast ini diatur SEPENUHNYA dari frontend
// (`BroadcastWaTab.jsx`), bukan dari antrian in-memory whatsapp-service
// seperti Modul 15b. Frontend yang mengatur urutan panggilan endpoint ini
// satu per satu dengan delay-nya sendiri, supaya progress/animasi bisa
// ditampilkan live di layar admin sinkron dengan pesan yang benar-benar
// terkirim.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceUrl = Deno.env.get("WHATSAPP_SERVICE_URL") ?? "";
  const serviceApiKey = Deno.env.get("WHATSAPP_SERVICE_API_KEY") ?? "";

  // 1. Wajib admin yang login (pola sama persis manage-admin/index.ts) —
  // JWT si pemanggil dicek pakai anon key, BUKAN service role, supaya
  // current_user_role() mengembalikan role si pemanggil yang sebenarnya.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Belum login — hanya admin yang boleh kirim broadcast WA" });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return jsonResponse(401, { error: "Sesi tidak valid — silakan login ulang" });
  }

  const { data: callerRole, error: roleError } = await callerClient.rpc("current_user_role");
  if (roleError || callerRole !== "admin") {
    return jsonResponse(403, { error: "Hanya admin yang boleh kirim broadcast WA" });
  }

  if (!serviceUrl || !serviceApiKey) {
    return jsonResponse(500, {
      error: "WHATSAPP_SERVICE_URL/WHATSAPP_SERVICE_API_KEY belum diset di Edge Function Secrets",
    });
  }

  let body: { phone?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const phone = body.phone?.trim();
  const message = body.message?.trim();
  if (!phone || !/^62\d{8,13}$/.test(phone)) {
    return jsonResponse(400, { error: "Field 'phone' tidak valid (harus format 62xxxxxxxxxx)" });
  }
  if (!message) {
    return jsonResponse(400, { error: "Field 'message' wajib diisi" });
  }

  // 2. Teruskan ke whatsapp-service `/send` (pesan teks plain, satu nomor,
  // satu panggilan = satu pesan) — TIDAK pakai `/send-batch` (lihat
  // komentar berkas ini di atas kenapa).
  try {
    const upstream = await fetch(`${serviceUrl.replace(/\/+$/, "")}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": serviceApiKey },
      body: JSON.stringify({ phone, message }),
    });
    const upstreamBody = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return jsonResponse(upstream.status, {
        error: upstreamBody?.error ?? "Gagal kirim pesan WhatsApp",
      });
    }
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(502, {
      error: `Tidak bisa menghubungi whatsapp-service: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});
