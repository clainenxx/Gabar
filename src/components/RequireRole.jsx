import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

// Bungkus route /admin dengan komponen ini. GAGI cuma punya 1 role (`admin`,
// ARCHITECTURE.md §0.2) — beda dari AyamKu yang punya admin+kasir dengan
// hak akses berbeda, jadi tidak perlu logic "switch akun" antar role di
// sini, cukup: belum login -> redirect ke /admin/login.
export default function RequireRole({ children }) {
  const { isLoggedIn, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        Memuat...
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/admin/login" replace />;
  }

  // Sudah login tapi profil di tabel `profiles` belum ada/role bukan admin
  // (mis. akun auth dibuat tapi lupa langkah bootstrap SQL) — jangan
  // diloloskan diam-diam, kasih pesan jelas kenapa akses ditolak.
  if (profile?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center text-white">
        <p>
          Akun ini sudah login tapi belum terdaftar sebagai admin (cek tabel{" "}
          <code>profiles</code>). Hubungi admin lain atau ikuti langkah
          bootstrap di <code>supabase/migrations/0001_profiles_and_auth.sql</code>.
        </p>
      </div>
    );
  }

  return children;
}
