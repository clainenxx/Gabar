import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SITE_CONTENT,
  getSiteContent,
  updateSiteContent,
} from "../../features/settings/siteContentApi.js";
import { uploadImage } from "../../features/products/imageUploadApi.js";
import ImageDropInput from "./ImageDropInput.jsx";

// Tab "Konten Halaman" (perluasan Modul 12/Pengaturan): admin ubah teks-teks yang tampil di
// landing page publik "/" — hero, header section Produk, section "Tentang
// GAGI" (judul/deskripsi + 3 fitur), dan footer (nama brand/tagline/3 baris
// cara pesan) — tanpa perlu deploy ulang kode. Disimpan sebagai satu baris
// JSON di tabel `site_content` (siteContentApi.js), dibaca oleh Home.jsx/
// AboutSection.jsx/Footer.jsx di halaman publik.
//
// Logo brand (diupload ke R2, folder "logos") dan nomor telepon "Hubungi
// Kami" di footer juga diatur dari sini. Logo tampil di navbar publik,
// navbar admin, dan footer publik.
//
// Field yang TIDAK ada di sini (link navigasi footer, ikon fitur "Tentang",
// tahun copyright) sengaja tetap fixed di kode — bukan konten yang wajar
// diedit non-developer lewat form teks biasa.
function emptyStateFrom(content) {
  // Clone dalam supaya form bisa diedit bebas tanpa mutasi state asli.
  return JSON.parse(JSON.stringify(content));
}

function Field({ label, value, onChange, textarea = false, maxLength }) {
  const commonProps = {
    value,
    onChange: (e) => onChange(e.target.value),
    className:
      "w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50",
    maxLength,
  };
  return (
    <div>
      <label className="block text-xs font-medium text-white/80 mb-1">{label}</label>
      {textarea ? (
        <textarea rows={3} {...commonProps} />
      ) : (
        <input type="text" {...commonProps} />
      )}
    </div>
  );
}

// Nomor telepon: hanya digit, spasi, "+", "-", "(" dan ")", 8-20 karakter.
const PHONE_PATTERN = /^\+?[\d\s\-()]{7,19}$/;

export default function KontenHalamanTab({ onSaved }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  // Logo baru yang dipilih tapi belum diupload — baru diupload saat "Simpan"
  // (sama pola dengan form Banner/Produk), preview pakai blob lokal.
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const content = await getSiteContent();
      setSaved(content);
      setForm(emptyStateFrom(content));
    } catch (err) {
      setError(err.message || "Gagal memuat konten halaman");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(path, value) {
    setSuccess(false);
    setForm((prev) => {
      const next = emptyStateFrom(prev);
      let node = next;
      for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]];
      node[path[path.length - 1]] = value;
      return next;
    });
  }

  function handleLogoChange(e) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setSuccess(false);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function handleRemoveLogo() {
    setSuccess(false);
    setLogoFile(null);
    setLogoPreview(null);
    update(["logo", "url"], "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const phone = (form.footer.phone || "").trim();
    if (phone && !PHONE_PATTERN.test(phone)) {
      return setError(
        "Nomor telepon tidak valid — pakai angka saja (boleh diawali +, spasi, tanda - atau kurung), mis. 0812-3456-7890",
      );
    }

    setSaving(true);
    try {
      const next = emptyStateFrom(form);
      next.footer.phone = phone;
      if (logoFile) {
        next.logo.url = await uploadImage(logoFile, "logos", (status) =>
          setUploadStatus(
            status === "compressing" ? "Mengompres logo..." : "Mengupload logo...",
          ),
        );
      }
      const stored = await updateSiteContent(next);
      setSaved(stored);
      setForm(emptyStateFrom(stored));
      setLogoFile(null);
      setLogoPreview(null);
      setSuccess(true);
      onSaved?.(stored);
    } catch (err) {
      setError(err.message || "Gagal menyimpan konten halaman");
    } finally {
      setUploadStatus(null);
      setSaving(false);
    }
  }

  function handleReset() {
    // Logo dan nomor telepon bukan "teks default" — dibiarkan apa adanya
    // supaya tombol ini tidak diam-diam menghapus logo/kontak yang sudah diisi.
    const defaults = emptyStateFrom(DEFAULT_SITE_CONTENT);
    defaults.logo.url = form.logo.url;
    defaults.footer.phone = form.footer.phone;
    setForm(defaults);
    setSuccess(false);
  }

  if (loading || !form) {
    return <p className="text-white/80">Memuat konten halaman...</p>;
  }

  const isDirty = Boolean(logoFile) || JSON.stringify(form) !== JSON.stringify(saved);
  const currentLogo = logoPreview || form.logo.url || null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <p className="text-sm text-white/70">
        Ubah teks yang tampil di halaman utama publik ("/"). Perubahan langsung terlihat
        pelanggan setelah disimpan, tanpa perlu deploy ulang.
      </p>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Logo</h2>
        <p className="text-xs text-white/70">
          Tampil di navbar halaman publik, navbar admin, dan footer publik. Kalau belum ada
          logo, dipakai kotak huruf "G". Disarankan gambar persegi (mis. 512×512).
        </p>
        <ImageDropInput
          imagePreview={currentLogo}
          onFileChange={handleLogoChange}
          previewClassName="h-20 w-20"
          previewFit="contain"
        />
        {currentLogo && (
          <button
            type="button"
            onClick={handleRemoveLogo}
            className="rounded-lg bg-red-500/20 border border-red-300/30 px-3 py-1.5 text-xs hover:bg-red-500/30"
          >
            Hapus logo
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Hero (bagian paling atas)</h2>
        <Field
          label="Label badge kecil"
          value={form.hero.badge}
          onChange={(v) => update(["hero", "badge"], v)}
          maxLength={60}
        />
        <Field
          label="Judul besar"
          value={form.hero.title}
          onChange={(v) => update(["hero", "title"], v)}
          textarea
          maxLength={120}
        />
        <Field
          label="Sub-judul / deskripsi singkat"
          value={form.hero.subtitle}
          onChange={(v) => update(["hero", "subtitle"], v)}
          textarea
          maxLength={300}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Teks tombol 1"
            value={form.hero.cta1}
            onChange={(v) => update(["hero", "cta1"], v)}
            maxLength={30}
          />
          <Field
            label="Teks tombol 2"
            value={form.hero.cta2}
            onChange={(v) => update(["hero", "cta2"], v)}
            maxLength={30}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Section "Produk Kami"</h2>
        <Field
          label="Judul section"
          value={form.produk.title}
          onChange={(v) => update(["produk", "title"], v)}
          maxLength={60}
        />
        <Field
          label="Sub-teks"
          value={form.produk.subtitle}
          onChange={(v) => update(["produk", "subtitle"], v)}
          maxLength={150}
        />
      </div>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Section "Tentang GABAR"</h2>
        <Field
          label="Judul section"
          value={form.about.title}
          onChange={(v) => update(["about", "title"], v)}
          maxLength={60}
        />
        <Field
          label="Deskripsi"
          value={form.about.desc}
          onChange={(v) => update(["about", "desc"], v)}
          textarea
          maxLength={400}
        />

        <div className="space-y-3 pt-2">
          {form.about.features.map((f, i) => (
            <div key={i} className="rounded-xl bg-white/5 border border-white/15 p-3 space-y-2">
              <p className="text-xs font-semibold text-white/60">Kartu fitur {i + 1}</p>
              <Field
                label="Judul kartu"
                value={f.title}
                onChange={(v) => update(["about", "features", i, "title"], v)}
                maxLength={40}
              />
              <Field
                label="Deskripsi kartu"
                value={f.desc}
                onChange={(v) => update(["about", "features", i, "desc"], v)}
                textarea
                maxLength={200}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Footer</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Nama brand"
            value={form.footer.brand}
            onChange={(v) => update(["footer", "brand"], v)}
            maxLength={30}
          />
          <Field
            label="Nomor telepon (Hubungi Kami)"
            value={form.footer.phone}
            onChange={(v) => update(["footer", "phone"], v)}
            maxLength={20}
          />
        </div>
        <p className="text-xs text-white/60 -mt-1">
          Tampil di footer sebagai link telepon (bisa diketuk langsung di HP). Kosongkan untuk
          menyembunyikan bagian "Hubungi Kami".
        </p>
        <Field
          label="Tagline singkat"
          value={form.footer.tagline}
          onChange={(v) => update(["footer", "tagline"], v)}
          textarea
          maxLength={200}
        />
        <div className="space-y-2 pt-1">
          <p className="text-xs font-medium text-white/80">Langkah "Cara Pesan" (3 baris)</p>
          {form.footer.cara.map((line, i) => (
            <Field
              key={i}
              label={`Baris ${i + 1}`}
              value={line}
              onChange={(v) => update(["footer", "cara", i], v)}
              maxLength={100}
            />
          ))}
        </div>
      </div>

      {uploadStatus && <p className="text-sm text-white/80">{uploadStatus}</p>}
      {error && <p className="text-sm text-red-200">{error}</p>}
      {success && !error && (
        <p className="text-sm text-emerald-200">Konten halaman tersimpan.</p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving || !isDirty}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg bg-white/5 border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          Kembalikan ke teks default
        </button>
      </div>
    </form>
  );
}
