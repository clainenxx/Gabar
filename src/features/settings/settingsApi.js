import { supabase } from "../../lib/supabaseClient.js";

// Tab "Pengaturan" (Modul 12 — ARCHITECTURE.md §6). Key-value sederhana di
// tabel `settings` (migrations/0002_schema_and_rls.sql), RLS
// "settings_all_admin" mengizinkan admin login baca/tulis langsung lewat
// anon key + RLS (tidak butuh Edge Function baru — beda dari Modul 3/1b
// yang butuh service role). Edge Function `midtrans-webhook` sudah baca
// key `notification_email` ini sejak Modul 9 (lihat komentar di
// supabase/functions/midtrans-webhook/index.ts).

const NOTIFICATION_EMAIL_KEY = "notification_email";

export async function getNotificationEmail() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", NOTIFICATION_EMAIL_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? "";
}

export async function setNotificationEmail(email) {
  const trimmed = email.trim();
  const { error } = await supabase
    .from("settings")
    .upsert({ key: NOTIFICATION_EMAIL_KEY, value: trimmed || null }, { onConflict: "key" });
  if (error) throw error;
  return trimmed;
}

// Modul 15a (ARCHITECTURE.md §6) — nomor WhatsApp tujuan notifikasi admin,
// BISA LEBIH DARI SATU (beda dari notification_email yang cuma 1 field).
// Disimpan di tabel `settings` yang sama (key baru, bukan tabel baru —
// pola sama dengan notification_email/dashboard cost defaults di atas,
// tidak perlu migration/RLS baru) sebagai JSON array of string, mis.
// '["6281234567890","6289876543210"]'. Dibaca Edge Function
// (`midtrans-webhook`/`public-checkout`, Modul 15b — BELUM ditulis di
// giliran ini) untuk kirim WA notifikasi order baru ke tiap nomor di sini.
const WHATSAPP_ADMIN_NUMBERS_KEY = "whatsapp_admin_numbers";

export async function getWhatsAppAdminNumbers() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", WHATSAPP_ADMIN_NUMBERS_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string" && n.trim()) : [];
  } catch {
    // Value rusak/bukan JSON (mis. sisa format lama) — jangan sampai
    // tab Pengaturan error total gara-gara ini, anggap saja kosong.
    return [];
  }
}

export async function setWhatsAppAdminNumbers(numbers) {
  // Buang entri kosong/whitespace sebelum simpan — form-nya sendiri yang
  // jaga validasi format nomor Indonesia (PengaturanTab.jsx), di sini cuma
  // pastikan tidak menyimpan array kosong string.
  const cleaned = (numbers ?? []).map((n) => String(n).trim()).filter(Boolean);
  const { error } = await supabase
    .from("settings")
    .upsert(
      { key: WHATSAPP_ADMIN_NUMBERS_KEY, value: cleaned.length ? JSON.stringify(cleaned) : null },
      { onConflict: "key" },
    );
  if (error) throw error;
  return cleaned;
}

// Komponen biaya untuk kartu "Profit / Keuntungan" di DashboardTab.jsx.
// Disimpan di tabel `settings` yang sama (key-value) supaya admin tidak
// perlu isi ulang tiap buka dashboard — "default" yang diminta (mis. Modal
// Rp200.000) sebenarnya adalah fallback kalau key belum pernah disimpan
// sama sekali (instalasi baru).
const DASHBOARD_COST_KEYS = {
  modal: "dashboard_modal_default",
  paymentFee: "dashboard_payment_fee_default",
  operational: "dashboard_operational_cost_default",
};
const DASHBOARD_COST_DEFAULTS = {
  modal: 200000,
  paymentFee: 0,
  operational: 0,
};

export async function getDashboardCostDefaults() {
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", Object.values(DASHBOARD_COST_KEYS));
  if (error) throw error;
  const byKey = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  const result = {};
  for (const [field, dbKey] of Object.entries(DASHBOARD_COST_KEYS)) {
    const raw = byKey[dbKey];
    result[field] = raw != null && raw !== "" ? Number(raw) : DASHBOARD_COST_DEFAULTS[field];
  }
  return result;
}

export async function setDashboardCostDefault(field, value) {
  const dbKey = DASHBOARD_COST_KEYS[field];
  if (!dbKey) throw new Error(`Unknown dashboard cost field: ${field}`);
  const { error } = await supabase
    .from("settings")
    .upsert({ key: dbKey, value: String(value) }, { onConflict: "key" });
  if (error) throw error;
}

// Fitur BARU — "Broadcast WA Belum Scan" (BroadcastWaTab.jsx): template
// pesan custom yang bisa ditambah/dikurangi admin sendiri (tiap "field" =
// 1 chat WA terpisah yang dikirim berurutan ke 1 nomor). Disimpan di
// tabel `settings` yang sama (key baru, JSON array of string — pola sama
// dengan `whatsapp_admin_numbers` di atas, tidak perlu migration/RLS
// baru). Placeholder yang didukung di tiap field: {nama} dan {pesanan}
// (diganti BroadcastWaTab.jsx saat kirim, bukan di sini).
const WA_BROADCAST_TEMPLATE_KEY = "wa_broadcast_template";

// Default kalau admin belum pernah menyimpan template sendiri — contoh
// persis yang diminta owner saat minta fitur ini dibuat.
const WA_BROADCAST_TEMPLATE_DEFAULT = [
  "Halo",
  "atas nama {nama}",
  "Pesanan kamu ({pesanan}) akan segera diantarkan siang ini, jadi mohon konfirmasinya",
];

export async function getWaBroadcastTemplate() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", WA_BROADCAST_TEMPLATE_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return WA_BROADCAST_TEMPLATE_DEFAULT;
  try {
    const parsed = JSON.parse(data.value);
    const fields = Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : null;
    return fields && fields.length ? fields : WA_BROADCAST_TEMPLATE_DEFAULT;
  } catch {
    // Value rusak/bukan JSON — jangan sampai tab ini error total, pakai default.
    return WA_BROADCAST_TEMPLATE_DEFAULT;
  }
}

export async function setWaBroadcastTemplate(fields) {
  // Field kosong/whitespace dibuang sebelum simpan — minimal harus sisa 1
  // field supaya tidak ada broadcast dengan 0 pesan.
  const cleaned = (fields ?? []).map((f) => String(f)).filter((f) => f.trim());
  if (!cleaned.length) throw new Error("Minimal harus ada 1 field pesan");
  const { error } = await supabase
    .from("settings")
    .upsert(
      { key: WA_BROADCAST_TEMPLATE_KEY, value: JSON.stringify(cleaned) },
      { onConflict: "key" },
    );
  if (error) throw error;
  return cleaned;
}
