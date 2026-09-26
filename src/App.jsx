import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Checkout from "./pages/Checkout.jsx";
import OrderQr from "./pages/OrderQr.jsx";
import AdminLogin from "./pages/AdminLogin.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import SetupCheck from "./pages/SetupCheck.jsx";
import NotFound from "./pages/NotFound.jsx";
import RequireRole from "./components/RequireRole.jsx";

// Rute mengikuti ARCHITECTURE.md §2. Home ("/") aktif sejak Modul 5
// (Website Publik & Cart Online). Checkout & OrderQr masih placeholder —
// diisi di Modul 7. AdminLogin & AdminPage sudah aktif mulai Modul 1 (Auth
// Admin); tab-tab isi panel admin menyusul per modulnya masing-masing.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/order/:orderToken" element={<OrderQr />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <RequireRole>
            <AdminPage />
          </RequireRole>
        }
      />
      {/* Halaman internal, bukan bagian PRD — cek koneksi service Modul 0.
          Security hardening (2026-09-19): route ini HANYA terdaftar saat
          development (`npm run dev`). Di build production (Netlify) tidak
          ada, supaya halaman diagnostik tidak terbuka untuk publik —
          request ke /setup-check di production jatuh ke halaman NotFound. */}
      {import.meta.env.DEV && <Route path="/setup-check" element={<SetupCheck />} />}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
