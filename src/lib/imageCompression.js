// Kompresi gambar di browser SEBELUM diupload ke R2 (diminta owner: produk
// & banner sering difoto langsung dari HP, ukurannya bisa 3-8MB per file —
// dikompres dulu di sisi client supaya upload lebih cepat & hemat kuota R2,
// tanpa perlu server/Edge Function tambahan yang bisa proses gambar berat).
//
// Strategi: resize gambar ke maksimal `maxDimension` px di sisi terpanjang
// (foto produk/banner tidak pernah perlu resolusi lebih dari itu untuk
// ditampilkan di web), lalu re-encode ke WebP (jauh lebih kecil dari
// JPEG/PNG di kualitas visual yang sama, dan Edge Function
// `product-image-upload` sudah mengizinkan ekstensi .webp).
//
// GIF sengaja DILEWATI (tidak dikompres) — canvas cuma bisa menggambar 1
// frame, kalau dipaksa akan menghilangkan animasinya. GIF tetap diupload
// apa adanya seperti sebelumnya.
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.8;

/**
 * Kompres 1 file gambar. Selalu resolve ke sebuah File — kalau kompresi
 * gagal/tidak menghasilkan file lebih kecil/gambarnya GIF, resolve ke file
 * ASLI (bukan pernah melempar error) supaya alur upload tetap jalan normal.
 */
export async function compressImage(
  file,
  { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY } = {},
) {
  if (!file || !file.type?.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // jaga animasinya, lihat catatan di atas

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) return file; // browser tidak dukung encode webp lewat toBlob

    // Kalau hasil kompresi malah lebih besar (jarang, tapi bisa terjadi pada
    // gambar yang sudah sangat kecil/simpel), pakai file asli saja.
    if (blob.size >= file.size) return file;

    const compressedName = renameExtension(file.name, "webp");
    return new File([blob], compressedName, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch (err) {
    // Kompresi cuma optimisasi, bukan syarat wajib upload — kalau gagal
    // (mis. format aneh/browser lama), lanjut upload file asli tanpa error.
    console.warn("[imageCompression] gagal kompres, upload file asli:", err);
    return file;
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  // Fallback untuk browser tanpa createImageBitmap (Safari lama): pakai
  // elemen <img> + object URL biasa.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitWithin(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renameExtension(fileName, newExt) {
  const base = fileName.replace(/\.[^.]+$/, "");
  return `${base || "gambar"}.${newExt}`;
}
