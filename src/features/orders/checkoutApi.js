import { supabase } from "../../lib/supabaseClient.js";

// supabase-js TIDAK mengisi `data` untuk respons non-2xx — pesan error dari
// server (mis. "Terlalu banyak pesanan dari nomor ini") ada di body
// `error.context` (objek Response), sedangkan `error.message`-nya cuma
// "Edge Function returned a non-2xx status code". Fungsi ini mengambil pesan
// aslinya supaya customer melihat alasan yang jelas, bukan pesan generik.
async function extractFunctionError(error, fallback) {
  try {
    const res = error?.context;
    if (res && typeof res.json === "function") {
      const body = await res.json();
      if (body?.error) return body.error;
    }
  } catch {
    // body bukan JSON / sudah terbaca — pakai pesan bawaan di bawah.
  }
  return error?.message || fallback;
}

// Panggilan ke Edge Function `public-checkout` (anon, Modul 7 —
// ARCHITECTURE.md §6). Harga/stok/total TIDAK dihitung di sini — semua
// dihitung ulang server-side dari tabel `products` (AGENTS.md §4), request
// ini cuma kirim data mentah form + daftar { product_id, qty } dari cart.
//
// Response sukses: { order_token, payment_method, snap_token, redirect_url,
// adjusted_notes }. `adjusted_notes` berisi pesan kalau ada item yang
// jumlahnya disesuaikan ke stok tersisa atau dilewati karena tidak tersedia
// lagi (PRD.md §4.1). Untuk `paymentMethod: "cash"` (Fitur Pembayaran Cash,
// migration 0008), `snap_token`/`redirect_url` akan bernilai `null` — order
// sudah langsung `paid`, tidak ada popup Midtrans yang perlu dibuka.
//
// `turnstileToken` (2026-09-19): token Cloudflare Turnstile dari widget di
// form checkout — wajib, diverifikasi server-side di `public-checkout`.
export async function submitCheckout({
  namaCustomer,
  noTelp,
  email,
  lokasi1,
  lokasi2,
  items,
  paymentMethod = "online",
  turnstileToken,
}) {
  const { data, error } = await supabase.functions.invoke("public-checkout", {
    body: {
      nama_customer: namaCustomer,
      no_telp: noTelp,
      email,
      lokasi_1: lokasi1,
      lokasi_2: lokasi2 || undefined,
      items: items.map((it) => ({ product_id: it.productId, qty: it.qty })),
      payment_method: paymentMethod,
      turnstile_token: turnstileToken,
    },
  });

  if (error) {
    throw new Error(await extractFunctionError(error, "Gagal menghubungi layanan checkout"));
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

// Panggilan ke Edge Function `get-order` (anon, Modul 7). Lookup by
// `order_token` lewat SERVICE ROLE di server — bukan RLS publik, karena
// `orders` sengaja tidak punya policy SELECT untuk anon (ARCHITECTURE.md
// §5.1). Dipakai halaman `/order/:order_token` (OrderQr.jsx).
export async function getOrder(orderToken) {
  const { data, error } = await supabase.functions.invoke("get-order", {
    body: { order_token: orderToken },
  });

  if (error) {
    throw new Error(error.message || "Gagal memuat data pesanan");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

// Panggilan ke Edge Function `resume-payment` (anon, Modul 7b — ditambahkan
// 2026-09-08). Dipakai tombol "Lanjutkan Pembayaran" di halaman QR waktu
// order masih `pending`. Minta Snap token BARU untuk transaksi Midtrans
// yang SAMA (lihat komentar lengkap di `resume-payment/index.ts` soal
// idempotency Midtrans) — bukan bikin order baru, jadi item/harga tidak
// berubah dari transaksi asli.
//
// Response sukses: { snap_token, redirect_url }.
// Kalau order ternyata sudah bukan `pending` lagi (race — mis. baru saja
// dibayar dari device lain), error dilempar dengan pesan jelas dari server
// (lihat `STATUS_MESSAGES` di function) supaya UI bisa tampilkan apa
// adanya, bukan pesan generik.
export async function resumePayment(orderToken) {
  const { data, error } = await supabase.functions.invoke("resume-payment", {
    body: { order_token: orderToken },
  });

  if (error) {
    throw new Error(error.message || "Gagal melanjutkan pembayaran");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}
