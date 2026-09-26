import { useEffect, useRef } from "react";

// Reveal-on-scroll pakai IntersectionObserver (bukan listener `scroll`
// polos) — sesuai catatan performa ARCHITECTURE.md §0.11. Elemen yang
// dipasangi ref ini dapat class `reveal` (state awal: sedikit turun +
// transparan, lihat index.css) lalu `reveal-visible` begitu masuk viewport.
// Kalau `prefers-reduced-motion` aktif, index.css sudah override supaya
// `.reveal` langsung terlihat (opacity 1) tanpa observer perlu tahu apa-apa.
export function useScrollReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("reveal-visible");
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("reveal-visible");
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
