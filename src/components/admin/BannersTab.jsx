import { useCallback, useEffect, useState } from "react";
import {
  listBannersAdmin,
  deleteBanner,
  swapBannerUrutan,
} from "../../features/banners/bannersApi.js";
import BannerForm from "./BannerForm.jsx";
import { useConfirmDialog } from "../ConfirmDialogProvider.jsx";

// Tab "Banner" di /admin (Modul 4 — ARCHITECTURE.md §2/§6): CRUD banner
// header, urutan tampil, reuse upload gambar R2 dari Modul 3.
export default function BannersTab() {
  const { confirmDialog } = useConfirmDialog();
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const data = await listBannersAdmin();
      setBanners(data);
    } catch (err) {
      setError(err.message || "Gagal memuat data banner");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function openAddForm() {
    setEditingBanner(null);
    setShowForm(true);
  }

  function openEditForm(banner) {
    setEditingBanner(banner);
    setShowForm(true);
  }

  async function handleSaved() {
    setShowForm(false);
    setEditingBanner(null);
    await loadAll();
  }

  async function handleDelete(banner) {
    const ok = await confirmDialog(
      `Hapus banner "${banner.judul || "(tanpa judul)"}"?`,
      { title: "Hapus Banner", tone: "danger", confirmLabel: "Ya, Hapus" },
    );
    if (!ok) return;
    setError(null);
    try {
      await deleteBanner(banner.id);
      await loadAll();
    } catch (err) {
      setError(err.message || "Gagal menghapus banner");
    }
  }

  async function handleMove(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= banners.length) return;
    setError(null);
    try {
      await swapBannerUrutan(banners[index], banners[targetIndex]);
      await loadAll();
    } catch (err) {
      setError(err.message || "Gagal mengubah urutan banner");
    }
  }

  const nextUrutan = banners.length > 0 ? Math.max(...banners.map((b) => b.urutan)) + 1 : 1;

  if (loading) {
    return <p className="text-white/80">Memuat data banner...</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {showForm ? (
        <BannerForm
          nextUrutan={nextUrutan}
          editingBanner={editingBanner}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={openAddForm}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30"
        >
          + Tambah Banner
        </button>
      )}

      <div className="rounded-2xl bg-white/10 border border-white/20 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-white/10 text-left">
            <tr>
              <th className="px-3 py-2">Urutan</th>
              <th className="px-3 py-2">Gambar</th>
              <th className="px-3 py-2">Judul</th>
              <th className="px-3 py-2">Link</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {banners.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-white/70">
                  Belum ada banner — klik "+ Tambah Banner" untuk mulai.
                </td>
              </tr>
            )}
            {banners.map((b, index) => (
              <tr key={b.id} className="border-t border-white/10">
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      title="Naikkan urutan"
                      className="rounded-md bg-white/10 border border-white/20 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === banners.length - 1}
                      title="Turunkan urutan"
                      className="rounded-md bg-white/10 border border-white/20 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <img
                    src={b.gambar_url}
                    alt={b.judul || "Banner"}
                    className="h-10 w-20 rounded-lg object-cover"
                  />
                </td>
                <td className="px-3 py-2">{b.judul || <span className="text-white/50">-</span>}</td>
                <td className="px-3 py-2">
                  {b.link ? (
                    <a
                      href={b.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-200 underline break-all"
                    >
                      {b.link}
                    </a>
                  ) : (
                    <span className="text-white/50">-</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {b.aktif ? (
                    <span className="text-emerald-200">Aktif</span>
                  ) : (
                    <span className="text-white/50">Nonaktif</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(b)}
                      className="rounded-lg bg-white/10 border border-white/20 px-2 py-1 text-xs hover:bg-white/20"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(b)}
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
    </div>
  );
}
