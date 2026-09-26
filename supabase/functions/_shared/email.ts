// _shared/email.ts — dipakai semua Edge Function yang perlu kirim email
// (midtrans-webhook, dst.). Gmail SMTP + App Password via denomailer,
// dikonfirmasi owner (ARCHITECTURE.md §0.5). Ganti isi file ini saja kalau
// nanti pindah provider (Resend, dll) — jangan ubah kode pemanggil.

// PENTING: denomailer@1.6.0 export class-nya bernama `SMTPClient` (semua
// kapital), BUKAN `SmtpClient` — dan constructornya menerima satu objek
// `{ connection: {...} }`, bukan `new SmtpClient()` + `.connectTLS(...)`
// terpisah seperti versi/lib lama. Import dengan nama yang salah bikin
// module ini gagal di-resolve saat boot (Uncaught SyntaxError: ... does
// not provide an export named 'SmtpClient'), yang mem-block SEMUA Edge
// Function yang import `_shared/email.ts` (bukan cuma yang error).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Fallback plain-text sederhana dari HTML, supaya email tetap punya bagian
// text/plain (beberapa mail client/anti-spam filter menyukai ini) tanpa
// perlu menulis versi teks terpisah tiap kali sendEmail() dipanggil.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================================
// Modul 15d (v2, 2026-09-18) — fix ULANG artefak `=20` di badan email.
//
// Fix pertama (2026-09-15, opsi `debug: { encodeLB: true }`) TERBUKTI TIDAK
// BEKERJA — dikonfirmasi owner masih muncul `=20` di email sungguhan. Root
// cause SEBENARNYA (dicek langsung dari source code denomailer@1.6.0 di
// GitHub, bukan cuma baca README): fungsi `resolveContent()` di
// `config/mail/content.ts` memanggil `quotedPrintableEncode(text)` /
// `quotedPrintableEncode(html)` TANPA PERNAH mengoper parameter `encLB` sama
// sekali — jadi opsi `debug.encodeLB` yang didokumentasikan README itu
// SETARA MATI TOTAL untuk isi email (cuma disebut di komentar/tipe config,
// tidak pernah benar-benar dipakai di jalur encoding). Fix kemarin secara
// teknis tidak mungkin berhasil, bukan salah konfigurasi.
//
// Bug lebih dalam ada di `quotedPrintableEncode()` sendiri (`encoding.ts`):
// (1) trailing spasi di akhir baris HARUS di-escape jadi `=20` per spek
//     quoted-printable (`data.replaceAll(" \n", "=20\n")`) — ini SEBENARNYA
//     benar & sesuai standar, dan mail client yang benar akan decode balik
//     `=20` jadi spasi. TAPI (2) algoritma pemotongan baris tiap 74 karakter
//     di fungsi yang sama punya bug lain yang kadang memotong PERSIS di
//     tengah sebuah escape sequence (mis. `=20` kepotong jadi `=2` di ujung
//     baris + `0` di baris berikutnya, atau di tengah byte UTF-8 multi-byte
//     seperti emoji ❄️ yang 4-byte) — soft-linebreak yang harusnya "menyatu"
//     balik saat didekode malah tidak dikenali sebagian mail client
//     (termasuk Gmail web, sesuai laporan owner), sehingga sisa artefak
//     `=20`/potongan escape byte muncul sebagai teks mentah.
//
// FIX: berhenti pakai quoted-printable SAMA SEKALI untuk isi email, ganti ke
// **base64** (dibangun manual lewat `mimeContent`, bypass jalur `text`/
// `html` bawaan denomailer yang HARDCODE quoted-printable, lihat
// `resolveContent()` di atas — tidak ada opsi resmi untuk memilih base64
// lewat `text`/`html` biasa). Base64 TIDAK PERNAH punya masalah spasi-di-
// akhir-baris/baris-kosong (tidak ada konsep "soft line break yang harus
// disambung ulang" di base64 — decoder base64 cukup gabung semua baris jadi
// 1 string lalu decode utuh, tidak peduli di mana barisnya dipotong), jadi
// kelas bug ini hilang total, bukan cuma ditambal untuk kasus `=20` saja —
// termasuk otomatis memperbaiki emoji yang kadang rusak (root cause sama).
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = btoa(binary);
  // Spek MIME (RFC 2045) mewajibkan baris base64 dipotong maks 76 karakter
  // — beberapa mail server/relay tua menolak/memotong baris lebih panjang.
  // Aman dipotong di mana saja (beda dari quoted-printable) karena base64
  // tidak encode per-karakter sumber, jadi tidak ada risiko motong di
  // tengah 1 karakter/emoji.
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}
// ============================================================================

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const gmailAddress = Deno.env.get("GMAIL_ADDRESS");
  const gmailAppPassword = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailAddress || !gmailAppPassword) {
    throw new Error("GMAIL_ADDRESS / GMAIL_APP_PASSWORD belum diset di Edge Function secrets");
  }

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: {
        username: gmailAddress,
        password: gmailAppPassword,
      },
    },
  });

  const plainText = htmlToPlainText(html);

  try {
    await client.send({
      from: gmailAddress,
      to,
      subject,
      // SENGAJA pakai `mimeContent` manual (bukan `content`/`html` biasa) —
      // lihat komentar panjang di atas file ini kenapa `text`/`html` bawaan
      // denomailer tidak bisa dipakai untuk base64 (hardcode ke
      // quoted-printable di `resolveContent()`).
      mimeContent: [
        {
          mimeType: 'text/plain; charset="utf-8"',
          content: utf8ToBase64(plainText),
          transferEncoding: "base64",
        },
        {
          mimeType: 'text/html; charset="utf-8"',
          content: utf8ToBase64(html),
          transferEncoding: "base64",
        },
      ],
    });
  } finally {
    // Tetap tutup koneksi walau send() gagal, supaya tidak ada koneksi SMTP
    // menggantung di worker yang sama.
    await client.close();
  }
}

// ============================================================================
// Helper format HTML email (dipindah ke sini dari `midtrans-webhook/index.ts`
// pada 2026-09-08, TANPA diubah isinya sama sekali — murni supaya bisa dipakai
// bersama oleh `public-checkout` juga, Fitur Pembayaran Cash/migration 0008).
// `midtrans-webhook` diupdate untuk import dari sini, bukan lagi mendefinisikan
// sendiri — perilaku emailnya TIDAK berubah, cuma sumber definisinya dipindah.
// ============================================================================
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID").format(amount);
}

export type OrderItemRow = {
  nama_produk: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
};

export function buildItemsTableHtml(items: OrderItemRow[]): string {
  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(item.nama_produk)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.qty}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp${formatRupiah(item.subtotal)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table style="width:100%;border-collapse:collapse;margin:12px 0;">
      <thead>
        <tr>
          <th style="padding:4px 8px;text-align:left;border-bottom:2px solid #1e3a8a;">Produk</th>
          <th style="padding:4px 8px;text-align:center;border-bottom:2px solid #1e3a8a;">Qty</th>
          <th style="padding:4px 8px;text-align:right;border-bottom:2px solid #1e3a8a;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// `SITE_URL` dipakai untuk bangun link `/order/:order_token` di email —
// dipindah ke sini juga (sama alasan di atas) supaya `public-checkout` tidak
// menduplikasi validasi ini. Return `null` (bukan throw) kalau belum
// diset/format salah, supaya pemanggil bisa memilih cara logging masing-
// masing (pola yang sama seperti sebelumnya di `midtrans-webhook`).
export function getSiteUrlOrNull(): string | null {
  const siteUrl = Deno.env.get("SITE_URL");
  if (!siteUrl || !/^https?:\/\//.test(siteUrl)) return null;
  return siteUrl.replace(/\/+$/, "");
}
