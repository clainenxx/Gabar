// Field Lokasi Pengantaran (Modul 7 — ARCHITECTURE.md §0.3, PRD.md §4.1).
// Ketentuan UX WAJIB (bukan sekadar ada fiturnya, PRD.md §4.1):
// - Kedua field ditampilkan berdampingan/berurutan di SATU form checkout
//   (bukan disembunyikan di step lain) — dipenuhi oleh siapapun yang
//   merender <LokasiPengantaranInput> langsung di form Checkout.jsx.
// - Label jelas: "Lokasi 1 (wajib) — di mana kamu sekarang?" /
//   "Lokasi 2 (opsional) — kalau kamu akan pindah tempat".
// - Placeholder contoh nyata: "Kelas A" / "Kantin".
// - Teks bantuan singkat di bawah Lokasi 2 menjelaskan fungsinya.
// - Lokasi 2 TIDAK BOLEH terlihat wajib: tidak ada tanda bintang, dan
//   parent (Checkout.jsx) tidak boleh mem-block submit kalau field ini
//   kosong (validasi wajib cuma untuk Lokasi 1).
export default function LokasiPengantaranInput({
  lokasi1,
  lokasi2,
  onChangeLokasi1,
  onChangeLokasi2,
  errorLokasi1,
  errorLokasi2,
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="lokasi1">
          Lokasi 1 (wajib) — di mana kamu sekarang?
        </label>
        <input
          id="lokasi1"
          type="text"
          required
          maxLength={200}
          value={lokasi1}
          onChange={(e) => onChangeLokasi1(e.target.value)}
          placeholder="Kelas A"
          className={`w-full rounded-xl border bg-white/90 text-[var(--gagi-dark)] px-3 py-2 outline-none focus:ring-2 focus:ring-white ${
            errorLokasi1 ? "border-red-300" : "border-white/30"
          }`}
        />
        {errorLokasi1 && (
          <p className="mt-1 text-xs text-red-200">{errorLokasi1}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="lokasi2">
          Lokasi 2 (opsional) — kalau kamu akan pindah tempat
        </label>
        <input
          id="lokasi2"
          type="text"
          maxLength={200}
          value={lokasi2}
          onChange={(e) => onChangeLokasi2(e.target.value)}
          placeholder="Kantin"
          className={`w-full rounded-xl border bg-white/90 text-[var(--gagi-dark)] px-3 py-2 outline-none focus:ring-2 focus:ring-white ${
            errorLokasi2 ? "border-red-300" : "border-white/30"
          }`}
        />
        {errorLokasi2 && (
          <p className="mt-1 text-xs text-red-200">{errorLokasi2}</p>
        )}
        <p className="mt-1 text-xs text-white/70">
          Diisi kalau ada rencana pindah lokasi — supaya kami tetap bisa menemukanmu.
        </p>
      </div>
    </div>
  );
}
