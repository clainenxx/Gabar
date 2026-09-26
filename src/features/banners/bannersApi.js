import { supabase } from "../../lib/supabaseClient.js";

// CRUD banner — dipakai tab "Banner" di /admin (Modul 4, ARCHITECTURE.md
// §6). RLS "banners_select_admin"/"banners_insert_admin"/dst
// (migrations/0002_schema_and_rls.sql) mengizinkan role admin lihat SEMUA
// banner (termasuk nonaktif) dan CRUD penuh — sama seperti pola
// productsApi.js di Modul 3, cukup anon key + RLS, tidak butuh Edge
// Function (upload gambarnya sendiri lewat imageUploadApi.js, folder
// "banners", sudah reusable dari Modul 3).
//
// Publik (anon) hanya bisa SELECT banner yang `aktif = true`
// ("banners_select_active") — itu yang menentukan tampil/tidaknya di
// carousel homepage, bukan filter di sisi query admin ini.

const ADMIN_SELECT = "id, gambar_url, judul, link, urutan, aktif, created_at";

export async function listBannersAdmin() {
  const { data, error } = await supabase
    .from("banners")
    .select(ADMIN_SELECT)
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createBanner(input) {
  const { data, error } = await supabase
    .from("banners")
    .insert({
      gambar_url: input.gambar_url,
      judul: input.judul?.trim() || null,
      link: input.link?.trim() || null,
      urutan: input.urutan ?? 0,
      aktif: input.aktif ?? true,
    })
    .select(ADMIN_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateBanner(id, updates) {
  const { data, error } = await supabase
    .from("banners")
    .update(updates)
    .eq("id", id)
    .select(ADMIN_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBanner(id) {
  const { error } = await supabase.from("banners").delete().eq("id", id);
  if (error) throw error;
}

// Tukar `urutan` dua banner sekaligus (dipakai tombol naik/turun di
// BannersTab.jsx) supaya urutan carousel gampang diatur tanpa perlu drag &
// drop — 2 UPDATE terpisah, bukan RPC, karena tidak menyentuh
// uang/keamanan (WORKFLOW.md §1: AI boleh jalan otonom untuk ini).
export async function swapBannerUrutan(bannerA, bannerB) {
  const [resA, resB] = await Promise.all([
    supabase.from("banners").update({ urutan: bannerB.urutan }).eq("id", bannerA.id),
    supabase.from("banners").update({ urutan: bannerA.urutan }).eq("id", bannerB.id),
  ]);
  if (resA.error) throw resA.error;
  if (resB.error) throw resB.error;
}

// Query publik untuk carousel banner di homepage (Modul 5 — ARCHITECTURE.md
// §6). RLS "banners_select_active" (migrations/0002_schema_and_rls.sql)
// sudah membatasi hasil ke `aktif = true` di level database, jadi anon key
// aman dipakai langsung tanpa Edge Function — filter di sini cuma untuk
// kejelasan kode, bukan satu-satunya lapisan keamanan.
export async function listActiveBanners() {
  const { data, error } = await supabase
    .from("banners")
    .select("id, gambar_url, judul, link, urutan")
    .order("urutan", { ascending: true });
  if (error) throw error;
  return data;
}
