// Edge Function: manage-admin (service role) — Modul 1b (Manajemen Akun
// Admin). Pola sama seperti `manage-staff` di AyamKu: pakai
// `supabase.auth.admin.createUser()`, BUKAN self sign-up publik
// (ARCHITECTURE.md §0.2). Dua action: "create" dan "delete".
//
// Kenapa harus lewat Edge Function (bukan client langsung):
// 1. `supabase.auth.admin.*` cuma bisa dipanggil pakai service role key —
//    kredensial itu tidak boleh pernah ada di kode /src (§5.9).
// 2. Tabel `profiles` sengaja tidak punya policy INSERT/DELETE untuk client
//    manapun (migrations/0001_profiles_and_auth.sql) — penambahan/penghapusan
//    baris profil admin cuma boleh terjadi lewat jalur terverifikasi ini.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // 1. Wajib ada admin yang login untuk memanggil endpoint ini sama sekali —
  // dicek pakai client yang bawa JWT si pemanggil (BUKAN service role),
  // supaya current_user_role() mengembalikan role pemanggil yang sebenarnya.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Belum login — hanya admin yang boleh kelola akun admin" });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return jsonResponse(401, { error: "Sesi tidak valid — silakan login ulang" });
  }

  const { data: callerRole, error: roleError } = await callerClient.rpc("current_user_role");
  if (roleError || callerRole !== "admin") {
    return jsonResponse(403, { error: "Hanya admin yang boleh kelola akun admin" });
  }

  let body: { action?: string; email?: string; password?: string; full_name?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  // Service-role client — satu-satunya yang boleh createUser/deleteUser dan
  // bypass RLS `profiles`. Tidak pernah dipakai untuk apapun yang berasal
  // dari input mentah tanpa validasi di atas.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "create") {
    return handleCreate(adminClient, body);
  }
  if (body.action === "delete") {
    return handleDelete(adminClient, caller.id, body);
  }
  return jsonResponse(400, { error: "action harus 'create' atau 'delete'" });
});

async function handleCreate(
  adminClient: ReturnType<typeof createClient>,
  body: { email?: string; password?: string; full_name?: string },
) {
  const email = body.email?.trim();
  const password = body.password;
  const fullName = body.full_name?.trim();

  if (!email) return jsonResponse(400, { error: "Email wajib diisi" });
  if (!password || password.length < 8) {
    return jsonResponse(400, { error: "Password minimal 8 karakter" });
  }
  if (!fullName) return jsonResponse(400, { error: "Nama lengkap wajib diisi" });

  // email_confirm: true — akun langsung aktif tanpa perlu klik link
  // verifikasi email, sama seperti pola bootstrap admin pertama manual
  // (migrations/0001_profiles_and_auth.sql).
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return jsonResponse(400, { error: createError?.message || "Gagal membuat akun" });
  }

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    email,
    role: "admin",
  });
  if (profileError) {
    // Jangan sampai ada akun auth "yatim" tanpa baris profiles — batalkan
    // akun yang baru dibuat kalau gagal simpan profilnya.
    await adminClient.auth.admin.deleteUser(created.user.id);
    return jsonResponse(500, {
      error: "Gagal menyimpan profil admin, pembuatan akun dibatalkan: " + profileError.message,
    });
  }

  return jsonResponse(200, { id: created.user.id, email, full_name: fullName, role: "admin" });
}

async function handleDelete(
  adminClient: ReturnType<typeof createClient>,
  callerId: string,
  body: { id?: string },
) {
  const targetId = body.id;
  if (!targetId) return jsonResponse(400, { error: "id wajib diisi" });

  // Cegah admin menghapus akunnya sendiri yang sedang dipakai login —
  // supaya tidak keputus akses di tengah sesi tanpa sengaja.
  if (targetId === callerId) {
    return jsonResponse(400, { error: "Tidak bisa menghapus akun sendiri yang sedang login" });
  }

  // Cegah proyek kehabisan admin sama sekali (self-lockout untuk semua
  // orang) — selalu sisakan minimal 1 akun admin.
  const { count, error: countError } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (countError) {
    return jsonResponse(500, { error: "Gagal mengecek jumlah admin: " + countError.message });
  }
  if ((count ?? 0) <= 1) {
    return jsonResponse(400, { error: "Tidak bisa menghapus admin terakhir yang tersisa" });
  }

  // Hapus dari auth.users — baris `profiles` ikut terhapus otomatis lewat
  // FK `on delete cascade` (migrations/0001_profiles_and_auth.sql), tidak
  // perlu DELETE manual dua kali.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
  if (deleteError) {
    return jsonResponse(400, { error: deleteError.message });
  }

  return jsonResponse(200, { deleted: targetId });
}
