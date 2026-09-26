import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listOrdersAdmin, cancelCashOrder } from "../../features/orders/ordersApi.js";
import { computeDateRange } from "../../lib/dateRange.js";
import DateRangeFilter from "./DateRangeFilter.jsx";
import { useConfirmDialog } from "../ConfirmDialogProvider.jsx";
import { orderMatchesQuery, orderPageUrl, shortOrderCode } from "../../lib/orderSearch.js";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const STATUS_LABEL = {
  pending: { text: "Menunggu Bayar", cls: "text-amber-200" },
  paid: { text: "Sudah Bayar", cls: "text-sky-200" },
  completed: { text: "Selesai Diantar", cls: "text-emerald-200" },
  cancelled: { text: "Dibatalkan", cls: "text-white/50" },
};

// Fitur Pembayaran Cash (ditambahkan 2026-09-08, migration 0008): order
// cash LANGSUNG `paid` sejak dibuat (lihat public-checkout/index.ts &
// OrderQr.jsx), jadi label "Sudah Bayar" bisa menyesatkan admin (uang
// tunainya belum benar-benar diterima) — dipakai label terpisah supaya
// admin tahu masih perlu menagih tunai saat mengantar.
const CASH_PAID_STATUS_LABEL = { text: "Cash - Belum Ditagih", cls: "text-sky-200" };

function getStatusLabel(order) {
  if (order.status === "paid" && order.payment_method === "cash") {
    return CASH_PAID_STATUS_LABEL;
  }
  return STATUS_LABEL[order.status] || { text: order.status, cls: "" };
}

// Badge kecil "Cash"/"Online" di kolom Metode — supaya admin bisa langsung
// lihat sekilas metode bayar tiap baris tanpa harus baca kolom Status.
const PAYMENT_METHOD_LABEL = {
  online: { text: "Online", cls: "border-white/25 text-white/70" },
  cash: { text: "Cash", cls: "border-amber-300/40 text-amber-100" },
};

// Tab "Pesanan" di /admin (Modul 11 — ARCHITECTURE.md §2/§4.2/§6): riwayat
// semua transaksi online + filter tanggal. Lokasi 1/Lokasi 2 sengaja
// ditampilkan LANGSUNG di baris tabel (bukan di belakang tombol/klik) —
// DoD Modul 11 secara eksplisit minta "admin bisa lihat lokasi tujuan tiap
// pesanan tanpa buka detail tambahan" supaya owner tidak perlu klik apa
// pun saat buru-buru mau berangkat mengantar. Klik baris membuka POPUP
// detail pesanan (`OrderDetailModal`, diganti dari expand-ke-bawah pada
// 2026-09-21 atas permintaan owner): nama, no. telp, email, kode antar,
// lokasi, link halaman order pelanggan, daftar item, dan total.
// Pesan error untuk `cancelCashOrder` (migration 0009) berdasarkan
// `err.code` SQLSTATE custom (PT404/PT422/PT409) — sama pola dengan
// `ScanQrTab.jsx` untuk `verify_order_pickup`, supaya tidak perlu parsing
// teks pesan Postgres yang mentah ke admin.
function cancelErrorMessage(err) {
  if (err?.code === "PT404") return "Pesanan tidak ditemukan — mungkin sudah dihapus, coba muat ulang.";
  if (err?.code === "PT422") return err.message || "Pesanan ini tidak bisa dibatalkan lewat sini.";
  if (err?.code === "PT409") return err.message || "Pesanan ini sudah tidak bisa dibatalkan lagi.";
  return err?.message || "Gagal membatalkan pesanan, coba lagi.";
}

// Pencarian pesanan (ditambahkan 2026-09-20, diminta owner; dirapikan
// 2026-09-21 — logikanya kini di `src/lib/orderSearch.js`): disaring di SISI
// KLIEN dari daftar yang sudah dimuat untuk rentang tanggal terpilih — tidak
// ada query Supabase tambahan (hemat egress, dan hasil langsung muncul saat
// mengetik). Konsekuensinya pencarian hanya mencakup rentang tanggal yang
// sedang aktif; pilih preset "Semua" untuk mencari di seluruh riwayat.
// Yang dicocokkan: nama, no. telp, email, kode antar, Lokasi 1/2, link
// halaman order, nama produk, dan status/metode.

export default function PesananTab() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Id order yang detailnya sedang dibuka di popup (null = tertutup). Yang
  // disimpan id (bukan objek order) supaya isi popup ikut ter-update kalau
  // order itu berubah (mis. dibatalkan) selagi popup terbuka.
  const [selectedId, setSelectedId] = useState(null);
  const triggerRef = useRef(null); // baris yang membuka popup, untuk mengembalikan fokus saat ditutup
  const [search, setSearch] = useState("");
  // Id order yang sedang diproses pembatalannya (Fitur Pembatalan Order
  // Cash, migration 0009) — dipakai untuk disable tombol & tampilkan
  // "Membatalkan..." supaya admin tidak klik dobel saat request masih
  // berjalan.
  const [cancellingId, setCancellingId] = useState(null);

  const loadOrders = useCallback(async (range) => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const data = await listOrdersAdmin(range);
      setOrders(data);
    } catch (err) {
      setError(err.message || "Gagal memuat riwayat pesanan");
    } finally {
      setLoading(false);
    }
  }, []);

  const visibleOrders = useMemo(
    () => orders.filter((o) => orderMatchesQuery(o, search, getStatusLabel(o).text)),
    [orders, search],
  );
  const isSearching = search.trim() !== "";
  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  );

  function openDetail(order, triggerEl) {
    triggerRef.current = triggerEl ?? null;
    setSelectedId(order.id);
  }

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    // Kembalikan fokus ke baris yang tadi diklik (aksesibilitas keyboard).
    triggerRef.current?.focus?.();
  }, []);

  // Fitur Pembatalan Order Cash (ditambahkan 2026-09-14, dikonfirmasi
  // owner, migration `0009_cancel_cash_order.sql`). Tombol ini HANYA
  // dirender untuk order `payment_method === 'cash' && status === 'paid'`
  // (lihat markup tabel di bawah) — RPC-nya sendiri juga menolak kombinasi
  // lain (PT422/PT409), jadi ini lapis UX, bukan satu-satunya penjagaan.
  // Update state secara optimistic-setelah-sukses (bukan refetch ulang
  // seluruh daftar) — cukup ganti `status` baris yang bersangkutan pakai
  // data hasil RPC (`v_row` yang di-return `cancel_cash_order`).
  async function handleCancel(order) {
    const ok = await confirmDialog(
      `Batalkan pesanan cash "${order.nama_customer}" senilai ${currencyFormatter.format(order.total)}? Stok produk yang dipesan akan dikembalikan.`,
      { title: "Batalkan Pesanan", tone: "danger", confirmLabel: "Ya, Batalkan" },
    );
    if (!ok) return;
    setCancellingId(order.id);
    try {
      const updated = await cancelCashOrder(order.id);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: updated.status } : o)));
    } catch (err) {
      await alertDialog(cancelErrorMessage(err), { title: "Gagal Membatalkan", tone: "danger" });
    } finally {
      setCancellingId(null);
    }
  }

  // Sama seperti DashboardTab.jsx — muat "Hari Ini" begitu tab dibuka,
  // tanpa perlu klik preset dulu.
  useEffect(() => {
    loadOrders(computeDateRange("hari-ini"));
  }, [loadOrders]);

  return (
    <div className="space-y-4">
      <DateRangeFilter onChange={loadOrders} />

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-2">
        <div className="relative">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, no. telp, email, kode antar, lokasi, produk, atau link order..."
            aria-label="Cari pesanan"
            className="w-full rounded-lg bg-white/10 border border-white/30 py-2 pl-9 pr-9 text-sm placeholder:text-white/50"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Hapus pencarian"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-white/60 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <p className="text-xs text-white/50">
          {isSearching
            ? `${visibleOrders.length} dari ${orders.length} pesanan cocok. `
            : ""}
          Pencarian hanya mencakup rentang tanggal di atas — pilih &quot;Semua&quot; untuk mencari di seluruh
          riwayat.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-white/80">Memuat riwayat pesanan...</p>
      ) : (
        <>
          {/* Kartu — khusus layar sempit (<md), meniru tampilan referensi
              mockup owner (2026-09-26): nama & total di baris atas, waktu +
              Lokasi 1 di bawahnya, lalu badge metode/status + tombol
              Batalkan berjejer. Data & aksi (buka detail, batalkan) SAMA
              PERSIS dengan tabel di bawah — cuma tata letaknya beda per
              breakpoint, bukan komponen terpisah dengan logika sendiri. */}
          <div className="md:hidden space-y-3">
            {visibleOrders.length === 0 && (
              <p className="rounded-2xl bg-white/10 border border-white/20 px-4 py-6 text-center text-sm text-white/70">
                {isSearching
                  ? "Tidak ada pesanan yang cocok dengan pencarian di rentang tanggal ini."
                  : "Tidak ada pesanan di rentang tanggal ini."}
              </p>
            )}
            {visibleOrders.map((o) => {
              const statusMeta = getStatusLabel(o);
              const paymentMeta = PAYMENT_METHOD_LABEL[o.payment_method] || {
                text: o.payment_method,
                cls: "border-white/25 text-white/70",
              };
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={(e) => openDetail(o, e.currentTarget)}
                  className="w-full rounded-2xl bg-white/10 border border-white/20 p-4 text-left transition-colors hover:bg-white/15 focus-visible:bg-white/15 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{o.nama_customer}</span>
                    <span className="shrink-0 font-semibold">{currencyFormatter.format(o.total)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/60">
                    {new Date(o.created_at).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    • Lokasi 1: {o.lokasi_1}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${paymentMeta.cls}`}
                    >
                      {paymentMeta.text}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs ${statusMeta.cls}`}
                    >
                      {statusMeta.text}
                    </span>
                    {o.payment_method === "cash" && o.status === "paid" && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          // Jangan ikut membuka popup detail (klik ini
                          // bukan untuk melihat detail).
                          e.stopPropagation();
                          if (cancellingId !== o.id) handleCancel(o);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            if (cancellingId !== o.id) handleCancel(o);
                          }
                        }}
                        aria-disabled={cancellingId === o.id}
                        className={`inline-flex items-center rounded-full border border-red-300/40 bg-red-500/15 px-2.5 py-1 text-xs text-red-100 transition hover:bg-red-500/25 ${
                          cancellingId === o.id ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                        }`}
                      >
                        {cancellingId === o.id ? "Membatalkan..." : "Batalkan"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Tabel — khusus >=md, tampilan lama tetap dipertahankan apa
              adanya (semua kolom termasuk Lokasi 2 yang tidak muat di
              kartu mobile). */}
          <div className="hidden md:block rounded-2xl bg-white/10 border border-white/20 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/10 text-left">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Waktu</th>
                <th className="px-3 py-2">Pelanggan</th>
                <th className="px-3 py-2">Lokasi 1</th>
                <th className="px-3 py-2">Lokasi 2</th>
                <th className="px-3 py-2 whitespace-nowrap">Total</th>
                <th className="px-3 py-2 whitespace-nowrap">Metode</th>
                <th className="px-3 py-2 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 whitespace-nowrap">Aksi</th>
                <th className="px-3 py-2 whitespace-nowrap">Detail</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-white/70">
                    {isSearching
                      ? "Tidak ada pesanan yang cocok dengan pencarian di rentang tanggal ini."
                      : "Tidak ada pesanan di rentang tanggal ini."}
                  </td>
                </tr>
              )}
              {visibleOrders.map((o) => {
                const statusMeta = getStatusLabel(o);
                const paymentMeta = PAYMENT_METHOD_LABEL[o.payment_method] || {
                  text: o.payment_method,
                  cls: "border-white/25 text-white/70",
                };
                return (
                  <tr
                    key={o.id}
                    tabIndex={0}
                    onClick={(e) => openDetail(o, e.currentTarget)}
                    onKeyDown={(e) => {
                      // Enter/Spasi pada baris yang sedang difokus = klik
                      // (hanya kalau event-nya dari baris itu sendiri, bukan
                      // dari tombol "Batalkan" di dalamnya).
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault();
                        openDetail(o, e.currentTarget);
                      }
                    }}
                    aria-label={`Lihat detail pesanan ${o.nama_customer}`}
                    className="border-t border-white/10 align-top cursor-pointer transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/40"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(o.created_at).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <div>{o.nama_customer}</div>
                      <div className="text-xs text-white/50">{o.no_telp}</div>
                    </td>
                    <td className="px-3 py-2">{o.lokasi_1}</td>
                    <td className="px-3 py-2">
                      {o.lokasi_2 || <span className="text-white/40">-</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {currencyFormatter.format(o.total)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${paymentMeta.cls}`}
                      >
                        {paymentMeta.text}
                      </span>
                    </td>
                    <td className={`px-3 py-2 whitespace-nowrap ${statusMeta.cls}`}>
                      {statusMeta.text}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.payment_method === "cash" && o.status === "paid" ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            // Jangan ikut membuka popup detail (klik ini
                            // bukan untuk melihat detail).
                            e.stopPropagation();
                            handleCancel(o);
                          }}
                          disabled={cancellingId === o.id}
                          className="rounded-lg border border-red-300/40 bg-red-500/10 px-2 py-1 text-xs text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {cancellingId === o.id ? "Membatalkan..." : "Batalkan"}
                        </button>
                      ) : (
                        <span className="text-xs text-white/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs text-white/70">
                        Lihat detail
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        >
                          <path
                            d="M7.5 5L12.5 10L7.5 15"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={closeDetail} />}
    </div>
  );
}

// Baris "label — nilai" di popup detail.
function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 border-t border-white/10 py-2 text-sm first:border-t-0">
      <dt className="text-white/50">{label}</dt>
      <dd className="min-w-0 break-words text-white">{children}</dd>
    </div>
  );
}

// Popup detail satu pesanan (menggantikan baris expand di bawah tabel,
// 2026-09-21). Ditutup lewat tombol ✕, klik di luar kotak, atau tombol Esc.
//
// WAJIB dirender lewat `createPortal` ke `document.body`, BUKAN inline di
// dalam tab: wrapper konten di `AdminPage.jsx` memakai `backdrop-blur-xl`,
// dan elemen dengan `backdrop-filter` (juga `filter`/`transform`) menjadi
// "containing block" bagi semua turunan ber-`position: fixed`. Kalau
// dirender inline, `fixed inset-0` berpatokan ke kotak panel itu — bukan ke
// layar — sehingga overlay cuma menutupi panel dan popup nempel di bawah
// panel/terpotong (bug yang ditemukan owner lewat screenshot, 2026-09-21).
// Menaikkan z-index TIDAK memperbaiki itu. Di body, `fixed inset-0` benar-
// benar mengikuti layar, dan z-[999] menaruhnya di atas navbar/panel/dialog.
function OrderDetailModal({ order, onClose }) {
  const closeButtonRef = useRef(null);
  const statusMeta = getStatusLabel(order);
  const paymentMeta = PAYMENT_METHOD_LABEL[order.payment_method] || {
    text: order.payment_method,
    cls: "border-white/25 text-white/70",
  };
  const link = orderPageUrl(order.order_token);

  useEffect(() => {
    closeButtonRef.current?.focus();

    // Kunci scroll halaman di belakang popup, kembalikan seperti semula saat ditutup.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-detail-open max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/20 bg-[#0b2447]/95 p-5 text-white shadow-2xl shadow-black/30 backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="order-detail-title" className="break-words text-base font-semibold">
              Detail Pesanan
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span className={statusMeta.cls}>{statusMeta.text}</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 ${paymentMeta.cls}`}
              >
                {paymentMeta.text}
              </span>
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup detail pesanan"
            className="shrink-0 rounded-lg px-2 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <dl className="mt-3">
          <DetailRow label="Waktu pesan">
            {new Date(order.created_at).toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </DetailRow>
          <DetailRow label="Nama">{order.nama_customer}</DetailRow>
          <DetailRow label="No. telp">{order.no_telp}</DetailRow>
          <DetailRow label="Email">{order.email}</DetailRow>
          <DetailRow label="Kode antar">
            <span className="font-mono">#{shortOrderCode(order.order_token)}</span>
          </DetailRow>
          <DetailRow label="Lokasi 1">{order.lokasi_1}</DetailRow>
          <DetailRow label="Lokasi 2">
            {order.lokasi_2 || <span className="text-white/40">-</span>}
          </DetailRow>
          <DetailRow label="Link order">
            {/* Halaman order milik pelanggan (yang QR-nya dikirim ke mereka) —
                dibuka di tab baru supaya daftar pesanan & hasil pencarian
                admin tidak hilang. */}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sky-200 underline underline-offset-2 hover:text-sky-100"
            >
              {link}
            </a>
          </DetailRow>
          <DetailRow label="Pesanan">
            <ul className="space-y-0.5">
              {(order.order_items ?? []).map((item) => (
                <li key={item.id}>
                  {item.qty}x {item.nama_produk} — {currencyFormatter.format(item.subtotal)}
                </li>
              ))}
            </ul>
          </DetailRow>
          <DetailRow label="Total">
            <span className="font-semibold">{currencyFormatter.format(order.total)}</span>
          </DetailRow>
        </dl>
      </div>
    </div>,
    document.body,
  );
}
