import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import QRCode from "qrcode";
import { getOrder, resumePayment } from "../features/orders/checkoutApi.js";
import { subscribeOrderStatus } from "../lib/realtime.js";
import SnowEffect from "../components/public/SnowEffect.jsx";
import LoadingScreen from "../components/LoadingScreen.jsx";
import { useProcessingOverlay } from "../components/ProcessingOverlayProvider.jsx";

// Halaman /order/:order_token (Modul 7 Tahap 2 — ARCHITECTURE.md §2/§4.1).
// Dipakai sebagai: (1) tujuan redirect setelah bayar sukses/pending di
// Checkout.jsx, (2) link permanen yang dikirim lewat email (Modul 9), (3)
// bukti yang ditunjukkan customer ke admin saat serah terima — admin scan QR
// ini lewat tab "Scan QR Verifikasi" (Modul 10).
//
// QR berisi URL halaman ini sendiri (`/order/:order_token`, bukan cuma
// token mentah) sesuai ARCHITECTURE.md §0.6 — supaya kalau di-scan dengan
// kamera HP biasa (bukan cuma scanner admin), tetap membuka halaman ini.
//
// Status "paid" sungguhan HANYA dikonfirmasi lewat Midtrans webhook
// (server-side) — bukan dari callback Snap di Checkout.jsx. Begitu webhook
// memproses & mengubah `orders.status`, halaman ini otomatis ikut update
// TANPA RELOAD lewat Realtime Postgres Changes (subscribeOrderStatus).
//
// Modul 7b (2026-09-08) — 2 perubahan UX:
// 1. QR code HANYA ditampilkan waktu `status === "paid"`. Waktu `pending`,
//    tidak ada gunanya (dan berpotensi disalahgunakan seolah-olah sudah sah)
//    menampilkan QR untuk order yang belum tentu jadi dibayar — diganti
//    tombol "Lanjutkan Pembayaran" yang membuka ulang Snap popup Midtrans
//    untuk transaksi YANG SAMA (lewat Edge Function `resume-payment`, lihat
//    komentar lengkap di file itu soal idempotency Midtrans).
// 2. Waktu admin scan QR & status berubah `paid` -> `completed` (Modul 10),
//    QR ikut hilang OTOMATIS tanpa reload (konsekuensi alami dari render
//    kondisional di bawah + Realtime yang sudah ada sejak awal) dan
//    diganti pesan sukses jelas.
//
// Modul 7c (2026-09-08) — auto-update TANPA RELOAD dibenarkan beneran:
// sebelumnya `subscribeOrderStatus` subscribe ke tabel `orders` langsung,
// yang TIDAK PERNAH mengirim event apapun (belum terdaftar di publication
// `supabase_realtime` + `orders` sengaja tidak punya RLS select untuk anon
// karena berisi PII). Sekarang dengar dari tabel bayangan tanpa-PII
// `order_status_public` yang disinkron trigger tiap `orders.status`
// berubah — lihat 0006_order_status_public_realtime.sql. Transisi antar
// status juga dikasih animasi halus (`animate-detail-open`, sudah dipakai
// di PesananTab.jsx) via `key={order.status}` supaya perubahannya terasa
// jelas, bukan cuma "tiba-tiba beda" — sekaligus visual QR/kartu dirapikan
// jadi terasa seperti struk profesional (Modul 7c juga memoles UI, bukan
// cuma fix realtime).
const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_INFO = {
  pending: {
    label: "Menunggu Pembayaran",
    badge: "border-amber-300/40 bg-amber-500/20 text-amber-100",
    message:
      "Pembayaran belum kami terima. Selesaikan dalam 15 menit sejak pesanan dibuat, sebelum otomatis kedaluwarsa & stoknya dilepas kembali. Kalau kamu baru saja bayar, tunggu sebentar — halaman ini akan otomatis update tanpa perlu refresh. Belum sempat bayar? Lanjutkan lewat tombol di bawah.",
  },
  paid: {
    label: "Sudah Dibayar",
    badge: "border-emerald-300/40 bg-emerald-500/20 text-emerald-100",
    message:
      "Pembayaran berhasil! Tunjukkan QR code di bawah ini ke admin saat pesananmu diantar ke lokasimu.",
  },
  completed: {
    label: "Sudah Diambil",
    badge: "border-sky-300/40 bg-sky-500/20 text-sky-100",
    message:
      "QR berhasil dipindai! Pesanan ini sudah diverifikasi diterima. Terima kasih sudah berbelanja di GABAR!",
  },
  cancelled: {
    label: "Dibatalkan",
    badge: "border-red-300/40 bg-red-500/20 text-red-100",
    message:
      "Pesanan ini dibatalkan (pembayaran tidak selesai/kedaluwarsa). Kalau ini tidak sesuai, hubungi admin.",
  },
};

// Fitur Pembayaran Cash (ditambahkan 2026-09-08, migration 0008): order cash
// LANGSUNG berstatus `paid` sejak dibuat (tidak pernah lewat `pending`,
// lihat public-checkout/index.ts) supaya tetap kompatibel dengan RPC
// `verify_order_pickup` & filter laporan penjualan yang sudah ada — TAPI
// teksnya SENGAJA beda dari order online: bukan "Sudah Dibayar" (uangnya
// belum diterima admin sungguhan) dan bukan "Menunggu Pembayaran" (order
// sudah sah, tidak ada tagihan online yang perlu diselesaikan) — melainkan
// "Menunggu Di-scan", sesuai permintaan owner. Ini murni override tampilan,
// tidak menambah nilai status baru di DB (lihat migration 0008).
const CASH_PAID_STATUS_INFO = {
  label: "Menunggu Di-scan",
  badge: "border-sky-300/40 bg-sky-500/20 text-sky-100",
  message:
    "Pesanan cash-mu sudah tercatat dan stok sudah kami siapkan. Siapkan uang pas sesuai total — admin akan mengantar pesananmu, tunjukkan QR di bawah ini untuk di-scan sebagai bukti serah terima sekaligus saat kamu membayar tunai.",
};

// Pilih teks status yang tepat berdasarkan `status` + `payment_method` —
// satu-satunya kombinasi yang beda dari peta di atas adalah `paid` + `cash`
// (lihat komentar `CASH_PAID_STATUS_INFO`); kombinasi lain (termasuk order
// online) tetap memakai `STATUS_INFO` seperti sebelumnya, TIDAK berubah.
function getStatusInfo(status, paymentMethod) {
  if (status === "paid" && paymentMethod === "cash") return CASH_PAID_STATUS_INFO;
  return STATUS_INFO[status] ?? STATUS_INFO.pending;
}

export default function OrderQr() {
  const { orderToken } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const { showProcessing, hideProcessing } = useProcessingOverlay();

  // 1. Ambil data order sekali di awal.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getOrder(orderToken)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Pesanan tidak ditemukan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderToken]);

  // 2. Subscribe Realtime begitu tahu `order.id` — auto-update status (mis.
  // pending -> paid begitu webhook Midtrans selesai memproses, atau paid ->
  // completed begitu admin scan QR serah terima di Modul 10) tanpa perlu
  // reload halaman (ARCHITECTURE.md §4.1). Payload dari tabel bayangan
  // `order_status_public` (Modul 7c) cuma berisi
  // {order_id, order_token, status, updated_at} — jadi HANYA field
  // `status` yang diambil & ditimpa ke state, bukan seluruh payload,
  // supaya tidak tertimpa field lain yang memang tidak ada di sana.
  useEffect(() => {
    if (!order?.id) return undefined;
    const unsubscribe = subscribeOrderStatus(order.id, (payload) => {
      const nextStatus = payload.new?.status;
      if (!nextStatus) return;
      setOrder((prev) => (prev ? { ...prev, status: nextStatus } : prev));
    });
    return unsubscribe;
  }, [order?.id]);

  // 3. Generate QR code (client-side, library `qrcode` — ARCHITECTURE.md
  // §1) HANYA waktu order sudah `paid` — sebelum itu tidak ada gunanya QR
  // dibuat sama sekali (§Modul 7b di atas).
  useEffect(() => {
    if (!orderToken || order?.status !== "paid") {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    const url = `${window.location.origin}/order/${orderToken}`;
    QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: "#0b2447", light: "#ffffff" } })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [orderToken, order?.status]);

  const expiresAt = useMemo(() => {
    if (!order?.created_at) return null;
    const created = new Date(order.created_at);
    return new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000); // 1x seminggu, §0.10
  }, [order?.created_at]);

  // Kode pesanan pendek buat ditampilkan (bukan UUID penuh yang panjang &
  // tidak enak dibaca) — 8 karakter pertama order_token, huruf besar,
  // gaya "nomor struk". Hanya kosmetik, bukan pengganti order_token asli
  // (link/QR tetap pakai token penuh).
  const shortCode = order?.order_token
    ? order.order_token.slice(0, 8).toUpperCase()
    : null;

  // Tombol "Lanjutkan Pembayaran" — minta Snap token baru untuk transaksi
  // pending yang sama (Edge Function `resume-payment`) lalu buka popup Snap
  // persis seperti alur checkout awal (Checkout.jsx `openSnap`). Status
  // `paid` sungguhan tetap hanya dikonfirmasi lewat webhook + Realtime di
  // atas — callback Snap di sini cuma untuk UX (tutup popup, tampilkan
  // pesan), TIDAK mengubah `order.status` secara langsung.
  async function handleResumePayment() {
    setResumeError("");
    setResuming(true);
    showProcessing("Membuka pembayaran...");
    try {
      const result = await resumePayment(orderToken);
      hideProcessing();
      if (typeof window === "undefined" || !window.snap) {
        setResumeError("Layanan pembayaran belum siap dimuat — refresh halaman lalu coba lagi.");
        setResuming(false);
        return;
      }
      window.snap.pay(result.snap_token, {
        onSuccess: () => setResuming(false),
        onPending: () => setResuming(false),
        onError: () => {
          setResumeError("Pembayaran gagal diproses. Silakan coba lagi.");
          setResuming(false);
        },
        onClose: () => setResuming(false),
      });
    } catch (err) {
      hideProcessing();
      setResumeError(err.message || "Gagal melanjutkan pembayaran, coba lagi.");
      setResuming(false);
    }
  }

  if (loading) {
    return (
      <div className="relative min-h-screen text-white">
        <SnowEffect />
        <LoadingScreen message="Memuat data pesanan..." />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="relative min-h-screen text-white">
        <SnowEffect />
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <p className="text-lg font-semibold">Pesanan tidak ditemukan.</p>
          <p className="mt-1 text-sm text-white/70">{error}</p>
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

  const statusInfo = getStatusInfo(order.status, order.payment_method);
  // "Live" cuma indikator kosmetik kalau halaman ini sedang mendengarkan
  // Realtime buat status ini (pending menunggu jadi paid, paid menunggu
  // di-scan admin) — sengaja tidak ditampilkan waktu completed/cancelled
  // karena sudah final, tidak ada lagi yang ditunggu.
  const isLive = order.status === "pending" || order.status === "paid";

  return (
    <div className="relative min-h-screen text-white">
      <SnowEffect />
      <div className="relative z-10 mx-auto max-w-md px-4 py-10 sm:py-14">
        <Link to="/" className="text-xs text-white/70 hover:text-white">
          ← Kembali ke Beranda
        </Link>

        {/* `key={order.status}` sengaja dipasang supaya React remount blok
            ini tiap status berubah -> animasi `animate-detail-open`
            (dipakai juga di PesananTab.jsx) ikut terpicu ulang. Jadi waktu
            Realtime mengubah status (mis. pending -> paid begitu webhook
            Midtrans selesai, atau paid -> completed begitu admin scan QR),
            perubahannya terasa lewat fade+slide halus, bukan cuma
            "tiba-tiba beda" tanpa transisi. */}
        <div key={order.status} className="animate-detail-open">
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-xl shadow-black/10">
            <div className="p-5 text-center sm:p-6">
              <div className="flex items-center justify-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusInfo.badge}`}
                >
                  {statusInfo.label}
                </span>
                {isLive && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-white/50"
                    title="Halaman ini update otomatis, tidak perlu refresh"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    </span>
                    Live
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm leading-relaxed text-white/85">{statusInfo.message}</p>

              {order.status === "paid" && (
                <div className="mt-5 flex justify-center">
                  {qrDataUrl ? (
                    <div className="rounded-2xl bg-white p-3 shadow-lg shadow-black/20">
                      <img
                        src={qrDataUrl}
                        alt={`QR code pesanan ${order.order_token}`}
                        className="h-52 w-52 rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="flex h-56 w-56 items-center justify-center rounded-2xl bg-white/10 text-xs text-white/60">
                      Membuat QR code...
                    </div>
                  )}
                </div>
              )}

              {order.status === "completed" && (
                <div className="mt-5 flex justify-center">
                  <div className="flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-2xl border border-sky-300/30 bg-gradient-to-b from-sky-400/15 to-sky-500/5 text-center">
                    <span
                      className="animate-pop flex h-16 w-16 items-center justify-center rounded-full bg-sky-400/90 text-3xl text-white shadow-lg shadow-sky-900/20"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className="px-6 text-sm font-medium text-sky-100">
                      QR berhasil di-scan
                    </span>
                  </div>
                </div>
              )}

              {order.status === "pending" && (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={handleResumePayment}
                    disabled={resuming}
                    className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[var(--gagi-dark)] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resuming ? "Membuka pembayaran..." : "Lanjutkan Pembayaran"}
                  </button>
                  {resumeError && <p className="mt-2 text-xs text-red-200">{resumeError}</p>}
                </div>
              )}

              {order.status === "paid" && expiresAt && (
                <p className="mt-4 text-[11px] text-white/60">
                  QR berlaku sampai {dateFormatter.format(expiresAt)}.
                </p>
              )}
            </div>

            {shortCode && (
              <div className="border-t border-dashed border-white/20 px-5 py-2.5 text-[11px] text-white/50">
                No. Pesanan <span className="font-mono text-white/70">#{shortCode}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <span aria-hidden="true">🧾</span> Detail Pesanan
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Nama</dt>
              <dd className="text-right">{order.nama_customer}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Lokasi 1</dt>
              <dd className="text-right">{order.lokasi_1}</dd>
            </div>
            {order.lokasi_2 && (
              <div className="flex justify-between gap-4">
                <dt className="text-white/60">Lokasi 2</dt>
                <dd className="text-right">{order.lokasi_2}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Waktu Pesan</dt>
              <dd className="text-right">{dateFormatter.format(new Date(order.created_at))}</dd>
            </div>
          </dl>

          <div className="mt-4 divide-y divide-white/10 border-t border-white/15">
            {(order.order_items ?? []).map((it, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-white/85">
                  {it.nama_produk} <span className="text-white/60">× {it.qty}</span>
                </span>
                <span className="font-medium">{currencyFormatter.format(it.subtotal)}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-white/15 pt-3 text-base font-semibold">
            <span>Total</span>
            <span>{currencyFormatter.format(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
