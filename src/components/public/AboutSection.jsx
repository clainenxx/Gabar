import { DEFAULT_SITE_CONTENT } from "../../features/settings/siteContentApi.js";

// Section "Tentang Kami" di homepage publik. Menjelaskan model bisnis GAGI
// (jualan makanan berbahan gabin, online order only, tanpa kasir fisik,
// dipakai di lingkungan sekolah) — konteks dari PRD.md §1/§2 supaya
// pelanggan (siswa/guru) paham cara pesannya sebelum checkout.
//
// Penyempurnaan pasca-Modul 5: judul/deskripsi/teks 3 fitur di bawah ini sekarang bisa diedit
// admin lewat tab "Konten Halaman" (`content` prop, dari `site_content` di
// Supabase) — cuma IKON yang tetap fixed di kode (dipasangkan berdasarkan
// urutan index, bukan diedit admin, supaya admin tidak perlu urus SVG).
const ICONS = [
  <path key="i0" d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0H5a2 2 0 0 1-2-2v-4m6 6h10a2 2 0 0 0 2-2v-4M3 9h18M3 15h18" />,
  <path key="i1" d="M20 6 9 17l-5-5" />,
  <g key="i2">
    <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.3" />
  </g>,
];

export default function AboutSection({ content = DEFAULT_SITE_CONTENT.about }) {
  const features = content.features?.length ? content.features : DEFAULT_SITE_CONTENT.about.features;

  return (
    <section id="tentang" className="scroll-mt-20 py-10">
      <div className="rounded-3xl bg-white/8 border border-white/15 p-6 sm:p-8">
        <div className="max-w-2xl">
          <h2 className="text-xl sm:text-2xl font-bold text-white">{content.title}</h2>
          <p className="mt-2 text-sm text-white/80 leading-relaxed">{content.desc}</p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={f.title || i}
              className="rounded-2xl bg-white/5 border border-white/15 p-4 flex flex-col gap-2"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 border border-white/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ height: 20, width: 20 }}
                  className="text-white"
                >
                  {ICONS[i] ?? ICONS[0]}
                </svg>
              </span>
              <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              <p className="text-xs text-white/70 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
