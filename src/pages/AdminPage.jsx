import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { logout } from "../features/auth/authApi.js";
import AdminNavbar from "../components/admin/AdminNavbar.jsx";
import ProductsTab from "../components/admin/ProductsTab.jsx";
import BannersTab from "../components/admin/BannersTab.jsx";
import AdminAccountsTab from "../components/admin/AdminAccountsTab.jsx";
import ScanQrTab from "../components/admin/ScanQrTab.jsx";
import DashboardTab from "../components/admin/DashboardTab.jsx";
import PesananTab from "../components/admin/PesananTab.jsx";
import PengaturanTab from "../components/admin/PengaturanTab.jsx";
import BroadcastWaTab from "../components/admin/BroadcastWaTab.jsx";
import KontenHalamanTab from "../components/admin/KontenHalamanTab.jsx";
import { getSiteContent } from "../features/settings/siteContentApi.js";

// Sidebar tab sesuai ARCHITECTURE.md §2. Tiap tab dikerjakan bertahap sesuai
// modulnya masing-masing (WORKFLOW.md §4) — "Produk" aktif sejak Modul 3,
// "Banner" aktif sejak Modul 4, "Akun Admin" aktif sejak Modul 1b, "Scan QR
// Verifikasi" aktif sejak Modul 10, "Dashboard" & "Pesanan" aktif sejak
// Modul 11, "Pengaturan" aktif sejak Modul 12, sisanya masih placeholder.
// `mobileLabel` dipakai khusus di baris pill navbar mobile (AdminNavbar) —
// beberapa label kepanjangan untuk pill kalau dipakai apa adanya (mis.
// "Scan QR Verifikasi", "Broadcast WA Belum Scan"), jadi dipendekkan di
// sana saja. Sidebar >=md & judul tab tetap pakai `label` penuh.
const TABS = [
  { key: "dashboard", label: "Dashboard", modul: "Modul 11" },
  { key: "produk", label: "Produk", modul: "Modul 3" },
  { key: "banner", label: "Banner", modul: "Modul 4" },
  { key: "konten", label: "Konten Halaman", mobileLabel: "Konten", modul: "Pasca-Modul 5/12" },
  { key: "pesanan", label: "Pesanan", modul: "Modul 11" },
  { key: "scan-qr", label: "Scan QR Verifikasi", mobileLabel: "Scan QR", modul: "Modul 10" },
  {
    key: "broadcast-wa",
    label: "Broadcast WA Belum Scan",
    mobileLabel: "Broadcast WA",
    modul: "Fitur Baru",
  },
  { key: "pengaturan", label: "Pengaturan", modul: "Modul 12" },
  { key: "akun-admin", label: "Akun Admin", mobileLabel: "Akun", modul: "Modul 1b" },
];

// Layout /admin (Modul 13 — diminta owner: navbar floating konsisten
// dengan public page + glassmorphism yang lebih profesional + responsive).
// Struktur: AdminNavbar floating di atas (sama pola dengan Navbar.jsx
// publik, termasuk tombol hamburger-nya), lalu panel tab (sidebar
// vertikal, cuma di >=md — di layar sempit daftar tab pindah ke dropdown
// hamburger navbar supaya tidak ada dua daftar menu yang sama) dan
// panel konten — keduanya kaca
// (backdrop-blur + border tipis + shadow) supaya kartu-kartu di dalam
// tiap tab (yang sudah pakai bg-white/10) tetap kelihatan menonjol di
// atasnya, bukan tumpuk buram ganda.
export default function AdminPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("produk");
  // Logo brand untuk navbar admin — diambil dari site_content yang sama
  // dengan halaman publik; diperbarui langsung saat tab "Konten Halaman"
  // menyimpan (onSaved), tanpa perlu reload.
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSiteContent()
      .then((c) => {
        if (!cancelled) setLogoUrl(c.logo?.url || "");
      })
      .catch(() => {
        // Gagal ambil logo tidak boleh mengganggu panel admin — cukup
        // tampilkan kotak huruf "G" bawaan.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/admin/login");
  }

  const activeMeta = TABS.find((t) => t.key === activeTab);

  return (
    <div className="min-h-screen text-white">
      <AdminNavbar
        profile={profile}
        onLogout={handleLogout}
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        logoUrl={logoUrl}
      />

      {/* Jarak atas menyesuaikan tinggi navbar floating, sama pola dengan
          Home.jsx supaya konten tidak ketutupan. */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-24 sm:pt-28 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          <nav
            className="hidden md:flex md:flex-col gap-2 overflow-x-auto rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-lg shadow-black/10 p-2 md:p-3 md:h-fit md:sticky md:top-28"
          >
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap text-left rounded-xl px-3 py-2.5 text-sm font-medium border transition-all duration-200 shrink-0 ${
                  activeTab === tab.key
                    ? "bg-white text-[#0b2447] border-white shadow-md shadow-black/10"
                    : "bg-white/5 border-white/15 text-white/85 hover:bg-white/15 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/10 p-4 sm:p-6 min-w-0">
            {/* Di layar sempit sidebar disembunyikan, jadi judul tab aktif
                ditampilkan di sini supaya user tetap tahu sedang di mana. */}
            <h1 className="md:hidden mb-3 text-lg font-semibold">
              {activeMeta?.label}
            </h1>
            {activeTab === "dashboard" ? (
              <DashboardTab />
            ) : activeTab === "produk" ? (
              <ProductsTab />
            ) : activeTab === "banner" ? (
              <BannersTab />
            ) : activeTab === "konten" ? (
              <KontenHalamanTab onSaved={(c) => setLogoUrl(c.logo?.url || "")} />
            ) : activeTab === "pesanan" ? (
              <PesananTab />
            ) : activeTab === "akun-admin" ? (
              <AdminAccountsTab currentAdminId={profile?.id} />
            ) : activeTab === "scan-qr" ? (
              <ScanQrTab />
            ) : activeTab === "broadcast-wa" ? (
              <BroadcastWaTab />
            ) : activeTab === "pengaturan" ? (
              <PengaturanTab />
            ) : (
              <div className="rounded-2xl bg-white/10 border border-white/20 p-6">
                <p>
                  Tab "{activeMeta?.label}" belum dikerjakan — direncanakan di{" "}
                  <strong>{activeMeta?.modul}</strong> (lihat{" "}
                  <code>documentations/TODO.md</code>).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
