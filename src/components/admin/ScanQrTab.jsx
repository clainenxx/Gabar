import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { verifyOrderPickup } from "../../features/orders/pickupApi.js";

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// QR code isi URL penuh `https://domain.com/order/{order_token}` (bukan
// token mentah, ARCHITECTURE.md §0.6/§5.5) — supaya kamera HP biasa pun bisa
// buka halaman kalau di-scan orang lain. Di sini kita cuma butuh UUID-nya,
// jadi cukup cari pola UUID di teks hasil scan, tidak perlu parse URL penuh
// (juga otomatis mendukung kalau admin paste/ketik token mentah di fallback
// manual, tanpa perlu logic terpisah).
function extractOrderToken(rawText) {
  const match = rawText.match(UUID_REGEX);
  return match ? match[0] : null;
}

// Map SQLSTATE custom dari RPC `verify_order_pickup` (lihat komentar di
// `supabase/migrations/0004_verify_order_pickup.sql`) ke jenis tampilan
// pesan — supaya "sudah pernah diambil" (warning, bukan salah pelanggan)
// tampil beda dari "kedaluwarsa"/"belum dibayar" (error, ada masalah nyata).
function classifyError(err) {
  if (err?.code === "P0002") return "warning";
  return "error";
}

// Tab "Scan QR Verifikasi" di /admin (Modul 10 — ARCHITECTURE.md §2/§6).
// Kamera device via library `qr-scanner` + fallback input manual (kalau
// device tidak punya kamera, izin ditolak, atau QR rusak/tidak terbaca).
// Verifikasi & update status HANYA lewat RPC `verify_order_pickup` — lihat
// `pickupApi.js`.
export default function ScanQrTab() {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const handleDecodedRef = useRef(() => {});

  const [hasCamera, setHasCamera] = useState(true);
  const [cameraError, setCameraError] = useState(null);
  const [manualToken, setManualToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);
  const [result, setResult] = useState(null); // { kind: 'success'|'warning'|'error', message, order? }

  const runVerify = useCallback(async (token) => {
    // Guard lewat ref (bukan cuma state) supaya callback kamera yang masih
    // sempat terpanggil di antara render tidak memicu verifikasi dobel
    // untuk QR yang sama saat request sebelumnya belum selesai.
    if (verifyingRef.current) return;
    if (!token) {
      setResult({
        kind: "error",
        message: "QR/kode tidak dikenali — pastikan ini QR pesanan GABAR yang valid.",
      });
      return;
    }

    verifyingRef.current = true;
    setVerifying(true);
    setResult(null);
    scannerRef.current?.stop();

    try {
      const order = await verifyOrderPickup(token);
      setResult({
        kind: "success",
        message: "Verifikasi berhasil — pesanan ditandai sudah diambil.",
        order,
      });
    } catch (err) {
      setResult({
        kind: classifyError(err),
        message: err.message || "Gagal memverifikasi pesanan.",
      });
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }, []);

  const handleDecoded = useCallback(
    (rawText) => {
      runVerify(extractOrderToken(rawText));
    },
    [runVerify],
  );

  // Selalu simpan versi terbaru `handleDecoded` di ref — `QrScanner`
  // diinisialisasi sekali saja di effect mount (di bawah), jadi callback
  // yang dipegangnya harus dibaca lewat ref supaya tidak pakai closure basi.
  useEffect(() => {
    handleDecodedRef.current = handleDecoded;
  }, [handleDecoded]);

  useEffect(() => {
    let cancelled = false;

    QrScanner.hasCamera()
      .then((available) => {
        if (cancelled) return;
        setHasCamera(available);
        if (!available || !videoRef.current) return;

        const scanner = new QrScanner(
          videoRef.current,
          (scanResult) => handleDecodedRef.current(scanResult.data),
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: "environment",
          },
        );
        scannerRef.current = scanner;
        scanner.start().catch((err) => {
          console.error("[ScanQrTab] gagal mengakses kamera:", err);
          if (!cancelled) {
            setHasCamera(false);
            setCameraError(
              "Gagal mengakses kamera (izin ditolak / tidak tersedia) — gunakan input manual di bawah.",
            );
          }
        });
      })
      .catch((err) => {
        console.error("[ScanQrTab] gagal cek ketersediaan kamera:", err);
        if (!cancelled) setHasCamera(false);
      });

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  function resumeScanning() {
    setResult(null);
    scannerRef.current?.start().catch((err) => {
      console.error("[ScanQrTab] gagal melanjutkan scan:", err);
    });
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    const trimmed = manualToken.trim();
    if (!trimmed) return;
    runVerify(extractOrderToken(trimmed) || trimmed);
  }

  const resultStyles = {
    success: "bg-emerald-500/20 border-emerald-300/40 text-emerald-100",
    warning: "bg-amber-500/20 border-amber-300/40 text-amber-100",
    error: "bg-red-500/20 border-red-300/40 text-red-100",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-medium">Scan QR Verifikasi Serah Terima</h2>
        <p className="text-sm text-white/70">
          Arahkan kamera ke QR pesanan pelanggan saat serah terima di lokasi. QR pesanan berlaku
          1×seminggu sejak dipesan.
        </p>

        {hasCamera ? (
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black/40">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          </div>
        ) : (
          <p className="rounded-lg bg-white/5 border border-white/15 px-3 py-2 text-sm text-white/70">
            {cameraError || "Kamera tidak tersedia di device ini — gunakan input manual di bawah."}
          </p>
        )}

        {verifying && <p className="text-sm text-white/70">Memverifikasi pesanan...</p>}

        {result && (
          <div className={`rounded-lg border px-3 py-3 text-sm space-y-2 ${resultStyles[result.kind]}`}>
            <p>{result.message}</p>
            {result.order && (
              <div className="text-xs opacity-90 space-y-0.5">
                <p>
                  <strong>{result.order.nama_customer}</strong> — {currencyFormatter.format(result.order.total)}
                </p>
                <p>Lokasi 1: {result.order.lokasi_1}</p>
                {result.order.lokasi_2 && <p>Lokasi 2: {result.order.lokasi_2}</p>}
              </div>
            )}
            <button
              type="button"
              onClick={resumeScanning}
              className="rounded-lg bg-white/15 border border-white/30 px-3 py-1.5 text-xs hover:bg-white/25"
            >
              Scan Berikutnya
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={handleManualSubmit}
        className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-2"
      >
        <h3 className="text-sm font-medium">Input Manual (fallback)</h3>
        <p className="text-xs text-white/60">
          Kalau kamera tidak bisa membaca QR, tempel link pesanan (atau kode order-nya saja) di sini.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="https://.../order/xxxxxxxx-xxxx-... atau kode order"
            className="flex-1 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm placeholder:text-white/40"
          />
          <button
            type="submit"
            disabled={verifying || !manualToken.trim()}
            className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-40"
          >
            Verifikasi
          </button>
        </div>
      </form>
    </div>
  );
}
