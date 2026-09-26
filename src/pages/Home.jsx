import { useCallback, useEffect, useMemo, useState } from "react";
import { listCategories } from "../features/products/categoriesApi.js";
import { listActiveProducts } from "../features/products/publicProductsApi.js";
import { listActiveBanners } from "../features/banners/bannersApi.js";
import { getSiteContent, DEFAULT_SITE_CONTENT } from "../features/settings/siteContentApi.js";
import { usePublicCart } from "../hooks/usePublicCart.js";
import { subscribeProductStock } from "../lib/realtime.js";
import Navbar from "../components/public/Navbar.jsx";
import SnowEffect from "../components/public/SnowEffect.jsx";
import Reveal from "../components/public/Reveal.jsx";
import BannerCarousel from "../components/public/BannerCarousel.jsx";
import CategoryFilter from "../components/public/CategoryFilter.jsx";
import ProductCard from "../components/public/ProductCard.jsx";
import CartDrawer from "../components/public/CartDrawer.jsx";
import AboutSection from "../components/public/AboutSection.jsx";
import Footer from "../components/public/Footer.jsx";

// Landing page publik "/" (Modul 5 — ARCHITECTURE.md §2/§6, PRD.md §4.1):
// banner promosi, produk per kategori + filter, cart drawer persist di
// localStorage. `listCategories` di-reuse apa adanya dari Modul 3
// (categoriesApi.js) — RLS "categories_select_all" memang terbuka untuk
// publik maupun admin, tidak perlu query terpisah.
//
// Tampilan disusun sebagai landing page lengkap: navbar floating
// glassmorphism, hero (header) dengan banner promosi, section Produk
// dengan filter kategori, section Tentang Kami, footer, plus tema
// musim-dingin (ARCHITECTURE.md §0.11): gradient dusk, efek salju ringan
// (SnowEffect, auto-pause di tab background & hormati
// prefers-reduced-motion), dan reveal-on-scroll pakai IntersectionObserver
// (Reveal) — bukan listener `scroll` polos.
export default function Home() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [banners, setBanners] = useState([]);
  const [content, setContent] = useState(DEFAULT_SITE_CONTENT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  const { items, addItem, setQty, removeItem, itemCount, subtotal } = usePublicCart();

  // Beberapa error dari Supabase bersifat transient (hilang sendiri dalam
  // hitungan detik) — bukan bug di kode kita, biasanya karena node
  // API/auth Supabase yang sempat tidak sinkron sesaat (mis. project baru
  // "bangun" dari auto-pause). "JWT issued at future" adalah salah satu
  // contohnya (401 di semua query yang butuh apikey). Untuk error seperti
  // ini, retry singkat dulu sebelum menampilkan apa pun ke pengunjung —
  // supaya mereka tidak lihat pesan teknis Supabase mentah kalau ternyata
  // sembuh sendiri setelah dicoba ulang.
  const isTransientAuthError = (err) => {
    const msg = (err?.message || "").toLowerCase();
    return (
      msg.includes("jwt issued at future") ||
      msg.includes("jwt expired") ||
      (err?.status === 401 && msg.includes("jwt"))
    );
  };

  const fetchAllOnce = () =>
    Promise.all([
      listCategories(),
      listActiveProducts(),
      listActiveBanners(),
      // Gagal ambil konten TIDAK boleh membuat seluruh halaman error —
      // fallback ke default hardcode kalau tabel/baris belum ada.
      getSiteContent().catch(() => DEFAULT_SITE_CONTENT),
    ]);

  const loadAll = useCallback(async () => {
    setError(null);
    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const [cats, prods, banns, siteContent] = await fetchAllOnce();
        setCategories(cats);
        setProducts(prods);
        setBanners(banns);
        setContent(siteContent);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        // Hanya retry untuk error transient di atas, dan hanya kalau
        // masih ada percobaan tersisa. Error lain (mis. RLS/permission
        // yang memang salah) langsung ditampilkan, tidak perlu retry.
        if (!isTransientAuthError(err) || attempt === maxAttempts) break;
        // Jeda singkat sebelum retry (0.8s, 1.6s) — cukup untuk error
        // clock-skew sesaat di sisi Supabase biasanya sudah sembuh.
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
    }

    // Semua percobaan gagal — baru tampilkan ke pengunjung, dengan pesan
    // ramah untuk error transient (bukan teks teknis Supabase mentah).
    setError(
      isTransientAuthError(lastErr)
        ? "Koneksi ke server lagi bermasalah sesaat, coba muat ulang halaman ya."
        : lastErr?.message || "Gagal memuat halaman, coba refresh lagi",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Modul 6 — Realtime Stok Produk (ARCHITECTURE.md §6): dengar perubahan
  // `stock`/`aktif` produk lewat Postgres Changes (bukan polling/reload).
  // `subscribeProductStock` (lib/realtime.js) sudah discaffold sejak
  // Modul 0, baru disambungkan di sini. Hanya patch baris yang berubah —
  // tidak query ulang seluruh daftar produk supaya tidak flicker/hilang
  // posisi scroll customer. Kalau produk baru saja diaktifkan lewat
  // event UPDATE (bukan INSERT), baris itu otomatis ikut muncul karena
  // `products` state sudah berisi produk itu sejak query awal (RLS
  // "products_select_active" cuma menyaring SELECT, event UPDATE dari
  // Postgres Changes tetap terkirim ke semua subscriber tabel `products`
  // tanpa filter RLS tambahan).
  useEffect(() => {
    const unsubscribe = subscribeProductStock((payload) => {
      const updated = payload.new;
      setProducts((prev) => {
        const exists = prev.some((p) => p.id === updated.id);
        if (!exists) return prev;
        return prev.map((p) =>
          p.id === updated.id ? { ...p, stock: updated.stock, aktif: updated.aktif } : p,
        );
      });
    });
    return unsubscribe;
  }, []);

  const filteredProducts = useMemo(() => {
    if (!activeCategoryId) return products;
    return products.filter((p) => p.category_id === activeCategoryId);
  }, [products, activeCategoryId]);

  // Map productId -> stok terkini, dipakai CartDrawer untuk menampilkan
  // peringatan kalau qty di keranjang sudah melebihi stok tersisa
  // sekarang (bukan pembatas — cuma info, lihat catatan scope di
  // usePublicCart.js/CartDrawer.jsx).
  const stockByProduct = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p.stock));
    return map;
  }, [products]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <SnowEffect />
        <p className="relative z-10">Memuat GABAR...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white relative">
      <SnowEffect />
      <Navbar
        itemCount={itemCount}
        onCartClick={() => setCartOpen(true)}
        logoUrl={content.logo?.url}
      />

      {/* Jarak atas menyesuaikan tinggi navbar floating (~4.25rem) + margin
          dari tepi, supaya konten tidak ketutupan navbar. */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 pt-24 sm:pt-28">
        {error && (
          <p className="mb-4 rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        )}

        {/* Banner promo — lebar mengikuti container (sama seperti section
            lain, bukan full-bleed), diletakkan di BAWAH navbar tapi masih
            DI ATAS teks hero section 1. */}
        <Reveal>
          <BannerCarousel banners={banners} variant="top" />
        </Reveal>

        {/* Hero / header */}
        <section id="home" className="scroll-mt-24 pt-5 sm:pt-6 pb-6 sm:pb-8">
          <Reveal className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-3 py-1 text-[11px] text-white shadow-sm">
              <span className="animate-twinkle">❄</span> {content.hero.badge}
            </span>
            <h1
              className="mt-3 text-3xl sm:text-4xl font-bold leading-tight text-white"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}
            >
              {content.hero.title}
            </h1>
            <p className="mt-3 text-sm text-white/90 leading-relaxed">{content.hero.subtitle}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="#produk"
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector("#produk")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-xl bg-white text-[#0b2447] px-5 py-2.5 text-sm font-semibold hover:bg-white/90 hover:-translate-y-0.5 transition-transform shadow-lg shadow-black/10"
              >
                {content.hero.cta1}
              </a>
              <a
                href="#tentang"
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector("#tentang")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-xl bg-white/10 border border-white/30 px-5 py-2.5 text-sm font-semibold hover:bg-white/20 hover:-translate-y-0.5 transition-transform"
              >
                {content.hero.cta2}
              </a>
            </div>
          </Reveal>
        </section>

        {/* Produk */}
        <section id="produk" className="scroll-mt-24 py-8">
          <Reveal>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{content.produk.title}</h2>
                <p className="text-xs sm:text-sm text-white/70 mt-1">{content.produk.subtitle}</p>
              </div>
            </div>

            <CategoryFilter
              categories={categories}
              activeCategoryId={activeCategoryId}
              onSelect={setActiveCategoryId}
            />
          </Reveal>

          {filteredProducts.length === 0 ? (
            <p className="text-center text-white/70 py-10">
              {products.length === 0
                ? "Belum ada produk yang dijual — cek lagi nanti ya."
                : "Belum ada produk di kategori ini."}
            </p>
          ) : (
            // Mobile (<sm): satu baris yang digeser ke samping (snap, tanpa
            // scrollbar), tiap kartu lebar tetap & tinggi disamakan (stretch);
            // >=sm: kembali ke grid biasa. -mx-4/px-4 supaya baris geser
            // mentok ke tepi layar (container induk px-4).
            <Reveal
              as="div"
              className="mt-4 -mx-4 px-4 pt-1 pb-3 flex items-stretch gap-3 overflow-x-auto snap-x snap-mandatory scroll-pl-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-3 md:grid-cols-4 sm:overflow-visible"
            >
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className="w-[44%] shrink-0 snap-start sm:w-auto sm:shrink transition-transform hover:-translate-y-1"
                >
                  <ProductCard product={p} onAdd={addItem} />
                </div>
              ))}
            </Reveal>
          )}
        </section>

        {/* Tentang Kami */}
        <Reveal>
          <AboutSection content={content.about} />
        </Reveal>
      </div>

      <div className="relative z-10">
        <Footer content={content.footer} logoUrl={content.logo?.url} />
      </div>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={items}
        subtotal={subtotal}
        onSetQty={setQty}
        onRemove={removeItem}
        stockByProduct={stockByProduct}
      />
    </div>
  );
}
