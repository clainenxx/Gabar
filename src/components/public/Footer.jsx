import { DEFAULT_SITE_CONTENT } from "../../features/settings/siteContentApi.js";
import BrandLogo from "../BrandLogo.jsx";

// Footer publik GAGI. Konten netral (tidak mengarang kontak/nomor yang
// tidak ada di data) — fokus ke identitas brand, navigasi ulang, dan info
// konteks jualan (khusus lingkungan sekolah) sesuai PRD.md §1.
//
// Penyempurnaan pasca-Modul 5: nama brand / tagline / 3 baris "Cara Pesan" sekarang bisa
// diedit admin lewat tab "Konten Halaman" (`content` prop). Navigasi (link
// #home/#produk/#tentang) dan copyright tahun tetap fixed — bukan konten
// yang perlu admin ubah.
export default function Footer({ content = DEFAULT_SITE_CONTENT.footer, logoUrl }) {
  const year = new Date().getFullYear();
  const cara = content.cara?.length ? content.cara : DEFAULT_SITE_CONTENT.footer.cara;
  // Nomor telepon opsional (diisi admin di "Konten Halaman"). Link `tel:`
  // cuma boleh berisi digit dan "+" di depan; tampilan tetap format yang
  // diketik admin.
  const phone = (content.phone || "").trim();
  const phoneHref = phone ? `tel:${phone.replace(/(?!^\+)[^\d]/g, "")}` : null;

  return (
    <footer className="mt-10 border-t border-white/15">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className={`grid gap-8 ${phone ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
          <div>
            <div className="flex items-center gap-2">
              <BrandLogo
                logoUrl={logoUrl}
                letter={(content.brand || "G").charAt(0)}
                className="h-9 w-9"
              />
              <span className="text-lg font-bold text-white">{content.brand}</span>
            </div>
            <p className="mt-3 text-xs text-white/70 leading-relaxed">{content.tagline}</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white">Navigasi</h4>
            <ul className="mt-3 space-y-2 text-xs text-white/70">
              <li>
                <a href="#home" className="hover:text-white">Beranda</a>
              </li>
              <li>
                <a href="#produk" className="hover:text-white">Produk</a>
              </li>
              <li>
                <a href="#tentang" className="hover:text-white">Tentang Kami</a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white">Cara Pesan</h4>
            <ul className="mt-3 space-y-2 text-xs text-white/70 leading-relaxed">
              {cara.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          {phone && (
            <div>
              <h4 className="text-sm font-semibold text-white">Hubungi Kami</h4>
              <ul className="mt-3 space-y-2 text-xs text-white/70">
                <li>
                  <a
                    href={phoneHref}
                    className="inline-flex items-center gap-2 hover:text-white"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ height: 14, width: 14 }}
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {phone}
                  </a>
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="mt-8 border-t border-white/10 pt-5 text-center text-[11px] text-white/50">
          © {year} {content.brand} (Gabin Regiee). Khusus untuk lingkungan sekolah.
        </div>
      </div>
    </footer>
  );
}
