// Helper pola kirim "tidak seperti robot" untuk server.js (ditambahkan
// 2026-09-20). Dipisah ke file sendiri supaya bisa dites tanpa harus
// menjalankan Baileys/Express.
//
// Kenapa perlu: pola kirim yang terlalu rapi dan padat (jeda persis sama,
// pesan beruntun tanpa napas, puluhan pesan tertunda dikirim sekaligus
// sesaat setelah perangkat baru ditautkan) adalah pola yang gampang
// dikenali sebagai otomatis. CATATAN JUJUR: ini cuma MENGURANGI risiko,
// bukan jaminan — WhatsApp juga membatasi pesan ke kontak yang belum pernah
// berinteraksi (error 463) di sisi server, dan itu tidak bisa dihindari
// dengan jeda acak. Lihat README.md bagian "Kenapa nomor bisa ter-logout".

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Baca angka milidetik dari env var; nilai kosong/salah/negatif -> fallback.
export function envMs(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Durasi status "mengetik..." — patokan dasar (`baseMs`, dari
// TYPING_DELAY_MS) + tambahan sesuai panjang pesan (pesan panjang butuh
// waktu ngetik lebih lama, maksimal +2,5 detik), lalu dikali faktor acak
// 0,75-1,25 supaya tidak pernah persis sama antar pesan.
export function typingDelayMs(message, baseMs, rand = Math.random) {
  const lengthMs = Math.min(String(message).length * 15, 2500);
  const jitter = 0.75 + rand() * 0.5;
  return Math.round((baseMs + lengthMs) * jitter);
}

// Jeda acak antar 2 pesan berurutan di antrian, di kisaran [minMs, maxMs].
export function gapDelayMs(minMs, maxMs, rand = Math.random) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.round(lo + rand() * (hi - lo));
}
