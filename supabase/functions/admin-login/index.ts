// Edge Function: admin-login (anon) — rate limit anti brute-force untuk
// login admin (ditambahkan 2026-09-19, diminta owner langsung di chat).
//
// Sebelumnya `AdminLogin.jsx` memanggil `supabase.auth.signInWithPassword`
// langsung dari browser, jadi TIDAK ada batas apa pun dari sisi aplikasi
// terhadap tebak-tebakan password. Sekarang login lewat function ini:
//   1. Batas per IP    — cegah 1 sumber mencoba banyak email/password.
//   2. Batas per email — cegah tebak password 1 akun dari banyak IP.
//   3. Baru setelah lolos keduanya, password diverifikasi ke Supabase Auth
//      dan session (access + refresh token) dikembalikan ke browser, yang
//      memasangnya lewat `supabase.auth.setSession()`.
//
// Memakai RPC `check_rate_limit` + tabel `rate_limits` yang SUDAH ada
// (ARCHITECTURE.md §0.12) — tidak ada tabel/kolom/RLS baru.
//
// CAPTCHA (Cloudflare Turnstile): browser mengirim token Turnstile yang
// diteruskan APA ADANYA ke `signInWithPassword` (`options.captchaToken`).
// Verifikasinya dilakukan Supabase Auth sendiri (Dashboard > Authentication >
// Attack Protection > Enable CAPTCHA protection, provider Turnstile, isi
// secret key) — BUKAN di function ini. Sengaja: token Turnstile sekali pakai,
// jadi kalau function ini ikut memverifikasi ke Cloudflare, Supabase akan
// menolaknya sebagai duplikat. Keuntungannya, endpoint Supabase Auth
// (`/auth/v1/token`) yang bisa dipanggil langsung pakai anon key publik ikut
// tertutup: tanpa token Turnstile valid, ditolak. PENTING: selama toggle di
// dashboard itu belum aktif, token dari browser tidak diperiksa siapa pun.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getClientIp } from "../_shared/ip.ts";
import { sha256Hex } from "../_shared/checkout-guards.ts";

// Angka sengaja mengikuti pola function lain (fixed window lewat
// `check_rate_limit`). Wajar untuk admin manusia (salah ketik 2-3x tidak
// kena), tapi membatasi penebak ke ~120 tebakan/jam per IP dan ~40/jam per
// akun.
const IP_MAX_ATTEMPTS = 10;
const IP_WINDOW_SECONDS = 5 * 60;
const EMAIL_MAX_ATTEMPTS = 10;
const EMAIL_WINDOW_SECONDS = 15 * 60;

// Batas panjang input — supaya body raksasa tidak dikirim ke Supabase Auth
// (bcrypt hanya membaca 72 byte pertama, jadi password >256 pasti bukan
// input manusia yang wajar).
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 256;
// Batas token Turnstile menurut dokumentasi Cloudflare.
const CAPTCHA_TOKEN_MAX_LENGTH = 2048;

const MSG_INVALID_CREDENTIALS = "Email atau password salah.";
const MSG_TOO_MANY = "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.";
const MSG_UNAVAILABLE = "Layanan login sedang bermasalah, coba lagi sebentar lagi.";
const MSG_CAPTCHA = "Verifikasi keamanan gagal atau kedaluwarsa, coba lagi.";

// Respons berisi token session — jangan sampai tersimpan di cache perantara.
function sessionResponse(body: unknown): Response {
  const res = jsonResponse(200, body);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body: { email?: unknown; password?: unknown; captcha_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const { email: rawEmail, password, captcha_token: captchaToken } = body;
  if (typeof rawEmail !== "string" || typeof password !== "string") {
    return jsonResponse(400, { error: "Email dan password wajib diisi" });
  }
  // Ditolak lebih awal (sebelum menyentuh rate limit/Auth) kalau token tidak
  // ada sama sekali. Validitas token sendiri diperiksa Supabase Auth.
  if (
    typeof captchaToken !== "string" ||
    captchaToken.length === 0 ||
    captchaToken.length > CAPTCHA_TOKEN_MAX_LENGTH
  ) {
    return jsonResponse(400, { error: MSG_CAPTCHA });
  }
  const email = rawEmail.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > EMAIL_MAX_LENGTH ||
    password.length === 0 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    // Sengaja pesan generik yang sama dengan salah password — tidak
    // membocorkan aturan validasi ke penyerang.
    return jsonResponse(401, { error: MSG_INVALID_CREDENTIALS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  // Service role dipakai HANYA untuk `check_rate_limit` (EXECUTE-nya cuma
  // diberikan ke service_role, lihat migration 0002) dan menghapus counter
  // saat login sukses. Verifikasi password memakai client anon terpisah di
  // bawah, supaya kredensial service role tidak pernah menyentuh flow user.
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // 1. Batas per IP. Dicek DULU dan return lebih awal: request dari IP yang
  // sudah diblokir tidak menambah counter email (tidak bisa dipakai
  // penyerang untuk mengunci akun admin dari IP yang sudah kena limit).
  const ip = getClientIp(req);
  const { data: ipAllowed, error: ipError } = await admin.rpc("check_rate_limit", {
    p_key: `admin-login:ip:${ip}`,
    p_max_attempts: IP_MAX_ATTEMPTS,
    p_window_seconds: IP_WINDOW_SECONDS,
  });
  if (ipError) {
    // Fail-closed: kalau pengecekan limit gagal, login ditolak — lebih baik
    // admin menunggu sebentar daripada limit diam-diam mati.
    console.error("[admin-login] rate limit IP gagal:", ipError);
    return jsonResponse(500, { error: MSG_UNAVAILABLE });
  }
  if (!ipAllowed) {
    console.warn(`[admin-login] diblokir (limit IP): ${ip}`);
    return jsonResponse(429, { error: MSG_TOO_MANY });
  }

  // 2. Batas per email. Di-hash supaya `rate_limits` tidak menyimpan email
  // mentah; sudah lowercase di atas supaya "Admin@x.com" dan "admin@x.com"
  // jadi 1 kunci yang sama.
  const emailKey = `admin-login:email:${await sha256Hex(email)}`;
  const { data: emailAllowed, error: emailError } = await admin.rpc("check_rate_limit", {
    p_key: emailKey,
    p_max_attempts: EMAIL_MAX_ATTEMPTS,
    p_window_seconds: EMAIL_WINDOW_SECONDS,
  });
  if (emailError) {
    console.error("[admin-login] rate limit email gagal:", emailError);
    return jsonResponse(500, { error: MSG_UNAVAILABLE });
  }
  if (!emailAllowed) {
    console.warn(`[admin-login] diblokir (limit email) dari IP: ${ip}`);
    return jsonResponse(429, { error: MSG_TOO_MANY });
  }

  // 3. Verifikasi password ke Supabase Auth. Client tanpa persist session —
  // ini server, tidak ada localStorage dan session tidak boleh menempel di
  // instance function yang dipakai ulang antar request.
  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });

  if (error || !data.session) {
    const status = error?.status ?? 0;
    // Token Turnstile ditolak Supabase Auth (salah/kedaluwarsa/sudah dipakai).
    // Dicek sebelum pemetaan status supaya tidak salah dilaporkan sebagai
    // "salah password". Pesan Supabase berbunyi mis. "captcha protection:
    // request disallowed (timeout-or-duplicate)".
    if (error && (error.code === "captcha_failed" || /captcha/i.test(error.message))) {
      return jsonResponse(400, { error: MSG_CAPTCHA });
    }
    if (status === 429) {
      // Batas bawaan Supabase Auth ikut kena — teruskan sebagai 429.
      return jsonResponse(429, { error: MSG_TOO_MANY });
    }
    if (status >= 500 || status === 0) {
      // 0 = error jaringan/fetch (bukan jawaban dari Auth). Bukan salah
      // password, jadi jangan dilaporkan sebagai salah password.
      console.error("[admin-login] Supabase Auth bermasalah:", error?.message);
      return jsonResponse(503, { error: MSG_UNAVAILABLE });
    }
    // Password salah, email tidak ada, email belum terkonfirmasi, dll —
    // satu pesan yang sama supaya tidak bisa dipakai menebak email yang
    // terdaftar (user enumeration).
    return jsonResponse(401, { error: MSG_INVALID_CREDENTIALS });
  }

  // Login sukses: reset counter email supaya salah ketik admin sebelumnya
  // tidak ikut menghabiskan jatah login berikutnya. Aman karena hanya bisa
  // terjadi kalau password benar. Counter IP sengaja TIDAK direset (itu yang
  // menahan penyemprotan banyak email dari 1 sumber). Gagal reset tidak
  // membatalkan login.
  const { error: resetError } = await admin.from("rate_limits").delete().eq("key", emailKey);
  if (resetError) {
    console.error("[admin-login] gagal reset counter email:", resetError);
  }

  // Cuma 2 token yang dibutuhkan `setSession()` di browser — sisa objek
  // user/session tidak perlu ikut dikirim.
  return sessionResponse({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});
