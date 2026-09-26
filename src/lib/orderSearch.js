// Helper untuk tab Pesanan admin (`PesananTab.jsx`): kode antar, link halaman
// order pelanggan, dan pencarian. Dipisah dari komponen supaya logikanya bisa
// dites tanpa merender UI (semuanya fungsi murni).

/**
 * "Kode antar" = 8 karakter pertama `order_token`, huruf besar. Ini kode yang
 * SAMA dengan yang tercetak di kartu WhatsApp pelanggan ("Kode: 3F2A9C1E",
 * `whatsapp-service/order-card.js`) dan di halaman `/order/:token`
 * ("No. Pesanan #3F2A9C1E", `OrderQr.jsx`). Hanya kosmetik — pengganti token
 * asli TIDAK boleh dipakai untuk verifikasi.
 */
export function shortOrderCode(orderToken) {
  return String(orderToken ?? "")
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Link halaman order milik pelanggan (`/order/:order_token`). Admin dan situs
 * publik satu domain, jadi origin diambil dari browser yang sedang dipakai.
 */
export function orderPageUrl(orderToken, origin) {
  const base =
    origin ?? (typeof window !== "undefined" && window.location ? window.location.origin : "");
  return `${base}/order/${orderToken}`;
}

// Nomor telepon dibandingkan dalam bentuk digit tanpa awalan 0/62, supaya
// "0812…", "+62 812…", dan "812…" semuanya menemukan pesanan yang sama.
export function phoneKey(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .replace(/^(62|0)/, "");
}

// Query yang hanya berisi karakter yang lazim di nomor telepon. Dipakai untuk
// membatasi pencocokan "digit saja": tanpa batas ini, mengetik kode antar
// seperti "3F2A9C1E" akan diambil digitnya ("3291") lalu dicocokkan ke nomor
// telepon orang lain dan memunculkan pesanan yang tidak relevan.
const PHONE_LIKE = /^[\d\s+\-().]+$/;

/**
 * Rapikan input pencarian:
 *  - link halaman order (domain apa pun, dengan/tanpa "https://") diubah
 *    menjadi token-nya saja, jadi menempelkan link dari WhatsApp/email
 *    langsung menemukan pesanannya;
 *  - kode antar boleh diketik dengan awalan "#".
 */
export function normalizeOrderQuery(raw) {
  let q = String(raw ?? "").trim().toLowerCase();
  const fromLink = q.match(/\/order\/([0-9a-f-]{8,})/);
  if (fromLink) q = fromLink[1];
  return q.replace(/^#/, "");
}

/**
 * Apakah `order` cocok dengan `query`. Yang dicari: nama, no. telp, email,
 * kode antar, Lokasi 1/2, link halaman order, nama produk, metode & status.
 *
 * `statusText` = label status yang tampil di tabel (dihitung komponen karena
 * bergantung pada metode bayar), supaya admin bisa mencari "Selesai Diantar".
 */
export function orderMatchesQuery(order, query, statusText = "") {
  const q = normalizeOrderQuery(query);
  if (!q) return true;

  const token = String(order.order_token ?? "");
  const haystack = [
    order.nama_customer,
    order.no_telp,
    order.email,
    order.lokasi_1,
    order.lokasi_2,
    token,
    shortOrderCode(token),
    `/order/${token}`,
    order.payment_method,
    statusText,
    ...(order.order_items ?? []).map((item) => item.nama_produk),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (haystack.includes(q)) return true;

  if (PHONE_LIKE.test(q)) {
    const digits = q.replace(/\D/g, "");
    return digits.length >= 3 && phoneKey(order.no_telp).includes(phoneKey(digits));
  }
  return false;
}
