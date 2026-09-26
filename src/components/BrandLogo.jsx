import { useState } from "react";

// Kotak logo brand dipakai bareng oleh navbar publik, navbar admin, dan
// footer publik. Kalau admin sudah upload logo (tab "Konten Halaman") yang
// tampil adalah gambarnya; kalau belum ada / gambarnya gagal dimuat, jatuh
// balik ke kotak berisi huruf (tampilan lama) supaya tidak pernah kosong/rusak.
export default function BrandLogo({
  logoUrl,
  letter = "G",
  className = "h-8 w-8 sm:h-9 sm:w-9",
}) {
  // Simpan URL yang gagal (bukan boolean) supaya ganti logo ke URL baru
  // otomatis mencoba menampilkan gambar lagi tanpa perlu reset manual.
  const [failedUrl, setFailedUrl] = useState(null);
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/15 border border-white/25 text-sm font-bold text-white ${className}`}
    >
      {showImage ? (
        <img
          src={logoUrl}
          alt="Logo"
          onError={() => setFailedUrl(logoUrl)}
          className="h-full w-full object-contain"
        />
      ) : (
        letter
      )}
    </span>
  );
}
