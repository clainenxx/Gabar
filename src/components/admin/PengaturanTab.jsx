import { useCallback, useEffect, useState } from "react";
import {
  getNotificationEmail,
  setNotificationEmail,
  getWhatsAppAdminNumbers,
  setWhatsAppAdminNumbers,
} from "../../features/settings/settingsApi.js";

// Validasi ringan nomor Indonesia di sisi frontend — SENGAJA diduplikasi
// dari logic `normalizeIndonesianPhone()` di
// `supabase/functions/_shared/whatsapp.ts` (bukan di-import) karena file
// itu jalan di runtime Deno (Edge Function), tidak bisa diimpor langsung
// ke bundle Vite/frontend. Kalau logic normalisasi di sana berubah,
// SESUAIKAN JUGA fungsi ini (dicatat di komentar `_shared/whatsapp.ts`
// juga). Dipakai cuma untuk validasi UX form ini — normalisasi final
// & pengiriman WA sungguhan tetap dilakukan Edge Function (Modul 15b).
function normalizeIndonesianPhoneLocal(raw) {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  let n = cleaned.replace(/^\+/, "");
  if (n.startsWith("0")) {
    n = "62" + n.slice(1);
  } else if (n.startsWith("8")) {
    n = "62" + n;
  }
  if (!/^62\d{8,13}$/.test(n)) return null;
  return n;
}

// Tab "Pengaturan" (Modul 12 — ARCHITECTURE.md §6/DoD): admin ubah alamat
// email tujuan notifikasi order baru, disimpan ke settings.notification_email.
// Edge Function `midtrans-webhook` (Modul 9) sudah membaca key ini setiap
// order jadi `paid` — tab ini cuma UI untuk mengisi/mengubahnya, tidak ada
// perubahan skema/RLS/logic pembayaran (WORKFLOW.md §2 tidak berlaku di sini).
export default function PengaturanTab() {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Modul 15a — nomor WA admin (list dinamis, bisa lebih dari 1).
  const [waNumbers, setWaNumbers] = useState([""]);
  const [savedWaNumbers, setSavedWaNumbers] = useState([]);
  const [waSaving, setWaSaving] = useState(false);
  const [waError, setWaError] = useState(null);
  const [waSuccess, setWaSuccess] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setWaError(null);
    try {
      const [value, numbers] = await Promise.all([
        getNotificationEmail(),
        getWhatsAppAdminNumbers(),
      ]);
      setEmail(value);
      setSavedEmail(value);
      // Selalu tampilkan minimal 1 baris input kosong kalau belum ada
      // nomor tersimpan sama sekali, supaya form tidak kelihatan kosong
      // total tanpa cara nambah baris pertama.
      setWaNumbers(numbers.length ? numbers : [""]);
      setSavedWaNumbers(numbers);
    } catch (err) {
      setError(err.message || "Gagal memuat pengaturan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmed = email.trim();
    // Validasi format sederhana — dikosongkan berarti sengaja mematikan
    // notifikasi admin (midtrans-webhook melewati pengiriman kalau kosong,
    // lihat komentar di index.ts-nya), jadi field kosong tetap boleh disimpan.
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Format email tidak valid");
      return;
    }

    setSaving(true);
    try {
      const stored = await setNotificationEmail(trimmed);
      setSavedEmail(stored);
      setEmail(stored);
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-white/80">Memuat pengaturan...</p>;
  }

  const isDirty = email.trim() !== savedEmail;

  // --- Modul 15a: handler nomor WA admin ---
  function handleWaNumberChange(index, value) {
    setWaNumbers((prev) => prev.map((n, i) => (i === index ? value : n)));
    setWaSuccess(false);
  }

  function handleAddWaNumber() {
    setWaNumbers((prev) => [...prev, ""]);
    setWaSuccess(false);
  }

  function handleRemoveWaNumber(index) {
    setWaNumbers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Selalu sisakan minimal 1 baris input supaya form tidak hilang
      // total — baris kosong ini tidak ikut tersimpan (difilter saat submit).
      return next.length ? next : [""];
    });
    setWaSuccess(false);
  }

  async function handleWaSubmit(e) {
    e.preventDefault();
    setWaError(null);
    setWaSuccess(false);

    // Baris kosong (belum diisi) dilewati begitu saja — bukan error,
    // supaya admin bisa nambah baris baru tanpa buru-buru isi semua dulu.
    const nonEmpty = waNumbers.map((n) => n.trim()).filter(Boolean);

    const invalid = nonEmpty.filter((n) => !normalizeIndonesianPhoneLocal(n));
    if (invalid.length) {
      setWaError(
        `Format nomor tidak dikenali: ${invalid.join(", ")} — pakai format 08xx, +62xx, atau 62xx.`,
      );
      return;
    }

    // Normalisasi ke bentuk 62xxxxxxxxxx sebelum simpan — konsisten
    // dengan apa yang bakal dibaca/dipakai Edge Function nanti (Modul 15b).
    const normalized = nonEmpty.map((n) => normalizeIndonesianPhoneLocal(n));
    const deduped = [...new Set(normalized)];

    setWaSaving(true);
    try {
      const stored = await setWhatsAppAdminNumbers(deduped);
      setSavedWaNumbers(stored);
      setWaNumbers(stored.length ? stored : [""]);
      setWaSuccess(true);
    } catch (err) {
      setWaError(err.message || "Gagal menyimpan nomor WhatsApp admin");
    } finally {
      setWaSaving(false);
    }
  }

  const waIsDirty =
    JSON.stringify(waNumbers.map((n) => n.trim()).filter(Boolean)) !==
    JSON.stringify(savedWaNumbers);

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3 max-w-md"
      >
        <h2 className="text-lg font-semibold">Notifikasi Order Baru</h2>
        <p className="text-sm text-white/70">
          Alamat email ini akan menerima notifikasi setiap ada order baru yang sudah{" "}
          dibayar (lengkap dengan Lokasi 1/Lokasi 2 tujuan antar). Kosongkan untuk
          mematikan notifikasi ini.
        </p>

        <div>
          <label className="block text-sm mb-1">Email tujuan notifikasi</label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSuccess(false);
            }}
            placeholder="mis. owner@gabar.com"
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
          />
          <p className="mt-1 text-xs text-white/60">
            {savedEmail
              ? `Saat ini terisi: ${savedEmail}`
              : "Belum diisi — notifikasi email ke admin masih dilewati."}
          </p>
        </div>

        {error && <p className="text-sm text-red-200">{error}</p>}
        {success && !error && (
          <p className="text-sm text-emerald-200">Pengaturan tersimpan.</p>
        )}

        <button
          type="submit"
          disabled={saving || !isDirty}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
      </form>

      <form
        onSubmit={handleWaSubmit}
        className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3 max-w-md"
      >
        <h2 className="text-lg font-semibold">Notifikasi WhatsApp Admin</h2>
        <p className="text-sm text-white/70">
          Nomor-nomor ini akan menerima notifikasi WhatsApp setiap ada order baru
          (isinya sama seperti email notifikasi admin di atas). Bisa diisi lebih
          dari satu nomor. Kosongkan semua untuk mematikan notifikasi ini.
          <br />
          <span className="text-white/50">
            Catatan: pengiriman WA sungguhan ke nomor-nomor ini menyusul di
            modul berikutnya — tab ini baru menyimpan daftar nomornya.
          </span>
        </p>

        <div className="space-y-2">
          {waNumbers.map((num, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="tel"
                value={num}
                onChange={(e) => handleWaNumberChange(index, e.target.value)}
                placeholder="mis. 081234567890"
                className="flex-1 rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
              />
              <button
                type="button"
                onClick={() => handleRemoveWaNumber(index)}
                className="rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm hover:bg-white/20"
                aria-label="Hapus nomor ini"
              >
                Hapus
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAddWaNumber}
          className="rounded-lg bg-white/10 border border-white/30 px-4 py-2 text-sm hover:bg-white/20"
        >
          + Tambah nomor
        </button>

        <p className="text-xs text-white/60">
          {savedWaNumbers.length
            ? `Saat ini tersimpan: ${savedWaNumbers.join(", ")}`
            : "Belum ada nomor tersimpan — notifikasi WA ke admin masih dilewati."}
        </p>

        {waError && <p className="text-sm text-red-200">{waError}</p>}
        {waSuccess && !waError && (
          <p className="text-sm text-emerald-200">Nomor WhatsApp admin tersimpan.</p>
        )}

        <button
          type="submit"
          disabled={waSaving || !waIsDirty}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {waSaving ? "Menyimpan..." : "Simpan"}
        </button>
      </form>
    </div>
  );
}
