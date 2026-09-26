import { useState } from "react";
import { createCategory, deleteCategory } from "../../features/products/categoriesApi.js";

// Kelola kategori produk — bagian dari tab "Produk" (Modul 3,
// ARCHITECTURE.md §2: "CRUD produk + kelola kategori + stok").
// Kategori tidak hardcode (PRD.md §4.3) — admin bebas tambah/hapus sendiri.
export default function CategoryManager({ categories, onChanged }) {
  const [nama, setNama] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = nama.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    try {
      const urutan = categories.length > 0 ? Math.max(...categories.map((c) => c.urutan)) + 1 : 1;
      await createCategory({ nama: trimmed, urutan });
      setNama("");
      await onChanged();
    } catch (err) {
      // unique constraint pada kolom `nama` (migrations/0002_schema_and_rls.sql)
      setError(
        err.code === "23505" ? "Nama kategori sudah ada" : err.message || "Gagal menambah kategori",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await deleteCategory(id);
      await onChanged();
    } catch (err) {
      setError(err.message || "Gagal menghapus kategori");
    }
  }

  return (
    <div className="rounded-2xl bg-white/10 border border-white/20 p-4">
      <h2 className="text-lg font-semibold mb-3">Kategori</h2>

      <ul className="flex flex-wrap gap-2 mb-3">
        {categories.length === 0 && (
          <li className="text-sm text-white/70">Belum ada kategori.</li>
        )}
        {categories.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-sm"
          >
            <span>{c.nama}</span>
            <button
              type="button"
              onClick={() => handleDelete(c.id)}
              title="Hapus kategori"
              className="text-white/60 hover:text-white"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Nama kategori baru, mis. Topping Matcha"
          className="flex-1 rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
        />
        <button
          type="submit"
          disabled={submitting || !nama.trim()}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50"
        >
          Tambah
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
    </div>
  );
}
