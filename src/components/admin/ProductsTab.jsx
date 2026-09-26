import { useCallback, useEffect, useState } from "react";
import { listCategories } from "../../features/products/categoriesApi.js";
import {
  listProductsAdmin,
  deleteProduct,
  updateProductStock,
} from "../../features/products/productsApi.js";
import { subscribeProductStock } from "../../lib/realtime.js";
import { useConfirmDialog } from "../ConfirmDialogProvider.jsx";
import CategoryManager from "./CategoryManager.jsx";
import ProductForm from "./ProductForm.jsx";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// Tab "Produk" di /admin (Modul 3 — ARCHITECTURE.md §2/§6): CRUD produk +
// kelola kategori + stok, upload gambar via presigned URL R2.
export default function ProductsTab() {
  const { confirmDialog } = useConfirmDialog();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [cats, prods] = await Promise.all([listCategories(), listProductsAdmin()]);
      setCategories(cats);
      setProducts(prods);
    } catch (err) {
      setError(err.message || "Gagal memuat data produk");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Modul 6 — Realtime Stok Produk: dengar perubahan `stock` dari sumber
  // manapun (tombol +/- di tab admin lain, atau nanti checkout Modul 7)
  // supaya angka di tabel ini tidak basi kalau ada admin lain yang login
  // bersamaan. Cukup patch baris yang berubah, tidak query ulang semuanya.
  useEffect(() => {
    const unsubscribe = subscribeProductStock((payload) => {
      const updated = payload.new;
      setProducts((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...p, stock: updated.stock, aktif: updated.aktif } : p)),
      );
    });
    return unsubscribe;
  }, []);

  async function adjustStock(product, delta) {
    const newStock = product.stock + delta;
    if (newStock < 0) return;
    setError(null);
    // Optimistic: tabel sudah dipatch juga oleh event Realtime di atas,
    // tapi update langsung di sini membuat tombol terasa instan tanpa
    // menunggu roundtrip Realtime (yang biasanya <1 detik, tapi tetap ada
    // jeda jaringan).
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, stock: newStock } : p)));
    try {
      await updateProductStock(product.id, newStock);
    } catch (err) {
      setError(err.message || "Gagal mengubah stok");
      // Rollback kalau RPC gagal (mis. race condition ganjil).
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, stock: product.stock } : p)));
    }
  }

  function openAddForm() {
    setEditingProduct(null);
    setShowForm(true);
  }

  function openEditForm(product) {
    setEditingProduct(product);
    setShowForm(true);
  }

  async function handleSaved() {
    setShowForm(false);
    setEditingProduct(null);
    await loadAll();
  }

  async function handleDelete(product) {
    const ok = await confirmDialog(`Hapus produk "${product.nama}"?`, {
      title: "Hapus Produk",
      tone: "danger",
      confirmLabel: "Ya, Hapus",
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteProduct(product.id);
      await loadAll();
    } catch (err) {
      setError(err.message || "Gagal menghapus produk");
    }
  }

  if (loading) {
    return <p className="text-white/80">Memuat data produk...</p>;
  }

  return (
    <div className="space-y-4">
      <CategoryManager categories={categories} onChanged={loadAll} />

      {error && (
        <p className="rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {showForm ? (
        <ProductForm
          categories={categories}
          editingProduct={editingProduct}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={openAddForm}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30"
        >
          + Tambah Produk
        </button>
      )}

      <div className="rounded-2xl bg-white/10 border border-white/20 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-white/10 text-left">
            <tr>
              <th className="px-3 py-2">Gambar</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2">Harga</th>
              <th className="px-3 py-2">Stok</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-white/70">
                  Belum ada produk — klik "+ Tambah Produk" untuk mulai.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="px-3 py-2">
                  {p.gambar_url ? (
                    <img
                      src={p.gambar_url}
                      alt={p.nama}
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="text-white/50">-</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{p.nama}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.categories?.nama ?? "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{currencyFormatter.format(p.harga)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustStock(p, -1)}
                      disabled={p.stock <= 0}
                      className="rounded-lg bg-white/10 border border-white/20 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-40"
                      aria-label={`Kurangi stok ${p.nama}`}
                    >
                      −
                    </button>
                    <span className="w-8 text-center">{p.stock}</span>
                    <button
                      type="button"
                      onClick={() => adjustStock(p, 1)}
                      className="rounded-lg bg-white/10 border border-white/20 px-2 py-0.5 text-xs hover:bg-white/20"
                      aria-label={`Tambah stok ${p.nama}`}
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.aktif ? (
                    <span className="text-emerald-200">Aktif</span>
                  ) : (
                    <span className="text-white/50">Nonaktif</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(p)}
                      className="rounded-lg bg-white/10 border border-white/20 px-2 py-1 text-xs hover:bg-white/20"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="rounded-lg bg-red-500/20 border border-red-300/30 px-2 py-1 text-xs hover:bg-red-500/30"
                    >
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-white/50 sm:hidden">
        Geser tabel ke kanan untuk lihat Stok, Status, dan Aksi →
      </p>
    </div>
  );
}
