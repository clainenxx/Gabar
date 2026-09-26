// _shared/r2.ts — presigned URL generator untuk upload gambar produk/banner
// ke Cloudflare R2 (S3-compatible). Dipanggil dari Edge Function
// `product-image-upload` (Modul 3/4). Kredensial R2 HANYA ada di sini,
// tidak pernah di kode /src (ARCHITECTURE.md §5.9).

import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

function r2Client() {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY belum diset");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * @param folder "products" | "banners" — folder-aware supaya reusable
 *   antara Modul 3 (produk) dan Modul 4 (banner), lihat ARCHITECTURE.md §6.
 * @param contentType opsional — dikirim supaya object R2 tersimpan dengan
 *   MIME type yang benar (mis. "image/webp"), bukan default generik.
 */
export async function getPresignedUploadUrl(
  folder: "products" | "banners",
  fileName: string,
  contentType?: string,
) {
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  if (!bucket) throw new Error("R2_BUCKET_NAME belum diset");

  const key = `${folder}/${crypto.randomUUID()}-${fileName}`;
  const client = r2Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(contentType ? { ContentType: contentType } : {}),
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });

  const publicUrlBase = Deno.env.get("R2_PUBLIC_URL_BASE");
  // Validasi skema URL wajib ada — kalau R2_PUBLIC_URL_BASE diset tanpa
  // "https://" (mis. cuma "gagi.sycledark.workers.dev"), hasil gabungan
  // jadi string tanpa skema, dan browser diam-diam menganggapnya path
  // RELATIF dari halaman yang lagi dibuka (bukan error keras) — user baru
  // sadar setelah gambar tidak muncul/link aneh. Lebih baik gagal keras &
  // jelas di sini (TODO.md Bug/Isu #5).
  if (publicUrlBase && !/^https?:\/\//i.test(publicUrlBase)) {
    throw new Error(
      `R2_PUBLIC_URL_BASE harus diawali "http://" atau "https://" (nilai sekarang: "${publicUrlBase}")`,
    );
  }
  const publicUrl = publicUrlBase ? `${publicUrlBase}/${key}` : null;

  return { uploadUrl, key, publicUrl };
}