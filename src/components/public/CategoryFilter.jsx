// Filter kategori di homepage (Modul 5 — ARCHITECTURE.md §2: "daftar produk
// per kategori dengan filter"). Kategori tidak hardcode (PRD.md §4.3) —
// daftar ini datang langsung dari tabel `categories` yang admin kelola.
export default function CategoryFilter({ categories, activeCategoryId, onSelect }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm border ${
          activeCategoryId === null
            ? "bg-white/25 border-white/40"
            : "bg-white/5 border-white/15 hover:bg-white/15"
        }`}
      >
        Semua
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm border ${
            activeCategoryId === c.id
              ? "bg-white/25 border-white/40"
              : "bg-white/5 border-white/15 hover:bg-white/15"
          }`}
        >
          {c.nama}
        </button>
      ))}
    </div>
  );
}
