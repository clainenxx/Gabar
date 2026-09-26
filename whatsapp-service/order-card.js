// Pembuat KARTU PESANAN (gambar PNG) untuk notifikasi WhatsApp ke customer.
// ------------------------------------------------------------------------
// Sebelumnya customer dikirimi teks berisi link `/order/:token`. Sekarang
// customer dikirimi GAMBAR berisi ringkasan pesanan + QR code yang kalau
// di-scan membuka halaman order miliknya (`/order/:order_token`) — tanpa
// link mentah di pesan.
//
// Kenapa Satori + resvg (bukan Puppeteer/Chromium): tidak butuh browser
// headless (ratusan MB RAM, lambat cold start). Satori mengubah layout
// flexbox jadi SVG (teks sudah jadi path, jadi font tidak perlu terpasang
// di server), resvg-js merender SVG itu jadi PNG. Satu kartu ~50-150 ms.
//
// CARA CUSTOM TAMPILAN: cukup ubah objek `CARD_CONFIG` di bawah (teks,
// warna, jumlah item maksimal). Ubah layout = ubah fungsi `buildCardTree()`.
// Jalankan `npm run card:preview` untuk lihat hasilnya tanpa perlu WhatsApp.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";

// ---------------------------------------------------------------------
// KONFIGURASI TAMPILAN — ubah di sini untuk custom kartu
// ---------------------------------------------------------------------
export const CARD_CONFIG = {
  brand: "GABIN ICE BAR",
  // `{nama}` diganti nama customer.
  greeting: "Halo: {nama} Kami Sudah Menerima Pesanan Kamu",
  productLabel: "Product:",
  totalLabel: "Total:",
  qrCaption: "Link QR untuk ke website order anda",
  codeLabel: "Kode:",
  // Nama produk lebih dari ini tidak muncul di kartu; sisanya diringkas
  // jadi "+N produk lainnya".
  maxItemsShown: 3,
  moreItemsText: "+{n} produk lainnya",
  // Warna
  gradientFrom: "#46bcff",
  gradientTo: "#4870ff",
  textColor: "#ffffff",
  qrDark: "#0b2447",
  qrBackground: "#ffffff",
};

// Ukuran kanvas (satuan Satori) — hasil PNG = ukuran ini x SCALE.
// 1000x500 x2 = 2000x1000 px, sama dengan contoh desain owner.
const WIDTH = 1000;
const HEIGHT = 500;
const SCALE = 2;

// Batas aman input (data datang dari Edge Function, tapi tetap divalidasi
// karena endpoint service ini bisa dipanggil siapa saja yang punya API key).
const MAX_NAME_CHARS = 28;
const MAX_ITEM_NAME_CHARS = 60;
const MAX_ITEMS_INPUT = 100;

// ---------------------------------------------------------------------
// Font (dibaca sekali saat modul di-load)
// ---------------------------------------------------------------------
const fontDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const fonts = [
  { name: "Poppins", data: readFileSync(path.join(fontDir, "Poppins-Bold.ttf")), weight: 700, style: "normal" },
  { name: "Poppins", data: readFileSync(path.join(fontDir, "Poppins-Regular.ttf")), weight: 400, style: "normal" },
  { name: "Poppins", data: readFileSync(path.join(fontDir, "Poppins-Light.ttf")), weight: 300, style: "normal" },
];

// ---------------------------------------------------------------------
// Helper kecil
// ---------------------------------------------------------------------
// Satori menerima objek {type, props} (format React element) — ditulis
// manual lewat helper ini supaya tidak butuh JSX/build step. Semua elemen
// dikasih `display:flex` karena Satori mewajibkannya untuk anak >1.
function h(type, style, children) {
  return { type, props: { style: { display: "flex", ...style }, children } };
}

function truncate(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// "10000" -> "10.000" (manual, tidak bergantung ICU/locale Node di server)
export function formatRupiah(amount) {
  const n = Math.round(Number(amount) || 0);
  return "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Kode pendek di bawah QR: 8 karakter pertama token (UUID), huruf besar.
// Cuma label bantu baca, BUKAN pengganti token (token utuh ada di QR).
export function shortCode(orderToken) {
  return String(orderToken).replace(/-/g, "").slice(0, 8).toUpperCase();
}

// QR dibangun sendiri jadi SVG (1 <path> per modul gelap) dengan ukuran
// modul bulat di resolusi akhir -> tepi tajam & mudah di-scan walau
// WhatsApp mengompres gambar. Return { dataUri, size } (size satuan Satori).
function buildQr(url, maxSizeUnits) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const modulePx = Math.floor((maxSizeUnits * SCALE) / n); // px final per modul (bulat)
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<path d="${d}" fill="${CARD_CONFIG.qrDark}"/></svg>`;
  return {
    dataUri: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    size: (n * modulePx) / SCALE,
  };
}

// Perkiraan jumlah baris teks yang membungkus (Satori tidak bisa "ukur dulu"
// tanpa render). Poppins Bold rata-rata ~0,6em per karakter.
function estimateLines(text, fontPx, widthPx, ratio = 0.6) {
  return Math.max(1, Math.ceil((text.length * fontPx * ratio) / widthPx));
}

// ---------------------------------------------------------------------
// Layout kartu
// ---------------------------------------------------------------------
function buildCardTree(card) {
  const cfg = CARD_CONFIG;

  const nama = truncate(card.namaCustomer, MAX_NAME_CHARS);
  const allItems = (card.items ?? []).slice(0, MAX_ITEMS_INPUT);
  const shown = allItems.slice(0, cfg.maxItemsShown);
  const extra = allItems.length - shown.length;

  const LEFT_W = 540; // lebar kolom teks kiri
  const greeting = cfg.greeting.replace("{nama}", nama);
  const greetingPx = 30;
  const greetingLines = estimateLines(greeting, greetingPx, LEFT_W, 0.64);

  // Baris badan: "Product:" + item + ("+N lainnya") + "Total:"
  const bodyLines = 1 + shown.length + (extra > 0 ? 1 : 0) + 1;

  // Font badan mengecil otomatis kalau baris banyak / sapaan panjang,
  // supaya semua muat di tinggi kartu tanpa terpotong.
  const titlePx = 46;
  const used = 50 /*atas*/ + titlePx * 1.2 + 14 + greetingLines * greetingPx * 1.25 + 16 + 30 /*bawah*/;
  const bodyPx = Math.max(22, Math.min(34, Math.floor((HEIGHT - used) / (bodyLines * 1.32))));

  const bodyStyle = { fontSize: bodyPx, fontWeight: 300, lineHeight: 1.32, color: cfg.textColor };

  const itemRows = shown.map((it) =>
    h("div", { ...bodyStyle, width: LEFT_W }, [
      // Nama panjang dipotong "…", qty selalu terlihat.
      h(
        "div",
        { flex: "0 1 auto", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
        truncate(it.nama_produk, MAX_ITEM_NAME_CHARS),
      ),
      h("div", { flexShrink: 0, whiteSpace: "pre" }, ` - x${Math.max(1, Math.round(Number(it.qty) || 1))}`),
    ]),
  );

  const left = h(
    "div",
    { flexDirection: "column", width: LEFT_W, paddingTop: 50 },
    [
      h(
        "div",
        {
          fontSize: titlePx,
          fontWeight: 700,
          lineHeight: 1.2,
          color: cfg.textColor,
          textShadow: "0 3px 8px rgba(10,40,130,0.28)",
        },
        cfg.brand,
      ),
      h(
        "div",
        {
          marginTop: 14,
          fontSize: greetingPx,
          fontWeight: 700,
          lineHeight: 1.25,
          color: cfg.textColor,
        },
        greeting,
      ),
      h("div", { flexDirection: "column", marginTop: 16 }, [
        h("div", bodyStyle, cfg.productLabel),
        ...itemRows,
        ...(extra > 0
          ? [h("div", bodyStyle, cfg.moreItemsText.replace("{n}", String(extra)))]
          : []),
        h("div", bodyStyle, `${cfg.totalLabel} ${formatRupiah(card.total)}`),
      ]),
    ],
  );

  // Kolom kanan: kotak putih berisi QR + keterangan + kode.
  const BOX = 277;
  const { dataUri, size: qrSize } = buildQr(card.orderUrl, BOX - 44);
  const right = h(
    "div",
    { flexDirection: "column", alignItems: "center", width: 393, paddingTop: 88 },
    [
      h(
        "div",
        {
          width: BOX,
          height: BOX,
          backgroundColor: cfg.qrBackground,
          alignItems: "center",
          justifyContent: "center",
        },
        { type: "img", props: { src: dataUri, width: qrSize, height: qrSize } },
      ),
      h(
        "div",
        {
          marginTop: 14,
          width: 215,
          justifyContent: "center",
          textAlign: "center",
          fontSize: 21,
          fontWeight: 300,
          lineHeight: 1.25,
          color: cfg.textColor,
        },
        cfg.qrCaption,
      ),
      h(
        "div",
        { marginTop: 8, fontSize: 17, fontWeight: 300, color: cfg.textColor },
        `${cfg.codeLabel} ${shortCode(card.orderToken)}`,
      ),
    ],
  );

  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      paddingLeft: 68,
      fontFamily: "Poppins",
      backgroundImage: `linear-gradient(155deg, ${cfg.gradientFrom} 0%, ${cfg.gradientTo} 100%)`,
    },
    [left, right],
  );
}

// ---------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------

/**
 * Validasi data kartu dari request (dipakai endpoint & test). Return pesan
 * error (string) kalau tidak valid, `null` kalau valid.
 */
export function validateCard(card) {
  if (!card || typeof card !== "object") return "card harus object";
  if (typeof card.namaCustomer !== "string" || !card.namaCustomer.trim()) return "card.namaCustomer wajib (string)";
  if (!Array.isArray(card.items) || card.items.length === 0) return "card.items wajib (array, minimal 1)";
  for (const it of card.items) {
    if (!it || typeof it.nama_produk !== "string" || !Number.isFinite(Number(it.qty))) {
      return "setiap card.items[] butuh nama_produk (string) & qty (angka)";
    }
  }
  if (!Number.isFinite(Number(card.total)) || Number(card.total) < 0) return "card.total wajib (angka >= 0)";
  if (typeof card.orderToken !== "string" || !/^[0-9a-fA-F-]{8,64}$/.test(card.orderToken)) {
    return "card.orderToken tidak valid";
  }
  if (typeof card.orderUrl !== "string" || !/^https?:\/\/\S{4,500}$/.test(card.orderUrl)) {
    return "card.orderUrl harus URL http(s)";
  }
  if (card.caption !== undefined && typeof card.caption !== "string") return "card.caption harus string";
  return null;
}

/**
 * Render kartu pesanan jadi PNG (Buffer). Melempar error kalau data tidak
 * valid / render gagal — pemanggil (server.js) menangkapnya dan jatuh ke
 * pesan teks cadangan.
 */
export async function renderOrderCard(card) {
  const invalid = validateCard(card);
  if (invalid) throw new Error(`Data kartu tidak valid: ${invalid}`);

  const svg = await satori(buildCardTree(card), { width: WIDTH, height: HEIGHT, fonts });
  // Teks sudah jadi path di SVG -> resvg tidak perlu font sistem.
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH * SCALE },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
