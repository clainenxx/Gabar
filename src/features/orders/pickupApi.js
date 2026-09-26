import { supabase } from "../../lib/supabaseClient.js";

// Modul 10 — Scan QR Verifikasi Serah Terima (ARCHITECTURE.md §6). Mutasi
// status order ke `completed` HANYA lewat RPC SECURITY DEFINER
// `verify_order_pickup` (bukan UPDATE langsung — tabel `orders` sengaja
// tidak punya policy UPDATE sama sekali untuk client manapun,
// `0002_schema_and_rls.sql` / ARCHITECTURE.md §5 poin 1 & 3).
//
// RPC ini melempar error dengan SQLSTATE custom supaya UI (`ScanQrTab.jsx`)
// bisa membedakan jenis penolakan tanpa parsing teks pesan — lihat komentar
// lengkap di `supabase/migrations/0004_verify_order_pickup.sql`:
//   P0002 -> pesanan sudah pernah diverifikasi sebelumnya (double-scan)
//   P0003 -> QR kedaluwarsa (lebih dari 1x seminggu sejak dipesan)
//   P0004 -> status order belum `paid` (masih pending / sudah cancelled)
//   (default, mis. "42P01"/tanpa code khusus) -> pesanan tidak ditemukan /
//   error lain yang tidak terduga
//
// Melempar ulang error apa adanya (bukan di-wrap jadi `Error` polos seperti
// `checkoutApi.js`) supaya `err.code` dari Postgres tetap bisa dibaca
// pemanggil untuk branching pesan sukses/warning/error yang berbeda.
export async function verifyOrderPickup(orderToken) {
  const { data, error } = await supabase.rpc("verify_order_pickup", {
    p_order_token: orderToken,
  });
  if (error) throw error;
  return data;
}
