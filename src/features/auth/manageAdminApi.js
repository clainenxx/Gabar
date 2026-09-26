import { supabase } from "../../lib/supabaseClient.js";

// Kelola akun admin lain — dipakai tab "Akun Admin" di /admin (Modul 1b,
// ARCHITECTURE.md §0.2/§6). Semua akun admin hak aksesnya identik, tidak
// ada tingkatan (§0.2).
//
// List pakai query langsung (RLS "profiles_select_admin" mengizinkan admin
// lihat semua profil admin). Create/delete WAJIB lewat Edge Function
// `manage-admin` (service role) karena butuh `auth.admin.*` dan `profiles`
// tidak punya policy INSERT/DELETE untuk client (migrations/0001_profiles_and_auth.sql).

export async function listAdmins() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createAdmin({ email, password, full_name }) {
  const { data, error } = await supabase.functions.invoke("manage-admin", {
    body: { action: "create", email, password, full_name },
  });
  if (error) throw new Error(error.message || "Gagal menghubungi layanan kelola akun admin");
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function deleteAdmin(id) {
  const { data, error } = await supabase.functions.invoke("manage-admin", {
    body: { action: "delete", id },
  });
  if (error) throw new Error(error.message || "Gagal menghubungi layanan kelola akun admin");
  if (data?.error) throw new Error(data.error);
  return data;
}
