import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { usePublicCart } from "../hooks/usePublicCart.js";
import { submitCheckout } from "../features/orders/checkoutApi.js";
import SnowEffect from "../components/public/SnowEffect.jsx";
import LokasiPengantaranInput from "../components/public/LokasiPengantaranInput.jsx";
import PaymentMethodInput from "../components/public/PaymentMethodInput.jsx";
import TurnstileWidget from "../components/public/TurnstileWidget.jsx";
import {
  isSafeNama,
  isSafeLokasi,
  NAMA_ERROR_MESSAGE,
  LOKASI_ERROR_MESSAGE,
} from "../lib/textRules.js";
import { useProcessingOverlay } from "../components/ProcessingOverlayProvider.jsx";

// Halaman /checkout (Modul 7 Tahap 2 — Frontend, ARCHITECTURE.md §2/§6).
// Tahap 1 (backend: Edge Function public-checkout/get-order/midtrans-webhook
// parsial) sudah ditulis sebelumnya — halaman ini menyambungkannya ke UI.
//
// Alur (PRD.md §4.1, ARCHITECTURE.md §4.1):
// 1. Customer isi form (nama, telp, email, Lokasi 1 wajib, Lokasi 2
//    opsional) — cart diambil dari usePublicCart (localStorage, sama
//    hook yang dipakai Home.jsx, BUKAN dioper lewat router state, supaya
//    tetap konsisten kalau customer reload/buka tab baru).
// 2. Submit -> panggil Edge Function public-checkout. Harga/stok/total
//    dihitung ulang server-side, TIDAK pernah dipercaya dari state cart
//    di sini (AGENTS.md §4) — state cart cuma dipakai untuk TAMPILAN
//    ringkasan & mengirim { product_id, qty } mentah.
// 3. Response berisi order_token + snap_token (+ adjusted_notes kalau ada
//    item yang jumlahnya disesuaikan/dilewati, PRD.md §4.1 "diubah owner
//    2026-09-08"). Notes ditampilkan jelas ke customer, TIDAK disembunyikan.
// 4. Buka Midtrans Snap popup (window.snap.pay). Sukses/pending -> bersihkan
//    cart, redirect ke /order/:order_token (QR + status, auto-update lewat
//    Realtime di halaman itu sendiri — status "paid" sungguhan baru
//    dikonfirmasi lewat webhook, bukan dari callback client ini).
//
// Fitur Pembayaran Cash (ditambahkan 2026-09-08, migration 0008,
// dikonfirmasi owner via chat langsung — lihat PRD.md §4.1 & AGENTS.md §2
// untuk update dokumentasi resminya): customer sekarang bisa pilih
// "Bayar Online" (alur di atas, TIDAK BERUBAH) atau "Bayar Cash" lewat
// <PaymentMethodInput>. Kalau pilih cash, `public-checkout` LANGSUNG
// membuat order berstatus `paid` (tanpa Midtrans sama sekali) dan TIDAK
// mengembalikan `snap_token` — jadi popup Snap dilewati total, customer
// langsung diarahkan ke `/order/:order_token` seperti kalau pembayaran
// online sukses.
const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// Anti-bot (2026-09-19): checkout wajib lolos Cloudflare Turnstile. Site key
// boleh publik (beda dengan secret key yang cuma ada di Edge Function).
// Kalau env ini kosong, tombol bayar dikunci dan customer diberi pesan.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

const MAX_NAMA_LENGTH = 100;
const PHONE_REGEX = /^[0-9+\-\s]{8,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Checkout() {
  const { items, subtotal, clearCart } = usePublicCart();
  const navigate = useNavigate();
  const { showProcessing, hideProcessing } = useProcessingOverlay();

  const [namaCustomer, setNamaCustomer] = useState("");
  const [noTelp, setNoTelp] = useState("");
  const [email, setEmail] = useState("");
  const [lokasi1, setLokasi1] = useState("");
  const [lokasi2, setLokasi2] = useState("");
  // Fitur Pembayaran Cash (migration 0008, dikonfirmasi owner 2026-09-08) —
  // default "online" supaya perilaku lama tidak berubah kalau customer
  // tidak menyentuh pilihan ini sama sekali.
  const [paymentMethod, setPaymentMethod] = useState("online");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [adjustedNotes, setAdjustedNotes] = useState([]);
  const [pendingPayment, setPendingPayment] = useState(null); // { orderToken, snapToken }
  // Token Turnstile SEKALI PAKAI — direset (token null + widget minta yang
  // baru) setelah tiap submit, sukses maupun gagal.
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [turnstileLoadError, setTurnstileLoadError] = useState(false);

  const itemCount = useMemo(() => items.reduce((sum, it) => sum + it.qty, 0), [items]);

  function validate() {
    const errors = {};
    const nama = namaCustomer.trim();
    if (!nama || nama.length > MAX_NAMA_LENGTH) {
      errors.namaCustomer = "Nama wajib diisi (maks 100 karakter).";
    } else if (!isSafeNama(nama)) {
      errors.namaCustomer = NAMA_ERROR_MESSAGE;
    }
    if (!PHONE_REGEX.test(noTelp.trim())) {
      errors.noTelp = "Nomor telepon tidak valid.";
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = "Format email tidak valid.";
    }
    if (!lokasi1.trim()) {
      errors.lokasi1 = "Lokasi 1 wajib diisi.";
    } else if (!isSafeLokasi(lokasi1.trim())) {
      errors.lokasi1 = LOKASI_ERROR_MESSAGE;
    }
    // Lokasi 2 opsional — cuma dicek formatnya kalau diisi.
    if (lokasi2.trim() && !isSafeLokasi(lokasi2.trim())) {
      errors.lokasi2 = LOKASI_ERROR_MESSAGE;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function openSnap(snapToken, orderToken) {
    if (typeof window === "undefined" || !window.snap) {
      setFormError(
        "Layanan pembayaran belum siap dimuat — refresh halaman lalu coba lagi.",
      );
      setSubmitting(false);
      return;
    }
    window.snap.pay(snapToken, {
      onSuccess: () => {
        clearCart();
        navigate(`/order/${orderToken}`);
      },
      onPending: () => {
        // Metode seperti transfer bank/e-wallet: pembayaran belum tuntas,
        // tapi order sudah tercatat — tetap arahkan ke halaman QR supaya
        // customer bisa lihat instruksi/status & pantau sampai lunas.
        clearCart();
        navigate(`/order/${orderToken}`);
      },
      onError: () => {
        setFormError("Pembayaran gagal diproses. Silakan coba lagi.");
        setSubmitting(false);
      },
      onClose: () => {
        // Customer menutup popup tanpa menyelesaikan pembayaran — order
        // & Snap token sudah ada (biarkan tersimpan di state), tampilkan
        // tombol untuk lanjut bayar lagi daripada memaksa isi form ulang.
        setSubmitting(false);
      },
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (items.length === 0) return;
    if (!validate()) return;
    if (!turnstileToken) {
      setFormError("Selesaikan verifikasi keamanan dulu, lalu coba lagi.");
      return;
    }

    setSubmitting(true);
    showProcessing(
      paymentMethod === "cash" ? "Mencatat pesananmu..." : "Memproses pesananmu...",
    );
    try {
      const result = await submitCheckout({
        namaCustomer: namaCustomer.trim(),
        noTelp: noTelp.trim(),
        email: email.trim(),
        lokasi1: lokasi1.trim(),
        lokasi2: lokasi2.trim(),
        items,
        paymentMethod,
        turnstileToken,
      });
      setAdjustedNotes(result.adjusted_notes || []);
      hideProcessing();

      // Fitur Pembayaran Cash (migration 0008): order cash TIDAK PERNAH
      // dapat `snap_token` dari public-checkout (dilewati sengaja di sana)
      // — order-nya sudah langsung `paid`, jadi tidak ada popup Midtrans
      // yang perlu dibuka sama sekali. Langsung bersihkan cart & arahkan ke
      // halaman QR, persis seperti kalau Snap online sukses/pending.
      if (paymentMethod === "cash" || !result.snap_token) {
        clearCart();
        navigate(`/order/${result.order_token}`);
        return;
      }

      setPendingPayment({ orderToken: result.order_token, snapToken: result.snap_token });
      openSnap(result.snap_token, result.order_token);
    } catch (err) {
      hideProcessing();
      setFormError(err.message || "Gagal memproses checkout, coba lagi.");
      setSubmitting(false);
    } finally {
      // Token sudah terpakai (server memverifikasinya) — minta yang baru.
      setTurnstileToken(null);
      setTurnstileResetSignal((n) => n + 1);
    }
  }

  if (items.length === 0) {
    return (
      <div className="relative min-h-screen text-white">
        <SnowEffect />
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <p className="text-lg font-semibold">Keranjang masih kosong.</p>
          <p className="mt-1 text-sm text-white/70">
            Yuk pilih menu dulu sebelum checkout.
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

  return (
    <div className="relative min-h-screen text-white">
      <SnowEffect />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <Link to="/" className="text-xs text-white/70 hover:text-white">
          ← Kembali ke Beranda
        </Link>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">Checkout</h1>
        <p className="mt-1 text-sm text-white/70">
          Lengkapi data di bawah, lalu bayar untuk menyelesaikan pesananmu.
        </p>

        {/* Ringkasan Pesanan */}
        <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white/90">
            Ringkasan Pesanan ({itemCount} item)
          </h2>
          <div className="mt-3 space-y-2">
            {items.map((it) => (
              <div key={it.productId} className="flex items-center justify-between text-sm">
                <span className="text-white/85">
                  {it.nama} <span className="text-white/60">× {it.qty}</span>
                </span>
                <span className="font-medium">{currencyFormatter.format(it.harga * it.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-base font-semibold">
            <span>Total</span>
            <span>{currencyFormatter.format(subtotal)}</span>
          </div>
          <p className="mt-2 text-[11px] text-white/60">
            Harga final dihitung ulang saat checkout — kalau ada item yang stoknya berubah,
            jumlahnya otomatis disesuaikan dan akan diberi tahu di sini.
          </p>
        </div>

        {/* Pesan penyesuaian item (kalau ada) — PRD.md §4.1 */}
        {adjustedNotes.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-500/15 p-4 text-sm">
            <p className="font-medium text-amber-100">Ada penyesuaian pada pesananmu:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-amber-50/90">
              {adjustedNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Kalau order sudah dibuat tapi popup Snap sempat ditutup — beri
            jalan untuk lanjut bayar lagi tanpa isi ulang form. */}
        {pendingPayment ? (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-5 text-center">
            <p className="text-sm text-white/85">
              Pesananmu sudah dibuat. Kalau jendela pembayaran tertutup sebelum selesai, lanjutkan
              di sini.
            </p>
            <button
              type="button"
              onClick={() => {
                setSubmitting(true);
                openSnap(pendingPayment.snapToken, pendingPayment.orderToken);
              }}
              disabled={submitting}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[var(--gagi-dark)] hover:bg-white/90 disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {submitting ? "Membuka pembayaran..." : "Lanjutkan ke Pembayaran"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="namaCustomer">
                Nama
              </label>
              <input
                id="namaCustomer"
                type="text"
                required
                maxLength={MAX_NAMA_LENGTH}
                value={namaCustomer}
                onChange={(e) => setNamaCustomer(e.target.value)}
                placeholder="Nama kamu"
                className={`w-full rounded-xl border bg-white/90 px-3 py-2 text-[var(--gagi-dark)] outline-none focus:ring-2 focus:ring-white ${
                  fieldErrors.namaCustomer ? "border-red-300" : "border-white/30"
                }`}
              />
              {fieldErrors.namaCustomer && (
                <p className="mt-1 text-xs text-red-200">{fieldErrors.namaCustomer}</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="noTelp">
                No. Telepon
              </label>
              <input
                id="noTelp"
                type="tel"
                required
                value={noTelp}
                onChange={(e) => setNoTelp(e.target.value)}
                placeholder="08123456789"
                className={`w-full rounded-xl border bg-white/90 px-3 py-2 text-[var(--gagi-dark)] outline-none focus:ring-2 focus:ring-white ${
                  fieldErrors.noTelp ? "border-red-300" : "border-white/30"
                }`}
              />
              {fieldErrors.noTelp && (
                <p className="mt-1 text-xs text-red-200">{fieldErrors.noTelp}</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kamu@email.com"
                className={`w-full rounded-xl border bg-white/90 px-3 py-2 text-[var(--gagi-dark)] outline-none focus:ring-2 focus:ring-white ${
                  fieldErrors.email ? "border-red-300" : "border-white/30"
                }`}
              />
              {fieldErrors.email && <p className="mt-1 text-xs text-red-200">{fieldErrors.email}</p>}
              <p className="mt-1 text-xs text-white/60">
                Link ke halaman QR pesananmu akan dikirim ke email ini.
              </p>
            </div>

            <LokasiPengantaranInput
              lokasi1={lokasi1}
              lokasi2={lokasi2}
              onChangeLokasi1={setLokasi1}
              onChangeLokasi2={setLokasi2}
              errorLokasi1={fieldErrors.lokasi1}
              errorLokasi2={fieldErrors.lokasi2}
            />

            <PaymentMethodInput value={paymentMethod} onChange={setPaymentMethod} />

            {/* Verifikasi anti-bot (Cloudflare Turnstile) */}
            {TURNSTILE_SITE_KEY ? (
              <div>
                <TurnstileWidget
                  siteKey={TURNSTILE_SITE_KEY}
                  onToken={setTurnstileToken}
                  onLoadError={() => setTurnstileLoadError(true)}
                  resetSignal={turnstileResetSignal}
                />
                {turnstileLoadError ? (
                  <p className="mt-1 text-xs text-red-200">
                    Verifikasi keamanan gagal dimuat — cek koneksi internetmu lalu refresh halaman.
                  </p>
                ) : (
                  !turnstileToken && (
                    <p className="mt-1 text-xs text-white/60">
                      Menunggu verifikasi keamanan… tombol akan aktif setelah selesai.
                    </p>
                  )
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-2 text-sm">
                Verifikasi keamanan belum tersedia saat ini, jadi checkout sementara belum bisa
                dipakai. Silakan hubungi admin.
              </p>
            )}

            {formError && (
              <p className="rounded-lg border border-red-300/40 bg-red-500/20 px-3 py-2 text-sm">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !turnstileToken}
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[var(--gagi-dark)] hover:bg-white/90 disabled:opacity-60"
            >
              {submitting
                ? "Memproses..."
                : paymentMethod === "cash"
                  ? `Pesan Sekarang (Bayar Cash) — ${currencyFormatter.format(subtotal)}`
                  : `Bayar Sekarang — ${currencyFormatter.format(subtotal)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
