import { useCallback, useEffect, useState } from "react";
import { listAdmins, createAdmin, deleteAdmin } from "../../features/auth/manageAdminApi.js";
import { useConfirmDialog } from "../ConfirmDialogProvider.jsx";

const EMPTY_FORM = { full_name: "", email: "", password: "" };

// Tab "Akun Admin" (Modul 1b — ARCHITECTURE.md §0.2/§6). Semua akun admin
// hak aksesnya identik, tidak ada tingkatan/role kedua seperti kasir di
// AyamKu — jadi tab ini cuma daftar + tambah + hapus, tanpa pengaturan
// permission per akun.
export default function AdminAccountsTab({ currentAdminId }) {
  const { confirmDialog } = useConfirmDialog();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadAdmins = useCallback(async () => {
    setError(null);
    try {
      setAdmins(await listAdmins());
    } catch (err) {
      setError(err.message || "Gagal memuat daftar admin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);

    if (!form.full_name.trim()) return setError("Nama lengkap wajib diisi");
    if (!form.email.trim()) return setError("Email wajib diisi");
    if (form.password.length < 8) return setError("Password minimal 8 karakter");

    setSubmitting(true);
    try {
      await createAdmin({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setForm(EMPTY_FORM);
      await loadAdmins();
    } catch (err) {
      setError(err.message || "Gagal menambah admin");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(admin) {
    const ok = await confirmDialog(
      `Hapus akun admin "${admin.full_name}" (${admin.email})?`,
      { title: "Hapus Akun Admin", tone: "danger", confirmLabel: "Ya, Hapus" },
    );
    if (!ok) return;
    setError(null);
    setDeletingId(admin.id);
    try {
      await deleteAdmin(admin.id);
      await loadAdmins();
    } catch (err) {
      setError(err.message || "Gagal menghapus admin");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <p className="text-white/80">Memuat daftar admin...</p>;
  }

  return (
    <div className="space-y-4">
      {/* overflow-x-auto + min-w di tabel: di layar sempit tabel dilebarkan
          supaya kolom "Aksi" tidak terpotong, dan panel bisa digeser
          horizontal (sama pola dengan tabel Produk/Banner/Pesanan). */}
      <div className="rounded-2xl bg-white/10 border border-white/20 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-white/10 text-left whitespace-nowrap">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Bergabung</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => {
              const isSelf = a.id === currentAdminId;
              return (
                <tr key={a.id} className="border-t border-white/10">
                  <td className="px-3 py-2">
                    {a.full_name}
                    {isSelf && <span className="ml-2 text-xs text-white/60">(kamu)</span>}
                  </td>
                  <td className="px-3 py-2">{a.email}</td>
                  <td className="px-3 py-2">
                    {new Date(a.created_at).toLocaleDateString("id-ID")}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      disabled={isSelf || deletingId === a.id}
                      title={isSelf ? "Tidak bisa menghapus akun sendiri yang sedang login" : undefined}
                      className="rounded-lg bg-red-500/20 border border-red-300/30 px-2 py-1 text-xs hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {deletingId === a.id ? "Menghapus..." : "Hapus"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={handleCreate}
        className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3"
      >
        <h2 className="text-lg font-semibold">Tambah Akun Admin</h2>
        <p className="text-sm text-white/70">
          Akun baru langsung bisa login ke <code>/admin</code> dengan hak akses yang sama persis
          (tidak ada tingkatan admin).
        </p>

        <div>
          <label className="block text-sm mb-1">Nama lengkap</label>
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => updateField("full_name", e.target.value)}
            placeholder="mis. Budi Santoso"
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            placeholder="admin-baru@gabar.com"
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Password awal</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => updateField("password", e.target.value)}
            placeholder="Minimal 8 karakter"
            className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
          />
        </div>

        {error && <p className="text-sm text-red-200">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Menambahkan..." : "Tambah Admin"}
        </button>
      </form>
    </div>
  );
}
