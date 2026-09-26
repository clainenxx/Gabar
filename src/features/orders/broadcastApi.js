import { supabase } from "../../lib/supabaseClient.js";

// Fitur BARU: "Broadcast WA Belum Scan" (tab admin baru,
// BroadcastWaTab.jsx) — kirim WA custom (banyak "field" pesan berurutan)
// ke semua customer yang SUDAH bayar (`status = 'paid'`, cash maupun
// online — order cash juga langsung `paid` sejak checkout, lihat §0.7
// ARCHITECTURE.md) TAPI QR-nya BELUM di-scan admin (belum `completed`).
// Diurutkan `created_at` ASCENDING (yang beli paling duluan = paling awal
// di daftar/paling dulu dikirimi, yang beli paling akhir = paling akhir),
// sesuai permintaan owner.
//
// Sengaja query LANGSUNG lewat RLS `orders_select_admin` (sama pola dengan
// `listOrdersAdmin` di ordersApi.js) — cuma SELECT, tidak menyentuh
// mutasi/RPC apapun, jadi tidak perlu Edge Function untuk bagian ini.
const PENDING_SCAN_SELECT =
  "id, order_token, nama_customer, no_telp, payment_method, created_at, order_items(nama_produk, qty)";

export async function listPendingScanOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select(PENDING_SCAN_SELECT)
    .eq("status", "paid")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Ringkasan pesanan dalam 1 baris teks, dipakai untuk mengisi placeholder
// {pesanan} di template pesan — mis. "2x Gabin Coklat, 1x Gabin Keju".
export function formatOrderItemsSummary(order) {
  const items = order.order_items ?? [];
  if (!items.length) return "-";
  return items.map((it) => `${it.qty}x ${it.nama_produk}`).join(", ");
}

// Kirim SATU pesan teks ke SATU nomor lewat Edge Function `wa-broadcast-notify`
// (proxy admin-only ke whatsapp-service `/send`, lihat komentar lengkap di
// Edge Function-nya soal kenapa tidak dipanggil langsung dari sini).
export async function sendBroadcastMessage(phone, message) {
  const { data, error } = await supabase.functions.invoke("wa-broadcast-notify", {
    body: { phone, message },
  });
  if (error) {
    // supabase-js membungkus body error response Edge Function di
    // `error.context` (Response) — coba baca pesan aslinya kalau ada,
    // supaya progress log di UI menampilkan alasan gagal yang jelas
    // ("nomor tidak terdaftar WA", dst), bukan cuma "Edge Function returned
    // a non-2xx status code" yang generik dari supabase-js.
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      // biarkan detail = error.message bawaan
    }
    throw new Error(detail);
  }
  return data;
}
