import { useState } from "react";
import { createProduct, updateProduct } from "../../features/products/productsApi.js";
import { uploadImage } from "../../features/products/imageUploadApi.js";
import ImageDropInput from "./ImageDropInput.jsx";

const EMPTY_FORM = {
  nama: "",
  deskripsi: "",
  harga: "",
  category_id: "",
  stock: "0",
  aktif: true,
};

// Form tambah/edit produk (Modul 3). Tidak ada field varian/flavors
// (ARCHITECTURE.md §0.9) — rasa/topping berbeda didaftarkan sebagai produk
// terpisah, cukup dibedakan lewat kategori/nama.
export default function ProductForm({ categories, editingProduct, onSaved, onCancel }) {
  const isEditing = Boolean(editingProduct);
  const [form, setForm] = useState(() =>
    isEditing
      ? {
          nama: editingProduct.nama,
          deskripsi: editingProduct.deskripsi ?? "",
          harga: String(editingProduct.harga),
          category_id: editingProduct.category_id,
          stock: String(editingProduct.stock),
          aktif: editingProduct.aktif,
        }
      : { ...EMPTY_FORM, category_id: categories[0]?.id ?? "" },
  );
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(editingProduct?.gambar_url ?? null);
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

    const harga = Number(form.harga);
    const stock = Number(form.stock);
    if (!form.nama.trim()) return setError("Nama produk wajib diisi");
    if (!form.category_id) return setError("Pilih kategori terlebih dahulu");
    if (!Number.isFinite(harga) || harga < 0) return setError("Harga harus angka >= 0");
    if (!Number.isInteger(stock) || stock < 0) return setError("Stok harus bilangan bulat >= 0");

    setSubmitting(true);
    try {
      let gambar_url = editingProduct?.gambar_url ?? null;
      if (imageFile) {
        gambar_url = await uploadImage(imageFile, "products", (status) =>
          setUploadStatus(
            status === "compressing" ? "Mengompres gambar..." : "Mengupload gambar...",
          ),
        );
      }

      const payload = {
        nama: form.nama,
        deskripsi: form.deskripsi,
        harga,
        category_id: form.category_id,
        stock,
        aktif: form.aktif,
        gambar_url,
      };

      setUploadStatus(null);
      if (isEditing) {
        await updateProduct(editingProduct.id, payload);
      } else {
        await createProduct(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Gagal menyimpan produk");
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
      <h2 className="text-lg font-semibold">{isEditing ? "Edit Produk" : "Tambah Produk"}</h2>

      <div>
        <label className="block text-sm mb-1">Nama produk</label>
        <input
          type="text"
          value={form.nama}
          onChange={(e) => updateField("nama", e.target.value)}
          placeholder="mis. Gabin Coklat"
          className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
        />
      </div>

      <div>
        <label className="block text-sm mb-1">Deskripsi (opsional)</label>
        <textarea
          value={form.deskripsi}
          onChange={(e) => updateField("deskripsi", e.target.value)}
          rows={2}
          className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">Harga (Rp)</label>
          <input
            type="number"
            min="0"
            value={form.harga}
            onChange={(e) => updateField("harga", e.target.value)}
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Stok</label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.stock}
            onChange={(e) => updateField("stock", e.target.value)}
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm mb-1">Kategori</label>
        <select
          value={form.category_id}
          onChange={(e) => updateField("category_id", e.target.value)}
          className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm [&>option]:text-black"
        >
          <option value="" disabled>
            Pilih kategori
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nama}
            </option>
          ))}
        </select>
        {categories.length === 0 && (
          <p className="mt-1 text-xs text-white/70">
            Belum ada kategori — tambah dulu di panel Kategori di atas.
          </p>
        )}
      </div>

      <ImageDropInput
        label="Gambar produk"
        imagePreview={imagePreview}
        onFileChange={handleImageChange}
        previewClassName="h-24 w-24"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.aktif}
          onChange={(e) => updateField("aktif", e.target.checked)}
        />
        Aktif (tampil di halaman publik)
      </label>

      {uploadStatus && <p className="text-sm text-white/80">{uploadStatus}</p>}
      {error && <p className="text-sm text-red-200">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Menyimpan..." : isEditing ? "Simpan Perubahan" : "Tambah Produk"}
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
