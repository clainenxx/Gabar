import { supabase } from "../../lib/supabaseClient.js";

// Modul 11 — Laporan Penjualan & Riwayat Pesanan (ARCHITECTURE.md §2/§4.2/
// §6). RLS "orders_select_admin" & "order_items_select_admin"
// (migrations/0002_schema_and_rls.sql) mengizinkan role admin SELECT semua
// order + order_items langsung pakai anon key — tidak butuh Edge Function
// di sini karena ini murni baca data (mutasi status order tetap HANYA
// lewat RPC `verify_order_pickup` / webhook Midtrans, tidak disentuh oleh
// modul ini sama sekali, AGENTS.md §4).

// `payment_method` ditambahkan (Fitur Pembayaran Cash, migration 0008) —
// dipakai tab "Pesanan" untuk menandai order cash vs online, supaya admin
// tahu order mana yang perlu ditagih tunai saat mengantar.
const ORDER_SELECT =
  "id, order_token, status, payment_method, nama_customer, no_telp, email, lokasi_1, lokasi_2, subtotal, total, created_at, order_items(id, nama_produk, qty, harga_satuan, subtotal)";

// `from`/`to` adalah ISO string batas rentang tanggal (lihat
// `src/lib/dateRange.js`) — `to` eksklusif, dipakai `.lt(...)` bukan
// `.lte(...)` supaya tidak dobel-hitung baris di batas hari berikutnya.
// Preset "Semua" (`computeDateRange("semua")`) mengirim `from`/`to` sebagai
// `null` — di situ `.gte`/`.lt` DILEWATI sama sekali (bukan cuma dikasih
// rentang lebar) supaya benar-benar mengambil SELURUH histori order tanpa
// batas tanggal. Dipakai bareng oleh tab "Dashboard" & "Pesanan" supaya
// keduanya selalu query data yang sama persis untuk rentang tanggal yang
// sama (termasuk saat sama-sama pakai "Semua").
export async function listOrdersAdmin({ from, to }) {
  let query = supabase.from("orders").select(ORDER_SELECT);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Total penjualan HANYA dihitung dari order berstatus `paid`/`completed`
// (ARCHITECTURE.md §4.2 — `pending`/`cancelled` sengaja dikecualikan, sama
// seperti pola AyamKu Modul 13). Dihitung di frontend dari hasil query
// `listOrdersAdmin` yang sama dipakai tab Pesanan (bukan query/RPC agregat
// terpisah) — supaya tidak ada 2 sumber hitungan yang berpotensi beda
// hasil kalau salah satu lupa disinkronkan.
const COUNTED_STATUSES = new Set(["paid", "completed"]);

export function isCountedOrderStatus(status) {
  return COUNTED_STATUSES.has(status);
}

export function summarizeOrders(orders) {
  const counted = orders.filter((o) => COUNTED_STATUSES.has(o.status));
  return {
    totalPenjualan: counted.reduce((sum, o) => sum + Number(o.total), 0),
    jumlahPesanan: counted.length,
    jumlahPending: orders.filter((o) => o.status === "pending").length,
    jumlahDibatalkan: orders.filter((o) => o.status === "cancelled").length,
  };
}

// Ringkasan khusus pesanan CASH (owner minta, 2026-09-15): jumlah pesanan
// cash yang terhitung "terjual" (status `paid`/`completed`, sama definisi
// `COUNTED_STATUSES` dengan `summarizeOrders` di atas — order cash yang
// masih `paid` belum tentu tunainya sudah diterima admin, tapi tetap
// dihitung "terjual" sejak checkout dibuat, sama seperti diskusi Modul 7d),
// totalnya dalam Rupiah, dan jumlah yang DIBATALKAN ADMIN. Order cash
// SATU-SATUNYA jenis order yang bisa dibatalkan manual oleh admin
// (`cancel_cash_order` RPC, migration `0009` — order online cuma bisa
// `cancelled` otomatis lewat webhook Midtrans saat expire/deny/cancel,
// admin tidak punya tombol batalkan untuk order online), jadi
// `jumlahDibatalkanAdmin` di sini SELALU sama dengan seluruh order cash
// berstatus `cancelled` — tidak perlu kolom/flag baru di skema untuk
// membedakan "dibatalkan admin" vs "dibatalkan sistem", karena secara
// desain cuma cash yang bisa dibatalkan admin.
export function summarizeCashOrders(orders) {
  const cashOrders = orders.filter((o) => o.payment_method === "cash");
  const cashCounted = cashOrders.filter((o) => COUNTED_STATUSES.has(o.status));
  const cashCancelled = cashOrders.filter((o) => o.status === "cancelled");
  return {
    jumlahCash: cashCounted.length,
    totalCash: cashCounted.reduce((sum, o) => sum + Number(o.total), 0),
    jumlahDibatalkanAdmin: cashCancelled.length,
  };
}

// Dipakai DashboardTab.jsx untuk membedakan "customer baru" vs "customer
// lama (repeat)" pada rentang tanggal yang sedang dipilih. Cuma ambil 2
// kolom (no_telp, created_at) dari SELURUH histori order (tidak difilter
// tanggal) supaya query tetap ringan — no_telp dipakai sebagai identitas
// customer (§0 tidak ada tabel customers terpisah, jadi diturunkan dari
// data order langsung). Diurutkan ascending supaya kemunculan pertama tiap
// no_telp di hasil = order pertama customer itu sepanjang masa.
export async function listCustomerFirstOrderDates() {
  const { data, error } = await supabase
    .from("orders")
    .select("no_telp, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const firstOrderByPhone = new Map();
  for (const row of data ?? []) {
    if (!firstOrderByPhone.has(row.no_telp)) {
      firstOrderByPhone.set(row.no_telp, row.created_at);
    }
  }
  return firstOrderByPhone;
}

// Rentang "Statistik Revenue" (hari ini/minggu ini/bulan ini) + chart 7 hari
// terakhir selalu independen dari filter tanggal utama — pakai
// `computeDashboardStatsWindow()` (src/lib/dateRange.js) untuk rentangnya.
export async function listOrdersForStatsWindow({ from, to }) {
  const { data, error } = await supabase
    .from("orders")
    .select("status, total, created_at")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Pembatalan manual order CASH (ditambahkan 2026-09-14, dikonfirmasi owner
// via chat, migration `0009_cancel_cash_order.sql`) — dipakai tombol
// "Batalkan" di tab "Pesanan" (`PesananTab.jsx`), khusus untuk order
// `payment_method = 'cash'` yang ternyata tidak jadi diantar/diambil. Sama
// seperti `verifyOrderPickup` (`pickupApi.js`), mutasi status HANYA lewat
// RPC SECURITY DEFINER ini (tabel `orders` tetap tidak punya policy UPDATE
// untuk client manapun) — melempar ulang error apa adanya (bukan di-wrap)
// supaya `err.code` (PT404/PT422/PT409) tetap bisa dibaca pemanggil untuk
// pesan yang spesifik, lihat komentar lengkap di migration `0009`.
export async function cancelCashOrder(orderId) {
  const { data, error } = await supabase.rpc("cancel_cash_order", { p_order_id: orderId });
  if (error) throw error;
  return data;
}
