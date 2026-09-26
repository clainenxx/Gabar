import { useEffect, useRef, useState } from "react";

// Carousel banner di header "/" (banner-nya dikelola admin di Modul 4,
// ARCHITECTURE.md §2). Auto-rotate ringan pakai `setInterval` biasa, bukan
// library carousel — cukup untuk kebutuhan MVP, tema salju/efek visual
// penuh menyusul di Modul 13 (ARCHITECTURE.md §0.11).
const ROTATE_INTERVAL_MS = 5000;

// `variant`:
// - "hero" (default) — versi lama: kartu membulat, ukuran tetap, dipakai
//   di dalam grid/section (kalau suatu saat dibutuhkan lagi).
// - "top" — strip promo di ATAS section hero (masih di dalam container
//   `max-w-6xl` yang sama dengan konten lain — lebarnya menyesuaikan,
//   TIDAK full-bleed), tinggi dibatasi (`max-h-56`/`max-h-64`) supaya
//   tidak "gede banget" meskipun rasio asli gambar 1600×400 (4:1) lewat
//   `aspect-[4/1]` + `object-cover`, jadi tetap rapi & proporsional di
//   semua breakpoint.
// Ambang batas geser (dalam px) supaya dianggap "swipe" pindah slide,
// bukan sekadar tap/klik yang sedikit meleset.
const SWIPE_THRESHOLD_PX = 50;

export default function BannerCarousel({ banners, variant = "hero" }) {
  const [index, setIndex] = useState(0);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef(null);
  const dragState = useRef({ startX: 0, width: 0, pointerId: null, moved: false });

  const count = banners.length;

  useEffect(() => {
    if (count <= 1 || isDragging) return undefined;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, isDragging]);

  // Kalau daftar banner berubah (mis. dari admin) dan index jadi out-of-range.
  useEffect(() => {
    if (index > 0 && index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  const goTo = (i) => setIndex(((i % count) + count) % count);

  const handlePointerDown = (e) => {
    if (count <= 1) return;
    const width = trackRef.current?.offsetWidth || 1;
    dragState.current = {
      startX: e.clientX,
      width,
      pointerId: e.pointerId,
      moved: false,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const delta = e.clientX - dragState.current.startX;
    if (Math.abs(delta) > 5) dragState.current.moved = true;
    setDragOffsetPx(delta);
  };

  const endDrag = () => {
    if (!isDragging) return;
    const { width } = dragState.current;
    if (dragOffsetPx <= -SWIPE_THRESHOLD_PX) {
      goTo(index + 1);
    } else if (dragOffsetPx >= SWIPE_THRESHOLD_PX) {
      goTo(index - 1);
    }
    setIsDragging(false);
    setDragOffsetPx(0);
    void width;
  };

  const handlePointerUp = () => endDrag();
  const handlePointerLeave = () => {
    if (isDragging) endDrag();
  };

  // Kalau user habis nge-drag (bukan sekadar klik), jangan ikut trigger
  // link banner supaya swipe tidak "kepencet" buka tab baru.
  const handleLinkClick = (e) => {
    if (dragState.current.moved) e.preventDefault();
  };

  const isTop = variant === "top";
  const width = trackRef.current?.offsetWidth || 0;
  const dragPercent = width ? (dragOffsetPx / width) * 100 : 0;
  const translatePercent = -index * 100 + dragPercent;

  const imgClass = isTop
    ? "aspect-[4/1] w-full flex-shrink-0 object-cover"
    : "h-40 sm:h-56 w-full flex-shrink-0 rounded-2xl object-cover";

  const track = (
    <div
      ref={trackRef}
      className="flex w-full touch-pan-y select-none"
      style={{
        transform: `translateX(${translatePercent}%)`,
        transition: isDragging ? "none" : "transform 400ms ease",
        cursor: count > 1 ? (isDragging ? "grabbing" : "grab") : "default",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
      onPointerLeave={handlePointerLeave}
    >
      {banners.map((b) => (
        <div key={b.id} className="w-full flex-shrink-0">
          {b.link ? (
            <a
              href={b.link}
              target="_blank"
              rel="noreferrer"
              className="block"
              draggable={false}
              onClick={handleLinkClick}
            >
              <img
                src={b.gambar_url}
                alt={b.judul || "Banner promo GABAR"}
                className={imgClass}
                draggable={false}
              />
            </a>
          ) : (
            <img
              src={b.gambar_url}
              alt={b.judul || "Banner promo GABAR"}
              className={imgClass}
              draggable={false}
            />
          )}
        </div>
      ))}
    </div>
  );

  if (isTop) {
    return (
      <div className="relative w-full max-h-56 sm:max-h-64 overflow-hidden rounded-2xl border border-white/15 shadow-lg shadow-black/10">
        {track}
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Tampilkan banner ke-${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const current = banners[index];

  return (
    <div>
      <div className="overflow-hidden rounded-2xl">{track}</div>
      {current.judul && <p className="mt-2 text-center text-sm text-white/90">{current.judul}</p>}
      {count > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Tampilkan banner ke-${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-white" : "w-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
