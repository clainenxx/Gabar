import { useCallback, useEffect, useState } from "react";

// Cart publik "/" (Modul 5 — ARCHITECTURE.md §6, PRD.md §4.1: drawer,
// persist di localStorage supaya tidak hilang saat reload). Tidak ada
// pilihan varian per item (§0.9) — 1 baris cart = 1 produk.
//
// Perubahan scope (diminta owner 2026-09-08, lihat TODO.md changelog):
// qty di keranjang TIDAK lagi dibatasi ke `stock` — customer boleh
// menambah berapa pun (stok cuma dipakai sebagai snapshot info harga
// display, bukan pembatas). Validasi qty > stok tersisa baru dilakukan
// nanti di checkout (Modul 7, ARCHITECTURE.md §0.7): kalau qty di
// keranjang melebihi stok yang tersisa saat checkout, jumlah yang bisa
// dipesan otomatis dibatasi ke stok tersisa (bukan ditolak total) —
// harga & stok tetap dihitung ulang server-side saat itu.
const STORAGE_KEY = "gagi_public_cart_v1";

function loadFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // localStorage tidak tersedia (mis. private mode ketat) atau isinya
    // rusak — mulai dari cart kosong daripada bikin halaman error.
    return [];
  }
}

export function usePublicCart() {
  const [items, setItems] = useState(loadFromStorage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Gagal persist (storage penuh/diblokir) — cart tetap jalan normal
      // untuk sesi berjalan, cuma tidak akan bertahan setelah reload.
    }
  }, [items]);

  const addItem = useCallback((product, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((it) => it.productId === product.id);
      if (existing) {
        return prev.map((it) =>
          it.productId === product.id
            ? { ...it, qty: it.qty + qty, stock: product.stock }
            : it,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          nama: product.nama,
          harga: product.harga,
          gambar_url: product.gambar_url,
          stock: product.stock,
          qty: Math.max(1, qty),
        },
      ];
    });
  }, []);

  // qty <= 0 otomatis menghapus item dari cart (dipakai tombol "-" di
  // drawer sampai 0, tanpa perlu tombol Hapus terpisah untuk kasus ini).
  const setQty = useCallback((productId, qty) => {
    setItems((prev) =>
      prev
        .map((it) => (it.productId === productId ? { ...it, qty } : it))
        .filter((it) => it.qty > 0),
    );
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((prev) => prev.filter((it) => it.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const itemCount = items.reduce((sum, it) => sum + it.qty, 0);
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.harga, 0);

  return { items, addItem, setQty, removeItem, clearCart, itemCount, subtotal };
}
