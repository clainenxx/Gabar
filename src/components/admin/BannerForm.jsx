import { useState } from "react";
import { createBanner, updateBanner } from "../../features/banners/bannersApi.js";
import { uploadImage } from "../../features/products/imageUploadApi.js";
import ImageDropInput from "./ImageDropInput.jsx";

const EMPTY_FORM = {
  judul: "",
  link: "",
  aktif: true,
};

// Form tambah/edit banner (Modul 4 — ARCHITECTURE.md §6). Gambar wajib diisi
// (kolom `gambar_url` NOT NULL, migrations/0002_schema_and_rls.sql) — beda
// dari produk yang gambarnya opsional. `urutan` tidak diinput manual di
// sini: banner baru otomatis taruh di urutan paling akhir (dihitung di
// BannersTab.jsx), pengaturan urutan lebih lanjut pakai tombol naik/turun
// di tabel supaya lebih jelas daripada admin mengetik angka urutan sendiri.
export default function BannerForm({ nextUrutan, editingBanner, onSaved, onCancel }) {
  const isEditing = Boolean(editingBanner);
  const [form, setForm] = useState(() =>
    isEditing
      ? {
          judul: editingBanner.judul ?? "",
          link: editingBanner.link ?? "",
          aktif: editingBanner.aktif,
        }
      : { ...EMPTY_FORM },
  );
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(editingBanner?.gambar_url ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [error, setError] = useState(null);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    let gambar_url = editingBanner?.gambar_url ?? null;
    if (!imageFile && !gambar_url) {
      return setError("Gambar banner wajib diisi");
    }
    if (form.link.trim() && !/^https?:\/\//i.test(form.link.trim())) {
      return setError("Link harus diawali http:// atau https://");
    }

    setSubmitting(true);
    try {
      if (imageFile) {
        gambar_url = await uploadImage(imageFile, "banners", (status) =>
          setUploadStatus(
            status === "compressing" ? "Mengompres gambar..." : "Mengupload gambar...",
          ),
        );
      }

      const payload = {
        judul: form.judul,
        link: form.link,
        aktif: form.aktif,
        gambar_url,
      };

      setUploadStatus(null);
      if (isEditing) {
        await updateBanner(editingBanner.id, payload);
      } else {
        await createBanner({ ...payload, urutan: nextUrutan });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Gagal menyimpan banner");
    } finally {
      setSubmitting(false);
      setUploadStatus(null);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3"
    >
      <h2 className="text-lg font-semibold">{isEditing ? "Edit Banner" : "Tambah Banner"}</h2>

      <ImageDropInput
        label="Gambar banner"
        hint="Disarankan gambar landscape (lebar) supaya pas di header."
        imagePreview={imagePreview}
        onFileChange={handleImageChange}
        previewClassName="h-24 w-full max-w-sm"
      />

      <div>
        <label className="block text-sm mb-1">Judul (opsional)</label>
        <input
          type="text"
          value={form.judul}
          onChange={(e) => updateField("judul", e.target.value)}
          placeholder="mis. Promo Akhir Semester"
          className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
        />
      </div>

      <div>
        <label className="block text-sm mb-1">Link tujuan (opsional)</label>
        <input
          type="text"
          value={form.link}
          onChange={(e) => updateField("link", e.target.value)}
          placeholder="https://contoh.com/promo"
          className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
        />
        <p className="mt-1 text-xs text-white/70">
          Kalau diisi, banner ini bisa diklik dan membuka link ini di tab baru.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.aktif}
          onChange={(e) => updateField("aktif", e.target.checked)}
        />
        Aktif (tampil di carousel halaman publik)
      </label>

      {uploadStatus && <p className="text-sm text-white/80">{uploadStatus}</p>}
      {error && <p className="text-sm text-red-200">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Menyimpan..." : isEditing ? "Simpan Perubahan" : "Tambah Banner"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg bg-white/10 border border-white/20 px-4 py-2 text-sm hover:bg-white/20"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
