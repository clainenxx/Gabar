import { useEffect, useRef } from "react";

// Widget Cloudflare Turnstile (anti-bot) untuk form checkout — ditambahkan
// 2026-09-19. Skrip Cloudflare dimuat sekali saja, lazy, hanya saat halaman
// yang memakai widget ini dibuka (bukan di index.html, supaya halaman lain
// tidak ikut memuat skrip pihak ketiga).
//
// Token Turnstile SEKALI PAKAI: setelah tiap submit (sukses maupun gagal)
// parent harus menaikkan `resetSignal` supaya widget minta token baru —
// kalau tidak, submit berikutnya pasti ditolak server.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise = null;
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => {
        scriptPromise = null; // izinkan coba lagi kalau gagal dimuat
        reject(new Error("Gagal memuat verifikasi keamanan"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// Tampilan (semua opsional; default = persis tampilan checkout sebelumnya):
// - theme: "auto" | "light" | "dark".
// - size: "flexible" (lebar penuh kontainer, min 300px) | "normal" (300x65) |
//   "compact" (150x140).
// - appearance: "always" (selalu tampil) | "interaction-only" (widget baru
//   muncul kalau Cloudflare butuh user mengklik kotak; kalau tidak, tidak ada
//   yang terlihat). Hanya berlaku untuk widget mode Managed/Non-Interactive
//   yang dibuat di dashboard Cloudflare.
// Isi di dalam kotak widget (iframe Cloudflare) tidak bisa di-style lewat CSS
// halaman ini — yang bisa diatur cuma opsi di atas dan pembungkus luarnya.
export default function TurnstileWidget({
  siteKey,
  onToken,
  onLoadError,
  resetSignal = 0,
  theme = "auto",
  size = "flexible",
  appearance = "always",
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  // Simpan callback di ref supaya efek render di bawah TIDAK jalan ulang
  // (dan membuat widget baru) tiap parent re-render.
  const onTokenRef = useRef(onToken);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onTokenRef.current = onToken;
    onLoadErrorRef.current = onLoadError;
  });

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size,
          appearance,
          callback: (token) => onTokenRef.current?.(token),
          "expired-callback": () => onTokenRef.current?.(null),
          "error-callback": () => onTokenRef.current?.(null),
        });
      })
      .catch((err) => {
        if (!cancelled) onLoadErrorRef.current?.(err);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, theme, size, appearance]);

  // Minta token baru tiap `resetSignal` naik (setelah submit).
  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  return <div ref={containerRef} />;
}
