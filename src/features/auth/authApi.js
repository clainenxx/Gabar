import { supabase } from "../../lib/supabaseClient.js";

// Ambil pesan asli dari body error Edge Function. supabase-js cuma memberi
// "Edge Function returned a non-2xx status code" di `error.message`; alasan
// sebenarnya (mis. "Terlalu banyak percobaan login") ada di body
// `error.context`. Kalau tidak ada body (mis. jaringan putus) pakai pesan
// Indonesia bawaan, bukan pesan Inggris dari library.
async function extractFunctionError(error, fallback) {
  try {
    const res = error?.context;
    if (res && typeof res.json === "function") {
      const body = await res.json();
      if (body?.error) return body.error;
    }
  } catch {
    // body bukan JSON / sudah terbaca — pakai pesan bawaan di bawah.
  }
  return fallback;
}

// Login admin — lewat Edge Function `admin-login` (bukan langsung
// `signInWithPassword`) supaya ada rate limit anti brute-force per IP &
// per email di server. Function memverifikasi password ke Supabase Auth dan
// mengembalikan token session, yang dipasang di sini lewat `setSession()`
// (hasilnya sama seperti login langsung: session tersimpan & event
// onAuthStateChange terpanggil, jadi `useAuth`/`RequireRole` tidak berubah).
// Tidak ada self sign-up publik: akun admin cuma dibuat lewat bootstrap SQL
// manual (admin pertama, lihat migrations/0001_profiles_and_auth.sql) atau
// Edge Function `manage-admin` (admin berikutnya, Modul 1b).
//
// `captchaToken` = token Cloudflare Turnstile dari widget di halaman login.
// SEKALI PAKAI: diteruskan function ke Supabase Auth, yang memverifikasinya ke
// Cloudflare (CAPTCHA protection di dashboard Supabase Auth) — jadi caller
// harus meminta token baru (reset widget) setelah tiap percobaan.
//
// Error yang dilempar membawa pesan siap tampil ke user (salah password,
// terlalu banyak percobaan, verifikasi keamanan gagal, layanan bermasalah).
export async function login(email, password, captchaToken) {
  const { data, error } = await supabase.functions.invoke("admin-login", {
    body: { email, password, captcha_token: captchaToken },
  });

  if (error) {
    throw new Error(
      await extractFunctionError(error, "Gagal menghubungi server login, coba lagi."),
    );
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error("Respons login tidak valid, coba lagi.");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;
  return sessionData;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
