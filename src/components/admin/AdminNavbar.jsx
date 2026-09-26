import { useEffect, useState } from "react";
import BrandLogo from "../BrandLogo.jsx";

// Navbar floating glassmorphism untuk /admin (Modul 13). Struktur & gaya
// sengaja dibuat konsisten dengan Navbar.jsx publik (pill melayang,
// backdrop-blur, berubah warna sedikit saat discroll).
//
// Beda dari Navbar publik: isi menunya bukan link scroll section, tapi
// daftar TAB panel admin. Di layar sempit (<md), daftar tab TIDAK lagi
// disembunyikan di balik dropdown hamburger — sejak diminta owner
// (referensi desain mockup 2026-09-26), tab langsung tampil sebagai
// baris pill yang bisa discroll horizontal di bawah header, meniru pola
// tab bar aplikasi native. Di >=md baris ini disembunyikan karena daftar
// tab sudah ada sebagai sidebar vertikal di AdminPage.
export default function AdminNavbar({
  profile,
  onLogout,
  tabs = [],
  activeTab,
  onTabChange,
  logoUrl,
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const displayName = profile?.full_name || profile?.email || "Admin";

  function handleTabClick(key) {
    if (onTabChange) onTabChange(key);
  }

  return (
    <div className="fixed inset-x-0 top-3 sm:top-4 z-40 px-3 sm:px-6">
      <header
        className={`mx-auto max-w-5xl rounded-2xl border transition-colors duration-300 ${
          scrolled ? "bg-[#0b2447]/70 border-white/25" : "bg-white/10 border-white/20"
        } backdrop-blur-xl shadow-lg shadow-black/10`}
      >
        <div className="flex h-14 sm:h-16 items-center justify-between px-3 sm:px-5 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo logoUrl={logoUrl} />
            <span className="min-w-0">
              <span className="block text-base sm:text-lg font-bold leading-none text-white">
                GABAR Admin
              </span>
              <span className="hidden sm:block text-[11px] leading-none text-white/70 mt-0.5 truncate">
                Gabin Ice Bar — panel kelola toko
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="hidden sm:block text-sm text-white/85 truncate max-w-[10rem] md:max-w-xs">
              {displayName}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/30 px-3 py-2 text-xs sm:text-sm text-white hover:bg-white/20 transition-colors shrink-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ height: 16, width: 16 }}
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="hidden xs:inline sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Baris tab pill, scrollable horizontal — cuma di layar sempit
            (<md); di >=md daftar tab sudah ada sebagai sidebar vertikal
            di AdminPage jadi baris ini disembunyikan supaya tidak dobel. */}
        <nav
          className="md:hidden flex items-center gap-2 overflow-x-auto px-3 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Menu tab admin"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabClick(tab.key)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-white text-[#0b2447] border-white"
                  : "bg-white/10 border-white/25 text-white/85 hover:bg-white/20 hover:text-white"
              }`}
            >
              {tab.mobileLabel || tab.label}
            </button>
          ))}
        </nav>
      </header>
    </div>
  );
}
