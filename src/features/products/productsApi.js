import { supabase } from "../../lib/supabaseClient.js";

// CRUD produk — dipakai tab "Produk" di /admin (Modul 3, ARCHITECTURE.md
// §6). RLS "products_select_admin"/"products_insert_admin"/dst (migrations/
// 0002_schema_and_rls.sql) mengizinkan role admin lihat SEMUA produk
// (termasuk nonaktif) dan CRUD penuh — jadi cukup query langsung pakai anon
// key, tidak butuh Edge Function (beda dari upload gambar yang butuh
// kredensial R2, lihat imageUploadApi.js).
//
// Tidak ada kolom varian/flavors (ARCHITECTURE.md §0.9, dikonfirmasi owner).

const ADMIN_SELECT = "id, nama, deskripsi, harga, category_id, gambar_url, aktif, stock, created_at, updated_at, categories(nama)";

export async function listProductsAdmin() {
  const { data, error } = await supabase
    .from("products")
    .select(ADMIN_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProduct(input) {
  const { data, error } = await supabase
    .from("products")
    .insert({
      nama: input.nama.trim(),
      deskripsi: input.deskripsi?.trim() || null,
      harga: input.harga,
      category_id: input.category_id,
      gambar_url: input.gambar_url || null,
      aktif: input.aktif ?? true,
      stock: input.stock ?? 0,
    })
    .select(ADMIN_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, updates) {
  const { data, error } = await supabase
    .from("products")
    .update(updates)
    .eq("id", id)
    .select(ADMIN_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

// Penyesuaian stok cepat (Modul 6 — Realtime Stok Produk, ARCHITECTURE.md
// §6). Lewat RPC "update_product_stock" (migrations/0003_realtime_stock.sql)
// supaya validasi (admin-only, stok >= 0) konsisten di 1 tempat, dipakai
// tombol +/- di ProductsTab.jsx tanpa perlu buka form edit penuh. Form edit
// penuh (ProductForm.jsx) tetap pakai `updateProduct()` di atas — tidak
// diubah, karena RLS "products_update_admin" sudah cukup untuk update
// banyak kolom sekaligus (nama/harga/dll, bukan cuma stok).
export async function updateProductStock(id, newStock) {
  const { data, error } = await supabase.rpc("update_product_stock", {
    p_product_id: id,
    p_new_stock: newStock,
  });
  if (error) throw error;
  return data;
}
