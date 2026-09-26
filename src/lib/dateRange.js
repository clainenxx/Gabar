// Helper hitung rentang tanggal untuk filter laporan (Modul 11 — Laporan
// Penjualan & Riwayat Pesanan, ARCHITECTURE.md §4.2: "filter tanggal hari
// ini/kemarin/custom range"). Dipakai bareng oleh `DashboardTab.jsx` &
// `PesananTab.jsx` lewat komponen `DateRangeFilter.jsx` supaya logic
// hitung rentangnya cuma ada di 1 tempat — kedua tab WAJIB tampilkan angka
// yang konsisten satu sama lain (DoD Modul 11: "angka total penjualan
// cocok dengan hitung manual dari data transaksi di rentang tanggal yang
// sama").
//
// Batas hari dihitung di timezone LOKAL device (bukan UTC) — asumsi wajar
// untuk GAGI karena admin cuma 1-2 orang di lokasi yang sama (sekolah),
// beda dari sistem multi-region yang butuh timezone eksplisit per user.

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const PRESETS = [
  { key: "hari-ini", label: "Hari Ini" },
  { key: "kemarin", label: "Kemarin" },
  { key: "semua", label: "Semua" },
  { key: "custom", label: "Custom Range" },
];

// Return `{ from, to }` (ISO string, atau `null`/`null` untuk preset "semua"
// yang berarti TIDAK ADA batas rentang sama sekali) atau `null` kalau input
// custom belum lengkap. `to` bersifat EKSKLUSIF (dipakai dengan
// `.lt("created_at", to)` di query) supaya baris pada batas hari berikutnya
// tidak ikut ter-hitung dobel di rentang yang berbeda.
export function computeDateRange(preset, customFrom, customTo) {
  const today = startOfDay(new Date());

  if (preset === "hari-ini") {
    return { from: today.toISOString(), to: addDays(today, 1).toISOString() };
  }

  if (preset === "kemarin") {
    const yesterday = addDays(today, -1);
    return { from: yesterday.toISOString(), to: today.toISOString() };
  }

  // "semua" — owner minta lihat seluruh histori tanpa batas tanggal
  // (dashboard/tab Pesanan). `from`/`to` sengaja `null` (bukan tanggal
  // sangat jauh mundur) supaya query di `ordersApi.js` bisa mendeteksi dan
  // melewati `.gte`/`.lt` sama sekali, bukan cuma bikin rentang sangat
  // lebar yang tetap ada batasnya.
  if (preset === "semua") {
    return { from: null, to: null };
  }

  // custom: customFrom/customTo string "YYYY-MM-DD" dari <input type="date">.
  if (!customFrom || !customTo) return null;
  const from = startOfDay(new Date(`${customFrom}T00:00:00`));
  const to = addDays(startOfDay(new Date(`${customTo}T00:00:00`)), 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// Helper tambahan untuk kartu "Statistik Revenue" & chart 7 hari terakhir di
// DashboardTab.jsx. Beda dari `computeDateRange` di atas (yang dipakai
// `DateRangeFilter`) — kartu-kartu ini SELALU menampilkan hari ini/minggu
// ini/bulan ini terlepas dari preset apa yang admin pilih di filter utama,
// jadi butuh rentang sendiri yang tidak bergantung ke pilihan filter.
// ---------------------------------------------------------------------------

// Senin dianggap awal minggu (konvensi Indonesia), beda dari `Date#getDay()`
// yang mulai dari Minggu (0).
function startOfWeekMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diffFromMonday = day === 0 ? 6 : day - 1;
  return addDays(d, -diffFromMonday);
}

function startOfMonth(date) {
  const d = startOfDay(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Rentang gabungan yang cukup lebar untuk menghitung "Hari Ini"/"Minggu
// Ini"/"Bulan Ini" DAN 7 hari terakhir untuk chart, dalam 1x query — dipilih
// batas paling awal di antara keduanya supaya tidak ada data yang kepotong.
export function computeDashboardStatsWindow() {
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(today);
  const sevenDaysAgo = addDays(today, -6);
  const from = monthStart < sevenDaysAgo ? monthStart : sevenDaysAgo;
  return {
    from: from.toISOString(),
    to: addDays(today, 1).toISOString(),
    todayStart: today,
    weekStart: startOfWeekMonday(today),
    monthStart,
  };
}

const DAY_LABELS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Label hari singkat Indonesia untuk sumbu chart (mis. "Sen", "Sel", ...).
export function shortDayLabelId(date) {
  return DAY_LABELS_ID[new Date(date).getDay()];
}

// ---------------------------------------------------------------------------
// Bucket chart Revenue — owner minta (2026-09-15) chart "Revenue" di
// DashboardTab SELALU dibagi PERSIS 7 bucket sama lebar, ikut rentang
// `DateRangeFilter` yang sedang aktif (bukan lagi fixed 7 HARI terakhir
// seperti sebelumnya): preset "Hari Ini" → 24 jam dibagi 7, "Kemarin" →
// rentang 1 hari itu dibagi 7, "Custom Range"/"Semua" → rentang tanggal
// yang dipilih/seluruh histori dibagi 7 juga — cuma LEBAR tiap bucket yang
// beda mengikuti panjang rentang, jumlah bucket selalu 7.
// ---------------------------------------------------------------------------

// Bagi rentang waktu `[fromISO, toISO)` jadi 7 bucket sama panjang. Return
// array `{ start, end }` (objek `Date`) — pemanggil yang menjumlahkan
// revenue per bucket dari data order yang sudah dimuat.
export function buildRevenueBuckets(fromISO, toISO) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  // Hindari div-by-zero/rentang negatif kalau from===to (mis. "Semua" tanpa
  // data sama sekali, fallback di DashboardTab) — minimal 1ms span.
  const span = Math.max(to - from, 1);
  const bucketMs = span / 7;
  const buckets = [];
  for (let i = 0; i < 7; i++) {
    buckets.push({
      start: new Date(from + i * bucketMs),
      end: new Date(from + (i + 1) * bucketMs),
    });
  }
  return buckets;
}

// Format label 1 bucket tergantung LEBAR TOTAL rentang (bukan lebar per
// bucket) — rentang pendek (<=2 hari, cocok untuk preset Hari Ini/Kemarin)
// pakai label jam "HH:mm" supaya cukup presisi; rentang lebih panjang
// (Custom Range multi-hari atau "Semua") pakai label tanggal "dd/MM"
// karena label jam untuk bucket selebar beberapa hari tidak informatif.
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export function formatBucketLabel(bucket, totalSpanMs) {
  if (totalSpanMs <= TWO_DAYS_MS) {
    return bucket.start.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  return bucket.start.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
}
