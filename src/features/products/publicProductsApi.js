import { supabase } from "../../lib/supabaseClient.js";

// Query produk aktif untuk halaman publik "/" (Modul 5 — ARCHITECTURE.md
// §6). RLS "products_select_active" (migrations/0002_schema_and_rls.sql)
// sudah membatasi hasil ke `aktif = true` di level database, jadi anon key
// aman dipakai langsung tanpa Edge Function (sama pola seperti
// productsApi.js untuk admin, cuma select-nya lebih ramping).
//
// Stok 0 SENGAJA tidak difilter di sini — PRD.md §4.1: produk stok habis
// tetap tampil dengan label "Stok Habis", tombol tambah cuma dinonaktifkan
// di UI (lihat ProductCard.jsx), bukan disembunyikan dari daftar.
//
// Live update stok tanpa reload (<1 detik) adalah scope Modul 6 (Realtime
// Stok Produk, `subscribeProductStock` di `lib/realtime.js`) — query di
// sini baru sekali saat halaman dimuat/direfresh.
const PUBLIC_SELECT = "id, nama, deskripsi, harga, gambar_url, stock, category_id";

export async function listActiveProducts() {
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_SELECT)
    .order("nama", { ascending: true });
  if (error) throw error;
  return data;
}
