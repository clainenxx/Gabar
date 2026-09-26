import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Popup overlay "Memproses..." — diminta owner langsung ("pas klik pesan
// kan memproses tuh, tambahin juga popup memproses nya"). Beda dari
// `ConfirmDialogProvider` (butuh keputusan Ya/Batal dari user): overlay ini
// PURE INFORMASIONAL, tidak ada tombol/keputusan, cuma kasih tahu "tunggu
// sebentar, ada proses jalan di belakang layar" — makanya SENGAJA tidak
// bisa ditutup klik backdrop/Escape (beda dari ConfirmDialogProvider),
// karena menutup paksa di tengah proses async (mis. lagi kirim checkout ke
// server) bisa bikin user kira sudah selesai padahal belum.
//
// Dipasang sekali di root (`main.jsx`, sejajar `ConfirmDialogProvider`),
// dipakai lewat hook `useProcessingOverlay()` -> `showProcessing(pesan)` /
// `hideProcessing()`. State `count` (bukan boolean) sengaja dipakai supaya
// aman kalau ada 2 pemanggilan `showProcessing` bertumpuk tanpa sengaja
// (mis. race kecil) — overlay baru hilang kalau SEMUA pemanggil sudah
// `hideProcessing()`, bukan hilang prematur begitu salah satu selesai.
const ProcessingOverlayContext = createContext(null);

export function ProcessingOverlayProvider({ children }) {
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("Memproses...");

  const showProcessing = useCallback((msg) => {
    if (msg) setMessage(msg);
    setCount((c) => c + 1);
  }, []);

  const hideProcessing = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);

  const value = useMemo(() => ({ showProcessing, hideProcessing }), [showProcessing, hideProcessing]);
  const visible = count > 0;

  return (
    <ProcessingOverlayContext.Provider value={value}>
      {children}
      {visible && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/20 bg-[#0b2447]/95 px-8 py-7 text-white shadow-2xl shadow-black/30">
            <Spinner />
            <p className="text-sm font-medium text-white/90">{message}</p>
          </div>
        </div>
      )}
    </ProcessingOverlayContext.Provider>
  );
}

export function useProcessingOverlay() {
  const ctx = useContext(ProcessingOverlayContext);
  if (!ctx) {
    throw new Error("useProcessingOverlay harus dipakai di dalam <ProcessingOverlayProvider>");
  }
  return ctx;
}

// Spinner kecil bertema keping salju berputar — dipakai di sini DAN di
// `LoadingScreen.jsx` (loading full-page) supaya visualnya konsisten di
// seluruh app, bukan 2 macam spinner beda gaya.
export function Spinner({ size = 40 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="animate-spin text-white"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
