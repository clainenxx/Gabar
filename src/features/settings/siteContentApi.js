import { supabase } from "../../lib/supabaseClient.js";

// Konten teks halaman publik (hero, header section Produk, section
// "Tentang GABAR", footer) — bisa diedit admin lewat tab "Konten Halaman"
// (penyempurnaan pasca-Modul 5/12, lihat migrations/0007_site_content.sql). Disimpan sebagai satu
// baris JSON (id=1) di tabel `site_content`, RLS select terbuka untuk
// publik, insert/update admin-only.
//
// `DEFAULT_SITE_CONTENT` sengaja diduplikasi persis dengan seed di migration
// SQL — dipakai sebagai fallback di frontend kalau baris di DB belum ada
// sama sekali / field tertentu belum pernah diisi admin (mis. baru migrasi
// dari versi lama, atau admin sengaja mengosongkan field), supaya halaman
// publik tidak pernah tampil kosong/rusak.
export const DEFAULT_SITE_CONTENT = {
  // URL logo (upload admin lewat tab "Konten Halaman"). Kosong = tampilan
  // lama: kotak huruf "G". Dipakai navbar publik, navbar admin, dan footer.
  logo: {
    url: "",
  },
  hero: {
    badge: "Khusus lingkungan sekolah",
    title: "Jajan Gabin, Pesan Online, Diantar ke Kelasmu",
    subtitle:
      "GABAR (Gabin Ice Bar) — pesan menu favoritmu lewat HP, bayar online, dan kami antar langsung ke lokasimu. Tanpa antre, tanpa ribet.",
    cta1: "Lihat Produk",
    cta2: "Tentang Kami",
  },
  produk: {
    title: "Produk Kami",
    subtitle: "Pilih menu, atur jumlah, lalu masukkan ke keranjang.",
  },
  about: {
    title: "Tentang GABAR",
    desc: "GABAR (Gabin Ice Bar) adalah usaha jajanan berbahan gabin yang bisa kamu pesan online, khusus untuk lingkungan sekolah. Tanpa meja kasir, tanpa antre — pilih menu favoritmu, checkout, dan kami antar langsung ke lokasimu di sekolah.",
    features: [
      {
        title: "Pesan Online",
        desc: "Pilih menu, atur jumlah, dan checkout langsung dari HP — tidak perlu chat manual lagi.",
      },
      {
        title: "Tanpa Antre di Kasir",
        desc: "Semua transaksi online, jadi kamu tidak perlu antre ke meja kasir sama sekali.",
      },
      {
        title: "Diantar ke Lokasimu",
        desc: "Cukup isi lokasi (misalnya kelasmu) saat checkout — pesanan kami antar langsung ke sana.",
      },
    ],
  },
  footer: {
    brand: "GABAR",
    // Nomor telepon "Hubungi Kami" di footer. Kosong = bagian itu disembunyikan.
    phone: "",
    tagline:
      "Gabin Ice Bar — jajanan berbahan gabin, pesan online, diantar langsung ke lokasimu di sekolah.",
    cara: [
      "1. Pilih menu & masukkan ke keranjang",
      "2. Isi lokasi pengantaran (mis. kelasmu)",
      "3. Bayar, lalu tunggu diantar ke lokasimu",
    ],
  },
};

// Deep-merge sederhana: hasil DB menimpa default per-field, tapi field yang
// null/undefined/tidak ada di DB tetap jatuh balik ke default (bukan hilang
// total) — supaya admin bisa mengisi sebagian field saja tanpa merusak
// bagian lain yang belum sempat diisi.
function mergeContent(base, override) {
  if (Array.isArray(base)) {
    if (!Array.isArray(override) || override.length === 0) return base;
    return base.map((item, i) => mergeContent(item, override[i]));
  }
  if (base && typeof base === "object") {
    if (!override || typeof override !== "object") return base;
    const result = {};
    for (const key of Object.keys(base)) {
      result[key] = mergeContent(base[key], override[key]);
    }
    return result;
  }
  return override === undefined || override === null || override === "" ? base : override;
}

export async function getSiteContent() {
  const { data, error } = await supabase
    .from("site_content")
    .select("content")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return mergeContent(DEFAULT_SITE_CONTENT, data?.content);
}

export async function updateSiteContent(content) {
  const { error } = await supabase
    .from("site_content")
    .upsert({ id: 1, content }, { onConflict: "id" });
  if (error) throw error;
  return content;
}
