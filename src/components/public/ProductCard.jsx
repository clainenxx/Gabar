import { useEffect, useRef, useState } from "react";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// Kartu produk homepage (Modul 5, redesign lanjutan Modul 13 diminta owner
// 2026-09-08). Tidak ada pilihan varian per produk (ARCHITECTURE.md §0.9).
//
// Perubahan diminta owner (Modul 13):
// 1. Qty stepper DIHAPUS dari kartu produk ini — setiap klik "+ Keranjang"
//    selalu menambah 1 (usePublicCart.addItem sudah otomatis akumulasi
//    qty kalau produk yang sama diklik berkali-kali, tidak perlu ubah
//    hook-nya). Stepper qty TETAP ada di CartDrawer (tidak dihapus di
//    sana) — pengaturan jumlah dipindah sepenuhnya ke keranjang.
// 2. Tombol "+ Keranjang" dikasih animasi signifikan saat diklik supaya
//    customer yakin produk sudah masuk keranjang: tombol berubah jadi
//    hijau + centang + teks "Ditambahkan!" (scale-up singkat), plus
//    indikator "+1" yang melayang ke atas lalu memudar (`animate-fly-up`,
//    didefinisikan di index.css, dinonaktifkan otomatis lewat
//    prefers-reduced-motion sesuai ARCHITECTURE.md §0.11). Tombol dibuat
//    disabled sesaat selama animasi supaya tidak ke-spam klik beruntun.
//
// Satu-satunya batasan tetap: stok 0 -> tombol tambah disabled (PRD.md
// §4.1 "Stok Habis").
export default function ProductCard({ product, onAdd }) {
  const [justAdded, setJustAdded] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const timeoutRef = useRef(null);
  const outOfStock = product.stock <= 0;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleAdd() {
    onAdd(product, 1);
    setJustAdded(true);
    setPulseKey((k) => k + 1);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setJustAdded(false), 850);
  }

  return (
    <div className="h-full rounded-2xl bg-white/10 border border-white/20 overflow-hidden flex flex-col">
      <div className="aspect-square bg-white/5">
        {product.gambar_url ? (
          <img
            src={product.gambar_url}
            alt={product.nama}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-white/40 text-xs">
            Tanpa gambar
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        {/* min-h + line-clamp: nama panjang max 2 baris & nama pendek tetap
            makan tempat 2 baris, jadi harga/tombol sejajar & ukuran kartu sama. */}
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.75em]">
          {product.nama}
        </h3>
        {product.deskripsi && (
          <p className="text-xs text-white/70 line-clamp-2">{product.deskripsi}</p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{currencyFormatter.format(product.harga)}</p>
          <span
            className={`text-[11px] shrink-0 ${outOfStock ? "text-red-200" : "text-white/60"}`}
          >
            {outOfStock ? "Stok habis" : `Stok: ${product.stock}`}
          </span>
        </div>

        <div className="mt-auto pt-2">
          {outOfStock ? (
            <span className="inline-flex w-full items-center justify-center rounded-xl bg-white/10 border border-white/20 px-3 py-2.5 text-xs text-white/60">
              Stok Habis
            </span>
          ) : (
            <div className="relative">
              {justAdded && (
                <span
                  key={pulseKey}
                  className="pointer-events-none absolute -top-1 right-3 text-emerald-200 font-bold text-sm animate-fly-up z-10"
                >
                  +1
                </span>
              )}
              <button
                type="button"
                onClick={handleAdd}
                disabled={justAdded}
                className={`w-full flex items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-sm font-semibold shadow-md shadow-black/10 transition-all duration-300 ${
                  justAdded
                    ? "bg-emerald-400 text-white scale-[1.05]"
                    : "bg-white text-[#0b2447] hover:bg-white/90 active:scale-[0.96]"
                }`}
              >
                {justAdded ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ height: 16, width: 16 }}
                      className="animate-pop"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Ditambahkan!
                  </>
                ) : (
                  "+ Keranjang"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
