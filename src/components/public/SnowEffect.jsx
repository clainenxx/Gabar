import { useEffect, useMemo, useState } from "react";

// Efek salju ringan (ARCHITECTURE.md §0.11): partikel jatuh pelan pakai
// CSS animation (bukan canvas), jumlah dibatasi (`FLAKE_COUNT`), auto-pause
// saat tab tidak aktif via `document.visibilitychange`, dan otomatis tidak
// dirender kalau user minta `prefers-reduced-motion` — jadi tidak perlu
// duplikasi logic pause karena partikelnya memang tidak pernah dipasang ke
// DOM. Posisi & durasi tiap kepingan salju di-random SEKALI lewat
// `useMemo` supaya tidak re-render ulang tiap parent re-render.
const FLAKE_COUNT = 34;
const FLAKE_GLYPHS = ["❄", "❅", "❆", "•"];

function randomFlake(i) {
  const size = 8 + Math.random() * 14; // 8–22px
  return {
    id: i,
    glyph: FLAKE_GLYPHS[i % FLAKE_GLYPHS.length],
    left: Math.random() * 100, // vw %
    size,
    opacity: 0.35 + Math.random() * 0.5,
    duration: 9 + Math.random() * 10, // 9–19s jatuh
    delay: -Math.random() * 18, // mulai di posisi acak, tidak serentak
    drift: `${(Math.random() - 0.5) * 120}px`, // goyangan kiri/kanan
  };
}

export default function SnowEffect() {
  const [paused, setPaused] = useState(document.hidden);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);

    function onVisibility() {
      setPaused(document.hidden);
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mq.removeEventListener("change", onChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const flakes = useMemo(
    () => Array.from({ length: FLAKE_COUNT }, (_, i) => randomFlake(i)),
    [],
  );

  // Hormati prefers-reduced-motion: jangan pasang partikel bergerak sama
  // sekali (bukan cuma animation:none via CSS) supaya tidak ada elemen
  // dekoratif yang tetap "melayang" tanpa animasi & mengganggu layout.
  if (reducedMotion) return null;

  return (
    <div className={`snow-layer ${paused ? "snow-paused" : ""}`} aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="snowflake"
          style={{
            "--x": `${f.left}vw`,
            "--size": `${f.size}px`,
            "--opacity": f.opacity,
            "--duration": `${f.duration}s`,
            "--delay": `${f.delay}s`,
            "--drift": f.drift,
          }}
        >
          {f.glyph}
        </span>
      ))}
    </div>
  );
}
