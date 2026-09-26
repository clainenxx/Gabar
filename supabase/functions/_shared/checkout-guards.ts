// _shared/checkout-guards.ts — lapisan anti-penyalahgunaan untuk
// `public-checkout` (ditambahkan 2026-09-19, diminta owner setelah security
// review: order cash bisa dipakai untuk spam WhatsApp/email ke nomor orang
// lain lewat form checkout yang isinya bebas).
//
// Isi file ini (semuanya fungsi murni/kecil supaya gampang dites):
// 1. verifyTurnstile()  — verifikasi token Cloudflare Turnstile (anti-bot).
// 2. isSafeNama() / isSafeLokasi() — batasi karakter & tolak teks yang
//    menyerupai link. Nama & lokasi ikut dikirim ke pesan WhatsApp/email,
//    jadi tanpa ini penyerang bisa menyisipkan link phishing di dalamnya.
//    PENTING: ini heuristik, BUKAN pengganti Turnstile + rate limit.
// 3. phoneRateKey() / emailRateKey() / sha256Hex() — kunci rate limit per
//    nomor telepon & per email. Di-hash supaya tabel `rate_limits` tidak
//    menyimpan nomor/email mentah.
//
// KUNCI ATURAN `isSafeNama`/`isSafeLokasi` HARUS SAMA dengan
// `src/lib/textRules.js` (frontend) — kalau salah satu diubah, ubah dua-
// duanya. Server tetap sumber kebenaran; versi frontend cuma supaya
// customer dapat pesan error langsung tanpa menunggu round-trip.

// Huruf (semua bahasa), tanda diakritik, angka, spasi, dan tanda baca umum
// di nama orang. Sengaja TIDAK ada: @ * _ ~ ` (karakter format WhatsApp),
// / : # (dipakai URL), newline (bisa memecah baris pesan WA).
const NAMA_ALLOWED = /^[\p{L}\p{M}\p{N} .,'’\-()]+$/u;

// Lokasi sekolah lebih beragam ("Lab. Komputer #2", "Kantin/Lantai 2",
// "Gedung B: R.204") — jadi izinkan tambahan / # & : + . Tetap tanpa @ * _ ~ `.
const LOKASI_ALLOWED = /^[\p{L}\p{M}\p{N} .,'’\-()\/#&:+]+$/u;

// Pola yang menyerupai link/domain. Daftar TLD sengaja eksplisit (bukan
// "apa pun.apa pun") supaya penulisan wajar seperti "Lab.Komputer" atau
// "Lt.2" tidak ikut ditolak. Tambah TLD di sini kalau ketemu yang lolos.
const LOOKS_LIKE_LINK =
  /(https?|ftp|\bwww\b|\.(com|net|org|info|biz|id|co|me|io|xyz|link|app|ly|site|online|top|click|shop|store|tk|gg|to|cc|ws)\b)/i;

// NFKC: ubah karakter "lebar penuh"/variasi Unicode (mis. titik "．") jadi
// bentuk biasa dulu, supaya tidak bisa dipakai menyamarkan link.
function normalizeForCheck(value: string): string {
  return value.normalize("NFKC");
}

export function isSafeNama(value: string): boolean {
  const v = normalizeForCheck(value);
  return NAMA_ALLOWED.test(v) && !LOOKS_LIKE_LINK.test(v);
}

export function isSafeLokasi(value: string): boolean {
  const v = normalizeForCheck(value);
  return LOKASI_ALLOWED.test(v) && !LOOKS_LIKE_LINK.test(v);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Samakan penulisan nomor ("0812…", "+62 812…", "62812…") jadi 1 kunci —
// ambil 10 digit terakhir (proyek ini khusus nomor Indonesia). Mengembalikan
// null kalau jumlah digit tidak masuk akal (mis. input "++++++++" lolos regex
// telepon tapi tidak punya digit sama sekali, yang kalau dibiarkan akan
// menjadi satu kunci bersama untuk semua input sampah).
export function phoneRateKey(noTelp: string): string | null {
  const digits = noTelp.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.slice(-10);
}

// Samakan trik alias email supaya 1 orang tidak bisa "membelah" dirinya
// jadi banyak kunci: buang "+tag" (nama+1@x.com), dan untuk Gmail buang
// titik (n.ama@gmail.com == nama@gmail.com). Input diasumsikan sudah lolos
// EMAIL_REGEX (tepat 1 karakter "@").
export function emailRateKey(email: string): string {
  const [localRaw, domainRaw = ""] = email.toLowerCase().split("@");
  let domain = domainRaw;
  if (domain === "googlemail.com") domain = "gmail.com";
  let local = localRaw.split("+")[0] || localRaw;
  if (domain === "gmail.com") local = local.replace(/\./g, "") || local;
  return `${local}@${domain}`;
}

export type TurnstileResult = "ok" | "failed" | "unavailable" | "not_configured";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Token Turnstile sekali pakai & maksimal 2048 karakter (dokumentasi
// Cloudflare). Fail-CLOSED: kalau secret belum diset atau Cloudflare tidak
// bisa dihubungi, checkout ditolak — lebih baik gagal daripada diam-diam
// membiarkan bot lewat. Karena itu SET SECRET DULU sebelum deploy frontend
// versi baru (lihat catatan deploy di TODO.md).
export async function verifyTurnstile(token: unknown, ip: string): Promise<TurnstileResult> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return "not_configured";
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return "failed";

  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") form.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "unavailable";
    const data = await res.json();
    return data?.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
