import { supabase } from "./supabaseClient.js";

// Helper generik untuk subscribe ke Postgres Changes (BUKAN Broadcast —
// GAGI tidak punya kasir/display untuk disinkronkan, lihat ARCHITECTURE.md §0.1).

/**
 * Subscribe ke perubahan stok produk publik (Modul 6 — Realtime Stok Produk).
 * @param {(payload: object) => void} onChange
 * @returns {() => void} unsubscribe function
 */
export function subscribeProductStock(onChange) {
  const channel = supabase
    .channel("products-stock")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "products" },
      onChange,
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * Subscribe ke perubahan status 1 order tertentu (Modul 7/10 — auto-update
 * halaman /order/:order_token dari pending/paid ke completed).
 *
 * Dengar dari `order_status_public` (Modul 7c) — BUKAN tabel `orders`
 * langsung. `orders` sengaja tidak pernah didaftarkan ke publication
 * `supabase_realtime` maupun dikasih RLS select untuk anon (berisi PII
 * customer), jadi subscribe langsung ke situ tidak akan pernah menerima
 * event apapun. `order_status_public` adalah tabel bayangan tanpa PII
 * (cuma order_id/order_token/status) yang disinkron otomatis lewat
 * trigger tiap `orders.status` berubah — lihat
 * 0006_order_status_public_realtime.sql untuk detail lengkapnya.
 * @param {string} orderId
 * @param {(payload: object) => void} onChange
 * @returns {() => void} unsubscribe function
 */
export function subscribeOrderStatus(orderId, onChange) {
  const channel = supabase
    .channel(`order-${orderId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "order_status_public",
        filter: `order_id=eq.${orderId}`,
      },
      onChange,
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
