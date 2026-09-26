import { Link } from "react-router-dom";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// Drawer keranjang di "/" (Modul 5 — ARCHITECTURE.md §2: tidak ada route
// /cart terpisah, digabung ke "/" sebagai drawer supaya lebih ringkas).
// Tombol "Lanjut ke Checkout" cuma navigasi ke /checkout — submit
// sungguhan ke Edge Function `public-checkout` baru masuk Modul 7,
// halaman /checkout saat ini masih placeholder.
//
// Modul 13 (diminta owner): background drawer diganti jadi transparan +
// blur (glassmorphism, konsisten dengan Navbar.jsx) — sebelumnya solid
// `bg-[#0b2447]`. Qty stepper per item TETAP ada di sini (tidak dihapus,
// beda dari ProductCard.jsx yang qty steppernya sudah dihapus dari
// section produk).
export default function CartDrawer({ open, onClose, items, subtotal, onSetQty, onRemove, stockByProduct }) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Tutup keranjang"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm cursor-default"
        />
      )}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-[#0b2447]/45 backdrop-blur-2xl border-l border-white/25 text-white flex flex-col shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/15">
          <h2 className="text-lg font-semibold">Keranjang</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white"
            aria-label="Tutup keranjang"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 && (
            <p className="text-sm text-white/70">Keranjang masih kosong — yuk pilih menu dulu.</p>
          )}
          {items.map((it) => {
            const currentStock = stockByProduct?.get(it.productId) ?? it.stock;
            const exceedsStock = it.qty > currentStock;
            return (
            <div
              key={it.productId}
              className="flex gap-3 rounded-xl bg-white/10 border border-white/15 p-2"
            >
              {it.gambar_url ? (
                <img
                  src={it.gambar_url}
                  alt={it.nama}
                  className="h-14 w-14 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-white/10 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{it.nama}</p>
                <p className="text-xs text-white/70">{currencyFormatter.format(it.harga)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-white/10 border border-white/20">
                    <button
                      type="button"
                      onClick={() => onSetQty(it.productId, it.qty - 1)}
                      className="px-2 text-sm"
                      aria-label="Kurangi jumlah"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm">{it.qty}</span>
                    <button
                      type="button"
                      onClick={() => onSetQty(it.productId, it.qty + 1)}
                      className="px-2 text-sm"
                      aria-label="Tambah jumlah"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(it.productId)}
                    className="text-xs text-red-200 hover:text-red-100"
                  >
                    Hapus
                  </button>
                </div>
                {/* Info kalau qty di keranjang sudah melebihi stok yang
                    tersisa SEKARANG — bukan pembatas, cuma peringatan.
                    Jumlah sebenarnya yang bisa dipesan baru dipastikan
                    server-side saat checkout (Modul 7). */}
                {exceedsStock && (
                  <p className="mt-1 text-[11px] text-amber-200">
                    Stok tersisa {currentStock} — kelebihannya akan disesuaikan otomatis saat
                    checkout.
                  </p>
                )}
              </div>
              <p className="text-sm font-semibold shrink-0">
                {currencyFormatter.format(it.harga * it.qty)}
              </p>
            </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/15 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span>Total</span>
            <span className="text-lg font-semibold">{currencyFormatter.format(subtotal)}</span>
          </div>
          <Link
            to="/checkout"
            onClick={items.length === 0 ? (e) => e.preventDefault() : undefined}
            aria-disabled={items.length === 0}
            className={`block text-center rounded-xl px-4 py-2.5 text-sm font-medium ${
              items.length === 0
                ? "bg-white/10 text-white/40 cursor-not-allowed"
                : "bg-white text-[#0b2447] hover:bg-white/90"
            }`}
          >
            Lanjut ke Checkout
          </Link>
        </div>
      </aside>
    </>
  );
}
