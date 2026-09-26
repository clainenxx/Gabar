// _shared/midtrans.ts — helper integrasi Midtrans Snap (ARCHITECTURE.md
// §0.7, §1). Dipakai `public-checkout` (bikin transaksi baru, minta Snap
// token) dan `midtrans-webhook` (verifikasi signature key notifikasi).
// MIDTRANS_SERVER_KEY HANYA ada di Edge Function, tidak pernah di kode
// /src frontend yang di-bundle ke browser (AGENTS.md §4, ARCHITECTURE.md §5.9).

const SANDBOX_BASE_URL = "https://app.sandbox.midtrans.com";
const PRODUCTION_BASE_URL = "https://app.midtrans.com";

// Batas waktu bayar transaksi Snap (dikonfirmasi owner 2026-09-15): order
// online yang belum dibayar dalam 15 menit dianggap kedaluwarsa. SENGAJA
// diset eksplisit DI SINI (bukan cuma mengandalkan setting durasi expiry di
// Midtrans Dashboard, yang tidak kelihatan/tidak terdokumentasi dari kode)
// supaya perilakunya PASTI 15 menit apa pun isi setting dashboard saat itu
// (parameter `expiry` di request create-transaction selalu menang/override
// dashboard, dokumentasi resmi Midtrans) — dan supaya angka "15 menit" ini
// tertulis jelas di satu tempat kalau owner perlu ubah lagi nanti. Begitu
// transaksi ini kedaluwarsa, Midtrans otomatis kirim notifikasi webhook
// `transaction_status: "expire"` — SUDAH ditangani `midtrans-webhook`
// (Modul 8, ditulis sebelum fitur ini, TIDAK ADA perubahan): order jadi
// `cancelled` + stok semua item di-restore otomatis lewat
// `restore_product_stock`. Jadi restore stok otomatis SUDAH ADA dari
// awal — perubahan di file ini murni supaya expiry-nya PASTI 15 menit.
export const SNAP_EXPIRY_MINUTES = 15;

function midtransBaseUrl(): string {
  // MIDTRANS_IS_PRODUCTION belum relevan sampai Modul 14 (Testing & Deploy
  // Production) — default ke sandbox supaya tidak tiba-tiba nyambung ke
  // akun production kalau env var ini lupa diisi/di-set salah.
  const isProduction = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
  return isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

/**
 * Format waktu untuk field `expiry.start_time` Midtrans — wajib format
 * `yyyy-MM-dd HH:mm:ss ZZZZ` (offset numerik, BUKAN nama zona) per
 * dokumentasi resmi. GAGI beroperasi di WIB (Asia/Jakarta, UTC+7) — offset
 * `+0700` di-hardcode karena ini bisnis lokal Jakarta, satu zona waktu saja
 * (PRD.md), bukan aplikasi multi-timezone.
 */
function formatMidtransExpiryStartTime(date: Date): string {
  const jakartaMs = date.getTime() + 7 * 60 * 60 * 1000;
  const j = new Date(jakartaMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = j.getUTCFullYear();
  const MM = pad(j.getUTCMonth() + 1);
  const dd = pad(j.getUTCDate());
  const HH = pad(j.getUTCHours());
  const mm = pad(j.getUTCMinutes());
  const ss = pad(j.getUTCSeconds());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss} +0700`;
}

/**
 * Minta Snap token baru ke Midtrans untuk 1 order. `orderId` dipakai sebagai
 * Midtrans `order_id` — harus unik, di sini dipakai `orders.id` (UUID) yang
 * baru saja dibuat `public-checkout` (Modul 7).
 */
export async function createSnapTransaction(params: {
  orderId: string;
  grossAmount: number;
  customer: { name: string; phone: string; email: string };
  items: { id: string; name: string; price: number; quantity: number }[];
}): Promise<{ token: string; redirect_url: string }> {
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum diset di Edge Function secrets");

  // Snap API pakai HTTP Basic Auth dengan server key sebagai username,
  // password kosong (dokumentasi resmi Midtrans).
  const auth = btoa(`${serverKey}:`);

  const res = await fetch(`${midtransBaseUrl()}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: params.orderId,
        gross_amount: params.grossAmount,
      },
      // Batas waktu bayar 15 menit (dikonfirmasi owner 2026-09-15) — lihat
      // komentar `SNAP_EXPIRY_MINUTES` di atas untuk alasan lengkap.
      expiry: {
        start_time: formatMidtransExpiryStartTime(new Date()),
        unit: "minute",
        duration: SNAP_EXPIRY_MINUTES,
      },
      // Tidak dibatasi ke QRIS saja (ARCHITECTURE.md §0.7, dikonfirmasi
      // owner) — sengaja TIDAK mengirim `enabled_payments`, biar Snap
      // otomatis menawarkan semua metode yang diaktifkan owner di
      // Midtrans Dashboard.
      customer_details: {
        first_name: params.customer.name,
        phone: params.customer.phone,
        email: params.customer.email,
      },
      item_details: params.items.map((it) => ({
        id: it.id,
        // Midtrans membatasi `name` maksimal 50 karakter.
        name: it.name.slice(0, 50),
        price: it.price,
        quantity: it.quantity,
      })),
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = Array.isArray(data?.error_messages)
      ? data.error_messages.join(", ")
      : "Gagal membuat transaksi Midtrans";
    throw new Error(message);
  }
  return data as { token: string; redirect_url: string };
}

/**
 * Verifikasi signature key notifikasi webhook Midtrans (dokumentasi resmi):
 * `sha512(order_id + status_code + gross_amount + server_key)`.
 * Payment status TIDAK PERNAH dipercaya dari client — status `paid` hanya
 * boleh diubah setelah signature ini valid (ARCHITECTURE.md §5.2).
 */
export async function verifySignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): Promise<boolean> {
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum diset di Edge Function secrets");

  const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${serverKey}`;
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === params.signatureKey;
}

// CATATAN (TODO.md Bug/Isu #9): sempat ada fungsi `cancelPendingTransaction()`
// di sini (dipanggil dari resume-payment sebelum minta token baru) untuk
// coba "membebaskan" order_id yang sudah dipakai. Ternyata pendekatan itu
// TIDAK ANDAL untuk transaksi yang dibuat lewat Snap — sudah dihapus.
// Solusi yang benar: simpan & pakai ulang `snap_token` dari transaksi
// pertama (`orders.snap_token`, migration 0005), bukan minta/cancel
// transaksi baru — lihat resume-payment/index.ts.
