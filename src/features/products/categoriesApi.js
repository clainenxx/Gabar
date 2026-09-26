import { supabase } from "../../lib/supabaseClient.js";

// CRUD kategori — dipakai tab "Produk" di /admin (Modul 3, ARCHITECTURE.md
// §6). Semua akses pakai anon key + RLS ("categories_*_admin",
// migrations/0002_schema_and_rls.sql), bukan service role (AGENTS.md §4).

export async function listCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, nama, urutan, created_at")
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCategory({ nama, urutan }) {
  const { data, error } = await supabase
    .from("categories")
    .insert({ nama: nama.trim(), urutan: urutan ?? 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, updates) {
  const { data, error } = await supabase
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    // FK products.category_id -> categories(id) on delete restrict
    // (migrations/0002_schema_and_rls.sql) — kategori yang masih dipakai
    // produk sengaja tidak boleh terhapus begitu saja.
    if (error.code === "23503") {
      throw new Error(
        "Kategori masih dipakai oleh satu atau lebih produk — pindahkan/hapus produknya dulu.",
      );
    }
    throw error;
  }
}
