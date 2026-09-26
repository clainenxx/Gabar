import { useState } from "react";
import { PRESETS, computeDateRange } from "../../lib/dateRange.js";

// Filter tanggal dipakai bareng oleh `DashboardTab.jsx` & `PesananTab.jsx`
// (Modul 11 — ARCHITECTURE.md §2: dua-duanya butuh filter yang sama
// persis "hari ini/kemarin/custom range"). Komponen ini murni UI + hitung
// rentang tanggal (`src/lib/dateRange.js`), TIDAK query Supabase sendiri —
// pemanggil (lewat prop `onChange`) yang query pakai rentang hasilnya,
// supaya tab Dashboard & Pesanan bebas menentukan sendiri apa yang mereka
// lakukan dengan data hasil query.
export default function DateRangeFilter({ onChange }) {
  const [preset, setPreset] = useState("hari-ini");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [error, setError] = useState(null);

  function apply(nextPreset, nextFrom, nextTo) {
    setError(null);

    if (nextPreset === "custom" && nextFrom && nextTo && new Date(nextFrom) > new Date(nextTo)) {
      setError("Tanggal mulai tidak boleh setelah tanggal akhir.");
      return;
    }

    const range = computeDateRange(nextPreset, nextFrom, nextTo);
    if (!range) {
      if (nextPreset === "custom") {
        setError("Isi tanggal mulai & tanggal akhir dulu, lalu klik \"Terapkan\".");
      }
      return;
    }
    onChange(range);
  }

  function handlePresetClick(key) {
    setPreset(key);
    if (key !== "custom") apply(key);
  }

  return (
    <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => handlePresetClick(p.key)}
            className={`rounded-lg px-3 py-1.5 text-sm border ${
              preset === p.key
                ? "bg-white/25 border-white/40"
                : "bg-white/5 border-white/15 hover:bg-white/15"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-white/70 gap-1">
            Dari tanggal
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-white/70 gap-1">
            Sampai tanggal
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => apply("custom", customFrom, customTo)}
            className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30"
          >
            Terapkan
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-200">{error}</p>}
    </div>
  );
}
