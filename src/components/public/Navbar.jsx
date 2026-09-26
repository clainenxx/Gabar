import { useEffect, useState } from "react";
import BrandLogo from "../BrandLogo.jsx";

// Navbar publik GAGI — "melayang" (floating) di tengah atas dengan jarak
// dari tepi layar, bukan nempel penuh ke atas/samping. Latar
// semi-transparan + backdrop-blur (glassmorphism) sesuai
// ARCHITECTURE.md §0.11 ("batasi backdrop-filter/blur cuma untuk elemen
// yang sedikit jumlahnya di layar, mis. navbar" — ini salah satunya).
// Link scroll ke section (Produk & Tentang Kami di halaman yang sama),
// tombol keranjang dengan badge jumlah item, plus menu mobile (hamburger)
// yang muncul sebagai dropdown menyatu di bawah pill saat layar sempit.
const NAV_LINKS = [
  { href: "#home", label: "Beranda" },
  { href: "#produk", label: "Produk" },
  { href: "#tentang", label: "Tentang Kami" },
];

export default function Navbar({ itemCount, onCartClick, logoUrl }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleNavClick(href) {
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="fixed inset-x-0 top-3 sm:top-4 z-40 px-3 sm:px-6">
      <header
        className={`mx-auto max-w-4xl rounded-2xl border transition-colors duration-300 ${
          scrolled
            ? "bg-[#0b2447]/70 border-white/25"
            : "bg-white/10 border-white/20"
        } backdrop-blur-xl shadow-lg shadow-black/10`}
      >
        <div className="flex h-14 sm:h-16 items-center justify-between px-3 sm:px-5">
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              handleNavClick("#home");
            }}
            className="flex items-center gap-2"
          >
            <BrandLogo logoUrl={logoUrl} />
            <span>
              <span className="block text-base sm:text-lg font-bold leading-none text-white">
                GABAR
              </span>
              <span className="hidden sm:block text-[11px] leading-none text-white/70 mt-0.5">
                Gabin Ice Bar
              </span>
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(link.href);
                }}
                className="rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10 hover:text-white transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCartClick}
              className="relative flex items-center gap-2 rounded-xl bg-white/10 border border-white/30 px-2.5 sm:px-3.5 py-2 text-sm text-white hover:bg-white/20 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ height: 18, width: 18 }}
              >
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span className="hidden sm:inline">Keranjang</span>
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-400 text-[11px] leading-5 text-center text-white">
                  {itemCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Buka menu"
              aria-expanded={menuOpen}
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 border border-white/25 text-white shrink-0 transition-transform duration-200 active:scale-90"
            >
              {menuOpen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ height: 18, width: 18 }}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ height: 18, width: 18 }}>
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="animate-navbar-dropdown md:hidden flex flex-col gap-1 px-3 pb-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(link.href);
                }}
                className="rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10 hover:text-white transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}
      </header>
    </div>
  );
}
