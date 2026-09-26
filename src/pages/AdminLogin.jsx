import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../features/auth/authApi.js";
import TurnstileWidget from "../components/public/TurnstileWidget.jsx";

// Site key boleh publik (secret-nya ada di dashboard Supabase Auth, bukan di
// sini). Sama dengan yang dipakai checkout (VITE_TURNSTILE_SITE_KEY).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Token Turnstile SEKALI PAKAI — direset setelah tiap percobaan gagal.
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [turnstileLoadError, setTurnstileLoadError] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!turnstileToken) {
      setError("Verifikasi keamanan belum selesai, tunggu sebentar lalu coba lagi.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(email, password, turnstileToken);
      navigate("/admin");
      // Sengaja TIDAK ada `finally { setLoading(false) }` di sini — kalau
      // dipasang, ada race antara setLoading setelah unmount (karena
      // navigate() sudah pindah halaman) yang bisa bikin React
      // "Cannot update state on unmounted component"/crash reconciler.
      // Pola sama dipakai di proyek asal AyamKu (src/pages/admin/AdminLogin.jsx).
    } catch (err) {
      // Pesan dari server (authApi.login): salah password, terlalu banyak
      // percobaan (rate limit), atau layanan bermasalah.
      setError(err?.message || "Email atau password salah.");
      setLoading(false);
      // Token sudah terpakai (server meneruskannya ke Supabase Auth) — minta
      // yang baru. Sengaja cuma di catch: kalau sukses halaman ini di-unmount
      // oleh navigate(), jangan set state lagi (alasan sama dengan catatan
      // soal setLoading di atas).
      setTurnstileToken(null);
      setTurnstileResetSignal((n) => n + 1);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 text-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl bg-white/10 backdrop-blur-sm border border-white/20 p-8"
      >
        <h1 className="text-2xl font-semibold text-center mb-1">GABAR Admin</h1>
        <p className="text-sm text-center text-white/80 mb-7">
          Login untuk kelola produk, banner, dan pesanan
        </p>

        <label className="block text-sm font-medium mb-1.5" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@gabar.com"
          className="w-full rounded-xl border border-white/30 bg-white/90 text-[var(--gagi-dark)] px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-white"
        />

        <label className="block text-sm font-medium mb-1.5" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full rounded-xl border border-white/30 bg-white/90 text-[var(--gagi-dark)] px-3 py-2 mb-5 outline-none focus:ring-2 focus:ring-white"
        />

        {/* Verifikasi anti-bot (Cloudflare Turnstile). appearance="interaction-only":
            widget cuma terlihat kalau Cloudflare butuh user mengklik kotak,
            selebihnya tidak ada yang tampil. Ganti ke "always" (atau hapus
            prop-nya) kalau ingin kotaknya selalu terlihat. */}
        {TURNSTILE_SITE_KEY ? (
          <div className="mb-4">
            <TurnstileWidget
              siteKey={TURNSTILE_SITE_KEY}
              theme="dark"
              appearance="interaction-only"
              onToken={setTurnstileToken}
              onLoadError={() => setTurnstileLoadError(true)}
              resetSignal={turnstileResetSignal}
            />
            {turnstileLoadError && (
              <p className="mt-1 text-xs text-red-200">
                Verifikasi keamanan gagal dimuat — cek koneksi internetmu lalu refresh halaman.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm mb-4 rounded-lg bg-amber-500/15 border border-amber-300/40 px-3 py-2">
            Verifikasi keamanan belum dikonfigurasi (VITE_TURNSTILE_SITE_KEY kosong), jadi login
            belum bisa dipakai.
          </p>
        )}

        {error && (
          <p className="text-sm mb-4 rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-xl bg-white text-[var(--gagi-dark)] font-medium py-2.5 disabled:opacity-60"
        >
          {loading ? "Memproses..." : !turnstileToken ? "Memverifikasi..." : "Masuk"}
        </button>

        <Link
          to="/"
          className="block text-center text-xs text-white/70 hover:text-white mt-6"
        >
          ← Kembali ke halaman utama
        </Link>
      </form>
    </div>
  );
}
