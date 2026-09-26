import { supabase } from "../../lib/supabaseClient.js";
import { compressImage } from "../../lib/imageCompression.js";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — batas wajar untuk foto produk.

// Upload gambar produk/banner ke R2 lewat presigned URL (Edge Function
// `product-image-upload`, Modul 3 — ARCHITECTURE.md §4.2). Kredensial R2
// TIDAK PERNAH ada di sini, cuma di Edge Function (§5.7, §5.9).
//
// `folder` folder-aware ("products" | "banners" | "logos") supaya fungsi ini reusable
// apa adanya di Modul 4 (Banner).
//
// `onStatusChange` opsional (dipakai form untuk teks status) — dipanggil
// dengan "compressing" lalu "uploading" supaya user tahu prosesnya cuma
// terasa lama sekali sesaat sebelum benar-benar upload ke R2.
export async function uploadImage(file, folder = "products", onStatusChange) {
  if (!file) throw new Error("Pilih file gambar terlebih dahulu");
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Ukuran gambar maksimal 5MB");
  }

  // Kompres dulu di browser SEBELUM cek/dipakai untuk upload (diminta
  // owner) — lihat `src/lib/imageCompression.js` untuk detail strategi
  // (resize + re-encode WebP). Validasi ukuran 5MB di atas sengaja tetap
  // dicek terhadap file ASLI (bukan hasil kompresi) supaya pesan errornya
  // masuk akal buat user ("file yang kamu pilih kegedean"), bukan
  // tergantung hasil kompresi yang mereka tidak lihat langsung.
  onStatusChange?.("compressing");
  const uploadFile = await compressImage(file);
  onStatusChange?.("uploading");

  // supabase.functions.invoke otomatis menyertakan Authorization: Bearer
  // <JWT admin yang login> dari session client saat ini — Edge Function
  // memverifikasi ini sebelum keluarkan presigned URL.
  const { data, error } = await supabase.functions.invoke("product-image-upload", {
    body: { folder, fileName: uploadFile.name, contentType: uploadFile.type },
  });

  if (error) {
    throw new Error(error.message || "Gagal menghubungi layanan upload gambar");
  }
  if (data?.error) {
    throw new Error(data.error);
  }

  const { uploadUrl, publicUrl } = data;
  if (!uploadUrl) {
    throw new Error("Respons upload tidak lengkap (uploadUrl kosong)");
  }

  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
    body: uploadFile,
  });
  if (!putResponse.ok) {
    throw new Error("Upload gambar ke penyimpanan gagal, coba lagi");
  }

  if (!publicUrl) {
    // R2_PUBLIC_URL_BASE belum diset owner di Edge Function env — gambar
    // sudah terupload tapi kita tidak tahu URL publiknya untuk disimpan.
    throw new Error(
      "Gambar terupload tapi URL publik tidak tersedia — pastikan R2_PUBLIC_URL_BASE sudah diset di Edge Function",
    );
  }

  return publicUrl;
}
