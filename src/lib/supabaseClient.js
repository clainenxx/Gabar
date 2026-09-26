import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Sengaja dibiarkan sebagai warning, bukan throw — supaya app tetap bisa
  // dibuka (mis. halaman /setup-check) sebelum .env diisi owner (Modul 0).
  console.warn(
    "[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi di .env",
  );
}

// Frontend HANYA boleh pakai anon key (RLS yang menjaga akses),
// service role key tidak pernah ada di kode /src (ARCHITECTURE.md §5.9).
export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");
