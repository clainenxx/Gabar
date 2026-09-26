// Edge Function: product-image-upload — Modul 3 (Manajemen Produk).
// Tugasnya cuma satu: keluarkan presigned URL upload R2 untuk admin yang
// SUDAH login, supaya kredensial R2 tidak pernah bocor ke frontend
// (ARCHITECTURE.md §5.7, §5.9). Folder-aware ("products" | "banners") biar
// bisa dipakai lagi apa adanya di Modul 4 (Banner) — lihat ARCHITECTURE.md §6.
//
// Yang dicek di sini SEBELUM keluarkan presigned URL:
// 1. Ada JWT admin yang login & valid (bukan anon) — anon tidak pernah boleh
//    upload gambar produk/banner.
// 2. Role user itu memang 'admin' (AGENTS.md §2: role tunggal admin).
// 3. folder cuma "products"/"banners", fileName ada, dan ekstensinya gambar
//    yang diizinkan — supaya endpoint ini tidak disalahgunakan untuk upload
//    file sembarangan ke bucket R2.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getPresignedUploadUrl } from "../_shared/r2.ts";

const ALLOWED_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;
const ALLOWED_FOLDERS = new Set(["products", "banners"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // 1. Wajib ada Authorization header berisi JWT user yang login (bukan
  // anon key polos) — supaya auth.getUser() di bawah bisa identifikasi
  // siapa yang minta upload.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Belum login — upload gambar hanya untuk admin" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return jsonResponse(401, { error: "Sesi tidak valid — silakan login ulang" });
  }

  // 2. current_user_role() dipanggil lewat client yang sama (bawa JWT user
  // ini) supaya hasilnya benar-benar role user yang sedang login, bukan
  // ditebak dari body request (yang bisa dipalsukan client).
  const { data: role, error: roleError } = await supabase.rpc("current_user_role");
  if (roleError || role !== "admin") {
    return jsonResponse(403, { error: "Hanya admin yang boleh upload gambar" });
  }

  // 3. Validasi body — jangan percaya folder/fileName mentah dari client.
  let body: { folder?: string; fileName?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const { folder, fileName, contentType } = body ?? {};
  if (!folder || !ALLOWED_FOLDERS.has(folder)) {
    return jsonResponse(400, { error: "folder harus 'products' atau 'banners'" });
  }
  if (!fileName || typeof fileName !== "string") {
    return jsonResponse(400, { error: "fileName wajib diisi" });
  }
  if (!ALLOWED_EXTENSION.test(fileName)) {
    return jsonResponse(400, {
      error: "Ekstensi file harus salah satu dari: jpg, jpeg, png, webp, gif",
    });
  }

  try {
    const result = await getPresignedUploadUrl(
      folder as "products" | "banners",
      fileName,
      contentType,
    );
    return jsonResponse(200, result);
  } catch (err) {
    console.error("[product-image-upload] gagal generate presigned URL:", err);
    return jsonResponse(500, { error: "Gagal membuat URL upload gambar" });
  }
});
