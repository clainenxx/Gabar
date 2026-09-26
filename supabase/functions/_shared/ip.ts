// _shared/ip.ts — helper tunggal ambil IP client untuk keperluan rate
// limit (`check_rate_limit` RPC), dipakai `public-checkout`, `resume-payment`,
// `get-order`. Sebelumnya fungsi identik ini terduplikasi di 3 file
// terpisah — dipindah ke sini (2026-09-18) sekalian dengan fix keamanan di
// bawah, supaya kalau ada perbaikan lagi di masa depan cukup 1 tempat,
// tidak berisiko salah satu Edge Function lupa ikut di-update.
//
// Fix keamanan (temuan security review, 2026-09-18): SEBELUMNYA fungsi ini
// ambil entri PERTAMA (leftmost) `x-forwarded-for` — itu SPOOFABLE, karena
// format header ini "client, proxy1, proxy2, ..." dan tiap hop cuma
// MENAMBAHKAN di kanan, tidak pernah menghapus/memvalidasi apa yang client
// kirim duluan. Attacker tinggal kirim header
// `X-Forwarded-For: <ip-bebas>` sendiri dari request-nya, dan nilai itu
// akan selalu jadi entri PERTAMA — rate limit per-IP jadi gampang dilewati
// cuma dengan ganti-ganti header ini tiap request. Dikonfirmasi juga di
// GitHub Discussion resmi Supabase (supabase/supabase#34647): "when the
// client overwrites the x-forwarded-for header, the real IP is
// concatenated with the spoofed one" — artinya IP ASLI yang ditambahkan
// infrastruktur Supabase justru ada di entri TERAKHIR (rightmost), bukan
// pertama.
//
// FIX: prioritaskan `cf-connecting-ip` (kalau ada — header ini di-SET ULANG
// oleh edge Cloudflare berdasarkan koneksi TCP asli, BUKAN ditempel/di-
// append seperti XFF, jadi client tidak bisa override nilainya kalau
// request memang lewat Cloudflare). Kalau header itu tidak ada, fallback ke
// entri TERAKHIR `x-forwarded-for` (bukan pertama lagi) sesuai temuan di
// atas — masih belum 100% sempurna tanpa tahu pasti berapa hop proxy tepat
// di depan Supabase, tapi jauh lebih tahan spoof dibanding ambil entri
// pertama yang terbukti caller-controlled.
export function getClientIp(req: Request): string {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}
