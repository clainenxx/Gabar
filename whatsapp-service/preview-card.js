// Pratinjau kartu pesanan TANPA perlu WhatsApp/Baileys — dipakai saat
// mengubah tampilan (`CARD_CONFIG`/layout di order-card.js).
//   npm run card:preview
// Hasil PNG ditulis ke folder `card-preview/` (sudah di .gitignore).
import { mkdirSync, writeFileSync } from "node:fs";
import { renderOrderCard } from "./order-card.js";

const orderUrl = (token) => `https://contoh-situs-anda.com/order/${token}`;
const samples = {
  "1-satu-item": {
    orderToken: "3f2a9c1e-1111-4222-8333-444455556666",
    namaCustomer: "Budi Santoso",
    items: [{ nama_produk: "Gabin Coklat", qty: 2 }],
    total: 10000,
  },
  "2-tiga-item-nama-panjang": {
    orderToken: "8c41d7a2-1111-4222-8333-444455556666",
    namaCustomer: "Muhammad",
    items: [
      { nama_produk: "Gabin Coklat", qty: 2 },
      { nama_produk: "Gabin Strawberry Premium Extra Besar Dengan Topping Keju", qty: 1 },
      { nama_produk: "Gabin Matcha", qty: 3 },
    ],
    total: 32000,
  },
  "3-banyak-item": {
    orderToken: "5e90b3f1-1111-4222-8333-444455556666",
    namaCustomer: "Siti Nur",
    items: [
      { nama_produk: "Gabin Coklat", qty: 1 },
      { nama_produk: "Gabin Strawberry", qty: 2 },
      { nama_produk: "Gabin Matcha", qty: 1 },
      { nama_produk: "Gabin Vanilla", qty: 1 },
      { nama_produk: "Gabin Taro", qty: 1 },
      { nama_produk: "Gabin Oreo", qty: 1 },
    ],
    total: 64000,
  },
};

mkdirSync("card-preview", { recursive: true });
for (const [name, card] of Object.entries(samples)) {
  const started = Date.now();
  const png = await renderOrderCard({ ...card, orderUrl: orderUrl(card.orderToken) });
  writeFileSync(`card-preview/${name}.png`, png);
  console.log(`card-preview/${name}.png  ${(png.length / 1024).toFixed(0)} KB  ${Date.now() - started} ms`);
}
