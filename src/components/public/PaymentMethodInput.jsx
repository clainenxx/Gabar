// Pilihan Metode Pembayaran di Checkout (Fitur Pembayaran Cash, ditambahkan
// 2026-09-08 — migration 0008, dikonfirmasi owner via chat langsung; lihat
// PRD.md §4.1 & AGENTS.md §2 untuk pencatatan resminya).
//
// Ketentuan UX (mengikuti pola yang sama dengan LokasiPengantaranInput.jsx —
// PRD.md §4.4 "setiap fitur baru harus jelas cara pakainya tanpa penjelasan
// tambahan"): 2 kartu pilihan berdampingan dengan label eksplisit + teks
// bantuan singkat di bawah tiap opsi, bukan dropdown polos yang tidak
// menjelaskan konsekuensi masing-masing pilihan (terutama cash — customer
// perlu tahu dari awal bahwa QR-nya akan langsung muncul TANPA menunggu
// bukti bayar, dan uang baru diserahkan tunai saat pesanan diantar).
export default function PaymentMethodInput({ value, onChange }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">Metode Pembayaran</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          className={`flex cursor-pointer flex-col gap-1 rounded-xl border bg-white/90 px-3 py-2.5 text-[var(--gagi-dark)] outline-none transition ${
            value === "online" ? "border-white ring-2 ring-white" : "border-white/30"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="radio"
              name="paymentMethod"
              value="online"
              checked={value === "online"}
              onChange={() => onChange("online")}
              className="accent-[var(--gagi-dark)]"
            />
            Bayar Online
          </span>
          <span className="text-xs text-[var(--gagi-dark)]/70">
            Transfer bank/e-wallet/QRIS via Midtrans. QR pesanan muncul setelah pembayaran
            terkonfirmasi.
          </span>
        </label>

        <label
          className={`flex cursor-pointer flex-col gap-1 rounded-xl border bg-white/90 px-3 py-2.5 text-[var(--gagi-dark)] outline-none transition ${
            value === "cash" ? "border-white ring-2 ring-white" : "border-white/30"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="radio"
              name="paymentMethod"
              value="cash"
              checked={value === "cash"}
              onChange={() => onChange("cash")}
              className="accent-[var(--gagi-dark)]"
            />
            Bayar Cash
          </span>
          <span className="text-xs text-[var(--gagi-dark)]/70">
            Bayar tunai langsung ke admin saat pesanan diantar. QR langsung muncul sekarang —
            siapkan uang pas sesuai total ya!
          </span>
        </label>
      </div>
    </div>
  );
}
