import { Link } from "react-router-dom";
import SnowEffect from "../components/public/SnowEffect.jsx";

// Halaman 404 — diminta owner ("page not found juga tambahin"). Sebelumnya
// route "*" di App.jsx cuma render <div> polos tanpa tema/style sama
// sekali ("Halaman tidak ditemukan." + link kembali) — dipindah ke sini
// jadi halaman utuh, konsisten dengan tema salju GABAR yang dipakai
// halaman publik lain (Home, Checkout, OrderQr).
export default function NotFound() {
  return (
    <div className="relative min-h-screen text-white">
      <SnowEffect />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <span className="text-6xl" aria-hidden="true">
          ❄️
        </span>
        <p className="mt-4 text-5xl font-bold tracking-tight">404</p>
        <p className="mt-2 text-lg font-semibold">Halaman tidak ditemukan.</p>
        <p className="mt-1 max-w-sm text-sm text-white/70">
          Halaman yang kamu cari mungkin sudah pindah, salah alamat, atau memang belum pernah ada.
        </p>
        <Link
          to="/"
          className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-[var(--gagi-dark)] hover:bg-white/90"
        >
          ← Kembali ke Beranda
        </Link>
      </div>
    </div>
  );
}
