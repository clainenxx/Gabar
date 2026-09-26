import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// Pengganti window.confirm()/window.alert() bawaan browser (diminta owner:
// "warning" jangan pop-up jelek bawaan browser, ganti kotak di layar).
// Dipasang sekali di root (`main.jsx`) lewat `ConfirmDialogProvider`, lalu
// dipakai di mana saja lewat hook `useConfirmDialog()` — API-nya sengaja
// dibuat mirip `window.confirm`/`window.alert` (return Promise) supaya
// tempat pemanggilan lama (`if (!window.confirm(...)) return;`) cuma perlu
// diganti `if (!(await confirmDialog(...))) return;`, tanpa restrukturisasi
// besar.
//
// Kenapa 1 komponen untuk confirm & alert (bukan dua modal terpisah): kedua
// dialog secara visual identik (kotak kaca + pesan + tombol), bedanya cuma
// jumlah tombol (confirm = 2 tombol Ya/Batal, alert = 1 tombol OK) — jadi
// cukup 1 state `dialog` yang menyimpan `variant`.
const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { variant, title, message, tone, resolve }
  const resolverRef = useRef(null);

  const closeDialog = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const confirmDialog = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        variant: "confirm",
        title: options.title ?? "Konfirmasi",
        message,
        tone: options.tone ?? "default", // "default" | "danger" — danger = tombol merah, dipakai utk aksi hapus
        confirmLabel: options.confirmLabel ?? "Ya, Lanjutkan",
        cancelLabel: options.cancelLabel ?? "Batal",
      });
    });
  }, []);

  const alertDialog = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        variant: "alert",
        title: options.title ?? "Pemberitahuan",
        message,
        tone: options.tone ?? "default",
        confirmLabel: options.confirmLabel ?? "OK",
      });
    });
  }, []);

  const value = useMemo(() => ({ confirmDialog, alertDialog }), [confirmDialog, alertDialog]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {dialog && (
        <DialogModal
          dialog={dialog}
          onConfirm={() => closeDialog(true)}
          onCancel={() => closeDialog(false)}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error("useConfirmDialog harus dipakai di dalam <ConfirmDialogProvider>");
  }
  return ctx;
}

function DialogModal({ dialog, onConfirm, onCancel }) {
  const { variant, title, message, tone, confirmLabel, cancelLabel } = dialog;
  const isDanger = tone === "danger";

  function handleBackdropClick() {
    // Klik di luar kotak = sama seperti Batal (bukan konfirmasi) — supaya
    // tidak ada aksi merusak (hapus data) yang tidak sengaja ter-trigger.
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        role={variant === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-white/20 bg-[#0b2447]/95 backdrop-blur-xl shadow-2xl shadow-black/30 p-5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
              isDanger
                ? "bg-red-500/15 border-red-400/40 text-red-300"
                : "bg-white/10 border-white/25 text-white"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {isDanger ? (
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-5M12 8h.01" />
                </>
              )}
            </svg>
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id="confirm-dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-white/85 whitespace-pre-line break-words">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {variant === "confirm" && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-white/25 bg-white/5 px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/15 hover:text-white transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              isDanger
                ? "bg-red-500 text-white hover:bg-red-400"
                : "bg-white text-[#0b2447] hover:bg-white/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
