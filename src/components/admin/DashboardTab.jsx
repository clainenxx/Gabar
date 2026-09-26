import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listOrdersAdmin,
  summarizeOrders,
  summarizeCashOrders,
  isCountedOrderStatus,
  listCustomerFirstOrderDates,
  listOrdersForStatsWindow,
} from "../../features/orders/ordersApi.js";
import {
  getDashboardCostDefaults,
  setDashboardCostDefault,
} from "../../features/settings/settingsApi.js";
import {
  computeDateRange,
  computeDashboardStatsWindow,
  addDays,
  buildRevenueBuckets,
  formatBucketLabel,
} from "../../lib/dateRange.js";
import DateRangeFilter from "./DateRangeFilter.jsx";
import RevenueBarChart from "./RevenueBarChart.jsx";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("id-ID");

// Tab "Dashboard" di /admin (Modul 11 — ARCHITECTURE.md §2/§4.2/§6), + owner
// request lanjutan: ringkasan order per status, customer baru vs repeat,
// pending payment, pesanan cash, chart revenue, kalkulator profit, dan
// produk terlaris. Total Penjualan/Order/Customer/Pending Payment/Pesanan
// Cash/Produk Terlaris/Chart Revenue SEMUA mengikuti `DateRangeFilter` di
// atas (state `orders`+`activeRange`) — termasuk chart "Revenue (7 Segmen)"
// yang owner minta (2026-09-15) ikut rentang filter aktif dibagi 7 bucket
// (bukan lagi fixed 7 hari terakhir independen). SATU-SATUNYA bagian yang
// SENGAJA tetap independen dari filter itu adalah panel "Statistik Revenue"
// (hari ini/minggu ini/bulan ini, selalu real-time berjalan terlepas dari
// filter), makanya query-nya terpisah lewat `listOrdersForStatsWindow`.
export default function DashboardTab() {
  const [orders, setOrders] = useState([]);
  const [activeRange, setActiveRange] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [customerFirstOrder, setCustomerFirstOrder] = useState(new Map());

  const [statsWindow] = useState(() => computeDashboardStatsWindow());
  const [statsOrders, setStatsOrders] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  const [costs, setCosts] = useState({ modal: 200000, paymentFee: 0, operational: 0 });
  const [costsLoading, setCostsLoading] = useState(true);
  const [savingField, setSavingField] = useState(null);

  const loadOrders = useCallback(async (range) => {
    setLoading(true);
    setError(null);
    setActiveRange(range);
    try {
      const data = await listOrdersAdmin(range);
      setOrders(data);
    } catch (err) {
      setError(err.message || "Gagal memuat data laporan");
    } finally {
      setLoading(false);
    }
  }, []);

  // Muat "Hari Ini" begitu tab dibuka pertama kali — `DateRangeFilter`
  // sudah default terlihat aktif di preset "Hari Ini" secara visual, tapi
  // tidak auto-fire `onChange` saat mount, jadi perlu dipicu manual di
  // sini pakai perhitungan rentang yang sama (`computeDateRange`).
  useEffect(() => {
    loadOrders(computeDateRange("hari-ini"));
  }, [loadOrders]);

  // Data pendukung yang tidak bergantung pada filter tanggal di atas: peta
  // order pertama tiap customer (utk new vs repeat), jendela statistik
  // revenue tetap, dan default biaya profit — semua cukup dimuat sekali.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await listCustomerFirstOrderDates();
        if (!cancelled) setCustomerFirstOrder(map);
      } catch {
        // Diamkan — kartu customer akan fallback anggap semua "repeat"
        // kalau data histori gagal dimuat, tidak menghentikan dashboard.
      }
    })();
    (async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const data = await listOrdersForStatsWindow(statsWindow);
        if (!cancelled) setStatsOrders(data);
      } catch (err) {
        if (!cancelled) setStatsError(err.message || "Gagal memuat statistik revenue");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    (async () => {
      setCostsLoading(true);
      try {
        const defaults = await getDashboardCostDefaults();
        if (!cancelled) setCosts(defaults);
      } catch {
        // Fallback ke default bawaan (state awal) kalau settings gagal dibaca.
      } finally {
        if (!cancelled) setCostsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = summarizeOrders(orders);
  const cashSummary = summarizeCashOrders(orders);

  const orderBreakdown = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let expired = 0;
    for (const o of orders) {
      if (o.status === "paid" || o.status === "completed") paid += 1;
      else if (o.status === "pending") pending += 1;
      else if (o.status === "cancelled") expired += 1;
    }
    return { total: orders.length, paid, pending, expired };
  }, [orders]);

  const customerBreakdown = useMemo(() => {
    const phones = new Set(orders.map((o) => o.no_telp));
    let baru = 0;
    let repeat = 0;
    const rangeFrom = activeRange?.from ? new Date(activeRange.from) : null;
    for (const phone of phones) {
      const firstOrderAt = customerFirstOrder.get(phone);
      const isFirstOrderInRange =
        firstOrderAt && rangeFrom ? new Date(firstOrderAt) >= rangeFrom : false;
      if (isFirstOrderInRange) baru += 1;
      else repeat += 1;
    }
    return { total: phones.size, baru, repeat };
  }, [orders, customerFirstOrder, activeRange]);

  const pendingPayment = useMemo(() => {
    const pendingOrders = orders.filter((o) => o.status === "pending");
    return {
      total: pendingOrders.reduce((sum, o) => sum + Number(o.total), 0),
      count: pendingOrders.length,
    };
  }, [orders]);

  const topProducts = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      if (!isCountedOrderStatus(o.status)) continue;
      for (const item of o.order_items ?? []) {
        const existing = map.get(item.nama_produk) ?? {
          nama: item.nama_produk,
          qty: 0,
          revenue: 0,
        };
        existing.qty += item.qty;
        existing.revenue += Number(item.subtotal);
        map.set(item.nama_produk, existing);
      }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [orders]);

  const revenueStats = useMemo(() => {
    const sumSince = (sinceDate) =>
      statsOrders
        .filter((o) => isCountedOrderStatus(o.status) && new Date(o.created_at) >= sinceDate)
        .reduce((sum, o) => sum + Number(o.total), 0);
    return {
      hariIni: sumSince(statsWindow.todayStart),
      mingguIni: sumSince(statsWindow.weekStart),
      bulanIni: sumSince(statsWindow.monthStart),
    };
  }, [statsOrders, statsWindow]);

  const chartData = useMemo(() => {
    // Rentang chart mengikuti `activeRange` (DateRangeFilter yang sedang
    // dipilih) — Hari Ini/Kemarin/Custom Range sudah punya `from`/`to`
    // pasti, tapi preset "Semua" sengaja kirim `{from: null, to: null}`
    // (lihat `computeDateRange`), jadi di sini perlu di-resolve dulu: pakai
    // order PALING LAMA di data yang sedang dimuat (`orders`, hasil query
    // TANPA batas tanggal untuk preset ini) sebagai titik awal, sampai
    // sekarang sebagai titik akhir. Kalau tidak ada order sama sekali,
    // fallback 7 hari terakhir murni supaya chart tetap render (7 bucket
    // kosong) alih-alih pembagian invalid.
    let from = activeRange?.from;
    let to = activeRange?.to;
    if (!from || !to) {
      const now = new Date();
      to = now.toISOString();
      if (orders.length === 0) {
        from = addDays(now, -7).toISOString();
      } else {
        const earliest = orders.reduce(
          (min, o) => (new Date(o.created_at) < min ? new Date(o.created_at) : min),
          new Date(orders[0].created_at),
        );
        from = earliest.toISOString();
      }
    }

    const buckets = buildRevenueBuckets(from, to);
    const totalSpanMs = new Date(to).getTime() - new Date(from).getTime();

    return buckets.map((bucket) => {
      const value = orders
        .filter(
          (o) =>
            isCountedOrderStatus(o.status) &&
            new Date(o.created_at) >= bucket.start &&
            new Date(o.created_at) < bucket.end,
        )
        .reduce((sum, o) => sum + Number(o.total), 0);
      return { label: formatBucketLabel(bucket, totalSpanMs), value };
    });
  }, [orders, activeRange]);

  const netProfit = summary.totalPenjualan - costs.modal - costs.paymentFee - costs.operational;

  async function handleCostChange(field, rawValue) {
    const value = Math.max(0, Number(rawValue) || 0);
    setCosts((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCostBlur(field) {
    setSavingField(field);
    try {
      await setDashboardCostDefault(field, costs[field]);
    } catch {
      // Gagal simpan default tidak menghentikan alur — nilai tetap dipakai
      // untuk kalkulasi sesi ini, cuma tidak persist ke settings.
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div className="space-y-4">
      <DateRangeFilter onChange={loadOrders} />

      {error && (
        <p className="rounded-lg bg-red-500/20 border border-red-300/40 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-white/80">Memuat laporan...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 sm:gap-3">
            <GlassCard>
              <CardLabel>Total Penjualan</CardLabel>
              <CardValue>{currencyFormatter.format(summary.totalPenjualan)}</CardValue>
              <CardHint className="hidden sm:block">
                Status: sudah bayar + selesai diantar
              </CardHint>
            </GlassCard>

            <GlassCard>
              <CardLabel>Total Orders</CardLabel>
              <CardValue>{numberFormatter.format(orderBreakdown.total)}</CardValue>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] sm:text-xs">
                <StatChip color="text-emerald-200" label="Paid" value={orderBreakdown.paid} />
                <StatChip color="text-amber-200" label="Pending" value={orderBreakdown.pending} />
                <StatChip color="text-red-200" label="Expired" value={orderBreakdown.expired} />
              </div>
            </GlassCard>

            <GlassCard>
              <CardLabel>Total Customer</CardLabel>
              <CardValue>{numberFormatter.format(customerBreakdown.total)}</CardValue>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] sm:text-xs">
                <StatChip color="text-sky-200" label="Baru" value={customerBreakdown.baru} />
                <StatChip
                  color="text-white/70"
                  label="Repeat"
                  value={customerBreakdown.repeat}
                />
              </div>
            </GlassCard>

            <GlassCard>
              <CardLabel>Pending Payment</CardLabel>
              <CardValue>{currencyFormatter.format(pendingPayment.total)}</CardValue>
              <CardHint>{numberFormatter.format(pendingPayment.count)} transaksi</CardHint>
            </GlassCard>

            <GlassCard>
              <CardLabel>Pesanan Cash</CardLabel>
              <CardValue>{currencyFormatter.format(cashSummary.totalCash)}</CardValue>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] sm:text-xs">
                <StatChip
                  color="text-sky-200"
                  label="Jumlah"
                  value={cashSummary.jumlahCash}
                />
                <StatChip
                  color="text-red-200"
                  label="Dibatalkan Admin"
                  value={cashSummary.jumlahDibatalkanAdmin}
                />
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <GlassCard className="xl:col-span-2">
              <div className="flex items-center justify-between">
                <CardLabel>Statistik Revenue</CardLabel>
                <span className="text-[10px] text-white/40 uppercase tracking-wide">
                  Real-time
                </span>
              </div>
              {statsError && <p className="mt-2 text-xs text-red-200">{statsError}</p>}
              {statsLoading ? (
                <p className="mt-2 text-sm text-white/60">Memuat...</p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    <RevenueRow label="Hari ini" value={revenueStats.hariIni} />
                    <RevenueRow label="Minggu ini" value={revenueStats.mingguIni} />
                    <RevenueRow label="Bulan ini" value={revenueStats.bulanIni} />
                  </tbody>
                </table>
              )}
            </GlassCard>

            <GlassCard className="xl:col-span-3">
              <div className="flex items-center justify-between">
                <CardLabel>Revenue (7 Segmen)</CardLabel>
                <span className="text-[10px] text-white/40 uppercase tracking-wide">
                  Ikut filter di atas
                </span>
              </div>
              {loading ? (
                <p className="mt-2 text-sm text-white/60">Memuat grafik...</p>
              ) : (
                <div className="mt-1">
                  <RevenueBarChart data={chartData} />
                </div>
              )}
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <GlassCard className="xl:col-span-2">
              <CardLabel>Profit / Keuntungan</CardLabel>
              <p className="mt-0.5 text-xs text-white/50">
                Dihitung dari Total Penjualan pada rentang filter di atas.
              </p>

              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Revenue</span>
                  <span className="font-medium">
                    {currencyFormatter.format(summary.totalPenjualan)}
                  </span>
                </div>

                <CostInputRow
                  label="Modal"
                  field="modal"
                  value={costs.modal}
                  disabled={costsLoading}
                  saving={savingField === "modal"}
                  onChange={handleCostChange}
                  onBlur={handleCostBlur}
                />
                <CostInputRow
                  label="Payment Fee"
                  field="paymentFee"
                  value={costs.paymentFee}
                  disabled={costsLoading}
                  saving={savingField === "paymentFee"}
                  onChange={handleCostChange}
                  onBlur={handleCostBlur}
                />
                <CostInputRow
                  label="Operational Cost"
                  field="operational"
                  value={costs.operational}
                  disabled={costsLoading}
                  saving={savingField === "operational"}
                  onChange={handleCostChange}
                  onBlur={handleCostBlur}
                />

                <div className="border-t border-white/20 pt-2 flex items-center justify-between">
                  <span className="font-semibold">Net Profit</span>
                  <span
                    className={`text-lg font-semibold ${
                      netProfit < 0 ? "text-red-200" : "text-emerald-200"
                    }`}
                  >
                    {currencyFormatter.format(netProfit)}
                  </span>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="xl:col-span-3">
              <CardLabel>Produk Terlaris</CardLabel>
              {topProducts.length === 0 ? (
                <p className="mt-2 text-sm text-white/60">
                  Belum ada produk terjual pada rentang ini.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm min-w-[360px]">
                    <thead className="text-left text-white/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="py-1.5 pr-2">Produk</th>
                        <th className="py-1.5 pr-2 text-right">Terjual</th>
                        <th className="py-1.5 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((p) => (
                        <tr key={p.nama} className="border-t border-white/10">
                          <td className="py-1.5 pr-2">{p.nama}</td>
                          <td className="py-1.5 pr-2 text-right">
                            {numberFormatter.format(p.qty)}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {currencyFormatter.format(p.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

function GlassCard({ children, className = "" }) {
  return (
    <div
      className={`rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 shadow-lg shadow-black/10 p-3 sm:p-4 transition-all duration-300 hover:bg-white/[0.13] hover:border-white/30 ${className}`}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }) {
  return (
    <p className="text-[11px] sm:text-xs text-white/60 uppercase tracking-wide truncate">
      {children}
    </p>
  );
}

function CardValue({ children }) {
  return <p className="text-lg sm:text-2xl font-semibold mt-1 leading-tight">{children}</p>;
}

function CardHint({ children, className = "" }) {
  return <p className={`text-xs text-white/50 mt-1 ${className}`}>{children}</p>;
}

function StatChip({ label, value, color }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/15 px-2 py-0.5">
      <span className={color}>{label}</span>
      <span className="text-white/90 font-medium">{numberFormatter.format(value)}</span>
    </span>
  );
}

function RevenueRow({ label, value }) {
  return (
    <tr className="border-t border-white/10 first:border-t-0">
      <td className="py-1.5 text-white/70">{label}</td>
      <td className="py-1.5 text-right font-medium">{currencyFormatter.format(value)}</td>
    </tr>
  );
}

function CostInputRow({ label, field, value, disabled, saving, onChange, onBlur }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/70">{label}</span>
      <div className="flex items-center gap-1.5">
        {saving && <span className="text-[10px] text-white/40">menyimpan…</span>}
        <div className="flex items-center rounded-lg bg-white/10 border border-white/20 focus-within:border-white/40 px-2 py-1">
          <span className="text-xs text-white/50 mr-1">Rp</span>
          <input
            type="number"
            min="0"
            step="1000"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(field, e.target.value)}
            onBlur={() => onBlur(field)}
            className="w-24 bg-transparent text-right text-sm outline-none disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
