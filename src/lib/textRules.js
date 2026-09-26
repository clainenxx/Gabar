// Aturan teks untuk field nama & lokasi di form checkout (ditambahkan
// 2026-09-19). Nama & lokasi ikut dikirim ke pesan WhatsApp/email, jadi
// tanpa batasan ini orang bisa menyisipkan link phishing lewat form.
//
// HARUS SAMA dengan `supabase/functions/_shared/checkout-guards.ts` (versi
// server). Server tetap sumber kebenaran — file ini cuma supaya customer
// langsung dapat pesan error di form tanpa menunggu round-trip. Kalau salah
// satu diubah, ubah dua-duanya.

const NAMA_ALLOWED = /^[\p{L}\p{M}\p{N} .,'’\-()]+$/u;
const LOKASI_ALLOWED = /^[\p{L}\p{M}\p{N} .,'’\-()/#&:+]+$/u;
const LOOKS_LIKE_LINK =
  /(https?|ftp|\bwww\b|\.(com|net|org|info|biz|id|co|me|io|xyz|link|app|ly|site|online|top|click|shop|store|tk|gg|to|cc|ws)\b)/i;

export const NAMA_ERROR_MESSAGE =
  "Nama hanya boleh huruf, angka, spasi, dan tanda baca umum (tanpa link atau simbol @ * _).";
export const LOKASI_ERROR_MESSAGE =
  "Lokasi hanya boleh huruf, angka, spasi, dan tanda baca umum (tanpa link atau simbol @ * _).";

export function isSafeNama(value) {
  const v = value.normalize("NFKC");
  return NAMA_ALLOWED.test(v) && !LOOKS_LIKE_LINK.test(v);
}

export function isSafeLokasi(value) {
  const v = value.normalize("NFKC");
  return LOKASI_ALLOWED.test(v) && !LOOKS_LIKE_LINK.test(v);
}
