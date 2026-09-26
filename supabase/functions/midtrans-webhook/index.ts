// Edge Function: midtrans-webhook — notifikasi status pembayaran Midtrans
// Snap (ARCHITECTURE.md §5.2, §6).
//
// Scope Modul 7: transaksi sukses (`capture` + fraud_status `accept`, atau
// `settlement`) -> `orders.status = 'paid'`. Payment TIDAK PERNAH dipercaya
// dari client — status `paid` hanya boleh berubah dari sini, SETELAH
// signature key Midtrans terverifikasi (AGENTS.md §4).
//
// Scope Modul 8 (Security Hardening: Pembatalan Order & Restore Stok):
// `deny`/`cancel`/`expire` -> `orders.status = 'cancelled'` + kembalikan
// stok tiap `order_items` lewat RPC `restore_product_stock` (dipanggil per
// item, bukan sekali borong, supaya 1 item gagal restore tidak menggagalkan
// item lain — dicatat jelas di log kalau ada yang gagal, ARCHITECTURE.md §6
// Modul 8). Guard `.eq('status','pending')` (sama pola dengan jalur `paid`
// di atas) membuat proses ini idempotent — notifikasi `expire`/`cancel`
// duplikat dari Midtrans tidak akan restore stok dua kali, karena guard
// akan gagal cocok (order sudah `cancelled`, bukan `pending` lagi) begitu
// notifikasi pertama selesai diproses (pelajaran AyamKu Modul 18 temuan #2,
// AYAMKU_REFERENCE.md §3/§4 — diterapkan dari awal, bukan temuan belakangan).
//
// Modul 9 (Email Notification — Gmail SMTP): begitu order berhasil ditandai
// `paid` OLEH REQUEST INI (bukan notifikasi duplikat), kirim 2 email lewat
// `_shared/email.ts` (`sendEmail()`, sudah discaffold sejak Modul 0): (1) ke
// customer — link `/order/:order_token`; (2) ke `settings.notification_email`
// kalau sudah diisi admin (Modul 12, belum dibuat) — isinya lokasi_1/lokasi_2
// biar jelas ke mana pesanan harus diantar. Kedua email dikirim best-effort:
// dibungkus try/catch masing-masing supaya kalau Gmail SMTP gagal/lambat,
// response ke Midtrans tetap 200 tepat waktu (Midtrans retry kalau tidak
// dibalas cepat) — kegagalan kirim email dicatat jelas ke log, TIDAK
// menggagalkan proses update status order yang sudah terjadi sebelumnya.
//
// Notifikasi dengan `transaction_status` lain (mis. `pending`/`deny` yang
// belum final) tetap dibalas 200 (supaya Midtrans tidak retry terus-menerus)
// dan tetap dicatat ke `payment_transactions` untuk audit, cuma tidak
// mengubah status order.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { verifySignature } from "../_shared/midtrans.ts";
import {
  sendEmail,
  escapeHtml,
  formatRupiah,
  buildItemsTableHtml,
  getSiteUrlOrNull,
  type OrderItemRow,
} from "../_shared/email.ts";
import {
  sendWhatsAppBatch,
  buildCustomerOrderCard,
  buildCustomerWhatsAppFallback,
  buildAdminWhatsAppMessage,
  type WhatsAppBatchItem,
} from "../_shared/whatsapp.ts";

// Catatan 2026-09-08 (Fitur Pembayaran Cash, migration 0008): 4 helper di
// atas (`escapeHtml`/`formatRupiah`/`buildItemsTableHtml`/`OrderItemRow`)
// SEBELUMNYA didefinisikan langsung di file ini, sekarang dipindah ke
// `_shared/email.ts` TANPA diubah isinya sama sekali — supaya bisa dipakai
// bareng oleh `public-checkout` (perlu kirim email juga untuk order cash,
// yang tidak pernah lewat webhook ini sama sekali karena tidak ada transaksi
// Midtrans). Perilaku email di file INI tidak berubah sedikit pun.

// Dipanggil HANYA setelah update status `paid` dipastikan benar-benar
// terjadi di request ini (guard idempotent, sama pola dengan restore stok
// Modul 8) — supaya notifikasi Midtrans yang duplikat tidak mengirim email
// dobel ke customer/admin.
async function sendPaidOrderEmails(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { data: order, error: orderFetchError } = await supabase
    .from("orders")
    .select(
      "order_token, nama_customer, no_telp, email, lokasi_1, lokasi_2, total, order_items(nama_produk, qty, harga_satuan, subtotal)",
    )
    .eq("id", orderId)
    .single();

  if (orderFetchError || !order) {
    console.error(
      "[midtrans-webhook] order sudah paid tapi gagal ambil detail untuk email:",
      orderFetchError,
    );
    return;
  }

  // Sama pola dengan lesson Bug/Isu #5 (`_shared/r2.ts`) — env var URL wajib
  // berawalan skema, kalau tidak browser/email client bisa salah interpretasi
  // jadi path relatif. Kalau belum diset sama sekali, email dilewati dengan
  // log jelas (bukan diam-diam kirim link rusak) — owner perlu set secret
  // `SITE_URL` (mis. `https://gagi.contoh.com`, domain hasil Modul 14 nanti).
  const siteUrl = getSiteUrlOrNull();
  if (!siteUrl) {
    console.error(
      "[midtrans-webhook] SITE_URL belum diset / tidak berawalan http(s):// — email order (customer & admin) dilewati untuk order",
      orderId,
      "- set secret SITE_URL dulu (Edge Function Secrets), lalu email akan otomatis terkirim untuk order berikutnya.",
    );
    return;
  }

  const orderLink = `${siteUrl}/order/${order.order_token}`;
  const itemsHtml = buildItemsTableHtml((order.order_items ?? []) as OrderItemRow[]);
  const totalFormatted = formatRupiah(order.total);

  // Email ke customer — link ke halaman QR + status pesanan.
  try {
    await sendEmail({
      to: order.email,
      subject: "Pembayaran GABAR Kamu Sudah Diterima ✅",
      html: `
        <div style="font-family:sans-serif;color:#1e293b;">
          <p>Halo ${escapeHtml(order.nama_customer)},</p>
          <p>Pembayaran pesanan GABAR (Gabin Ice Bar) kamu sudah kami terima. Berikut ringkasannya:</p>
          ${itemsHtml}
          <p><strong>Total: Rp${totalFormatted}</strong></p>
          <p>Lihat status pesanan &amp; QR pengambilan lewat link berikut (QR berlaku 1×seminggu sejak pesanan dibuat):</p>
          <p><a href="${orderLink}" style="color:#1e3a8a;">${orderLink}</a></p>
          <p>Terima kasih sudah pesan di GABAR! ❄️</p>
        </div>`,
    });
  } catch (err) {
    console.error("[midtrans-webhook] gagal kirim email konfirmasi ke customer, order", orderId, err);
  }

  // Notifikasi WhatsApp ke customer + admin (Modul 9b + Modul 15b) — nomor
  // ke-2, service Baileys terpisah, lihat `_shared/whatsapp.ts` &
  // `whatsapp-service/README.md`. Pelengkap email di atas, BUKAN
  // pengganti (email tetap dikirim seperti biasa terlepas dari WA
  // sukses/gagal). SATU batch (`sendWhatsAppBatch`) berisi pesan customer
  // DI INDEKS 0 (harus terkirim duluan, sesuai permintaan eksplisit
  // owner) diikuti pesan ke tiap nomor admin dari
  // `settings.whatsapp_admin_numbers` (Modul 15a) — service Node.js yang
  // memprosesnya berurutan dengan jeda "mengetik..." di background
  // (`sendWhatsAppBatch()`, opsi (b) yang dikonfirmasi owner 2026-09-15),
  // jadi panggilan ini balas cepat & TIDAK menunggu semua pesan terkirim.
  // Dibungkus try/catch TERPISAH dari email — kegagalan (mis. service WA
  // down/belum dikonfigurasi) TIDAK menghalangi email atau response 200
  // ke Midtrans.
  try {
    // Pesan customer = KARTU GAMBAR (ringkasan + QR ke `orderLink`), TANPA
    // link di teks. `message` cuma cadangan (juga tanpa link) yang dikirim
    // whatsapp-service kalau pembuatan gambar gagal.
    const waMessages: WhatsAppBatchItem[] = [
      {
        phone: order.no_telp,
        message: buildCustomerWhatsAppFallback({
          namaCustomer: order.nama_customer,
          statusLine: "Pembayaran kamu sudah kami terima ✅",
          items: (order.order_items ?? []) as OrderItemRow[],
          total: order.total,
        }),
        card: buildCustomerOrderCard({
          namaCustomer: order.nama_customer,
          items: (order.order_items ?? []) as OrderItemRow[],
          total: order.total,
          orderToken: order.order_token,
          orderLink,
          // Teks di bawah gambar (tanpa link). Sebelumnya kosong sehingga
          // customer online hanya menerima gambar polos.
          caption:
            `Halo ${order.nama_customer}, pembayaran kamu sudah kami terima ✅\n\n` +
            "Scan QR pada gambar ini untuk membuka halaman pesananmu di website GABAR. " +
            "Tunjukkan QR yang ada di website ke admin saat pesananmu diantar ya. " +
            "QR berlaku 1×seminggu sejak pesanan dibuat.",
        }),
      },
    ];

    const { data: waAdminRow, error: waAdminError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "whatsapp_admin_numbers")
      .maybeSingle();

    if (waAdminError) {
      console.error(
        "[midtrans-webhook] gagal ambil settings.whatsapp_admin_numbers, order",
        orderId,
        waAdminError,
      );
    } else if (waAdminRow?.value) {
      // Sama pola parsing best-effort dengan `getWhatsAppAdminNumbers()`
      // di `settingsApi.js` (frontend) — value rusak/bukan JSON array
      // dianggap tidak ada nomor admin, bukan menggagalkan WA ke customer.
      let adminNumbers: string[] = [];
      try {
        const parsed = JSON.parse(waAdminRow.value);
        adminNumbers = Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string" && n) : [];
      } catch {
        console.error(
          "[midtrans-webhook] settings.whatsapp_admin_numbers bukan JSON array valid, order",
          orderId,
        );
      }

      const adminMessage = buildAdminWhatsAppMessage({
        namaCustomer: order.nama_customer,
        noTelp: order.no_telp,
        email: order.email,
        lokasi1: order.lokasi_1,
        lokasi2: order.lokasi_2,
        statusLine: "Ada pesanan baru yang sudah dibayar di GABAR.",
        items: (order.order_items ?? []) as OrderItemRow[],
        total: order.total,
      });

      for (const phone of adminNumbers) {
        waMessages.push({ phone, message: adminMessage });
      }
    }

    // `opts.supabase` + `opts.orderId` (Modul 15e) — kalau whatsapp-service
    // sedang down, batch ini otomatis disimpan ke `wa_outbox` di dalam
    // `sendWhatsAppBatch()` sebelum error-nya dilempar ke sini, jadi tidak
    // hilang begitu saja (akan di-retry otomatis, lihat
    // `whatsapp-service/server.js`).
    await sendWhatsAppBatch(waMessages, { supabase, orderId });
  } catch (err) {
    console.error(
      "[midtrans-webhook] gagal kirim notifikasi WhatsApp (customer/admin), order",
      orderId,
      err,
    );
  }

  // Email notifikasi ke admin — cuma kalau `settings.notification_email`
  // sudah diisi (form-nya sendiri baru dibuat di Modul 12, belum ada — untuk
  // sekarang admin isi manual lewat SQL Editor / dashboard Supabase kalau
  // mau fitur ini aktif sebelum Modul 12 selesai).
  try {
    const { data: settingRow, error: settingError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "notification_email")
      .maybeSingle();

    if (settingError) {
      console.error(
        "[midtrans-webhook] gagal ambil settings.notification_email, order",
        orderId,
        settingError,
      );
    } else if (settingRow?.value) {
      await sendEmail({
        to: settingRow.value,
        subject: `Pesanan Baru Dibayar — ${order.nama_customer}`,
        html: `
          <div style="font-family:sans-serif;color:#1e293b;">
            <p>Ada pesanan baru yang sudah dibayar di GABAR.</p>
            <p>
              <strong>Nama:</strong> ${escapeHtml(order.nama_customer)}<br />
              <strong>No. Telp:</strong> ${escapeHtml(order.no_telp)}<br />
              <strong>Email:</strong> ${escapeHtml(order.email)}<br />
              <strong>Lokasi 1 (wajib):</strong> ${escapeHtml(order.lokasi_1)}<br />
              <strong>Lokasi 2 (opsional):</strong> ${order.lokasi_2 ? escapeHtml(order.lokasi_2) : "-"}
            </p>
            ${itemsHtml}
            <p><strong>Total: Rp${totalFormatted}</strong></p>
            <p>Detail &amp; QR verifikasi: <a href="${orderLink}" style="color:#1e3a8a;">${orderLink}</a></p>
          </div>`,
      });
    } else {
      console.log(
        "[midtrans-webhook] settings.notification_email belum diisi admin — email notifikasi admin dilewati untuk order",
        orderId,
        "(fitur pengisian alamat ini scope Modul 12, belum dibuat).",
      );
    }
  } catch (err) {
    console.error("[midtrans-webhook] gagal kirim email notifikasi ke admin, order", orderId, err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body: {
    order_id?: string;
    status_code?: string;
    gross_amount?: string;
    signature_key?: string;
    transaction_status?: string;
    fraud_status?: string;
    transaction_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Body request tidak valid (harus JSON)" });
  }

  const {
    order_id,
    status_code,
    gross_amount,
    signature_key,
    transaction_status,
    fraud_status,
    transaction_id,
  } = body;

  if (!order_id || !status_code || !gross_amount || !signature_key || !transaction_status) {
    return jsonResponse(400, { error: "Payload notifikasi tidak lengkap" });
  }

  // Verifikasi signature key DULU sebelum menyentuh DB apapun — kalau tidak
  // valid, kemungkinan request palsu, tolak mentah-mentah (ARCHITECTURE.md §5.2).
  let signatureValid: boolean;
  try {
    signatureValid = await verifySignature({
      orderId: order_id,
      statusCode: status_code,
      grossAmount: gross_amount,
      signatureKey: signature_key,
    });
  } catch (err) {
    console.error("[midtrans-webhook] gagal verifikasi signature:", err);
    return jsonResponse(500, { error: "Gagal memverifikasi notifikasi" });
  }
  if (!signatureValid) {
    console.warn("[midtrans-webhook] signature tidak valid untuk order_id:", order_id);
    return jsonResponse(403, { error: "Signature tidak valid" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", order_id)
    .single();

  if (orderError || !order) {
    console.error("[midtrans-webhook] order tidak ditemukan untuk order_id:", order_id);
    // Tetap balas 200 — order_id yang tidak dikenal bukan sesuatu yang bisa
    // "berhasil" kalau Midtrans retry terus, jadi tidak perlu diulang.
    return jsonResponse(200, { received: true });
  }

  // Audit trail — SEMUA notifikasi dicatat apapun status transaksinya
  // (payment_transactions hanya ditulis dari sini, ARCHITECTURE.md §3).
  const { error: paymentInsertError } = await supabase.from("payment_transactions").insert({
    order_id: order.id,
    midtrans_transaction_id: transaction_id ?? null,
    status: transaction_status,
    raw_payload: body,
  });
  if (paymentInsertError) {
    console.error("[midtrans-webhook] gagal simpan payment_transactions:", paymentInsertError);
  }

  const isPaidStatus =
    transaction_status === "settlement" ||
    (transaction_status === "capture" && fraud_status === "accept");

  if (isPaidStatus) {
    // Guard `.eq("status", "pending")` supaya idempotent — notifikasi
    // duplikat dari Midtrans (sering terjadi) tidak mengubah apapun kalau
    // order sudah `paid` sebelumnya. Pola ini diterapkan sejak awal di
    // sini (bukan ditunggu sampai jadi temuan review terpisah seperti
    // AyamKu Modul 18 temuan #2 — lihat AYAMKU_REFERENCE.md §3).
    //
    // `.select("id")` ditambahkan di Modul 9 (pola sama dengan restore stok
    // Modul 8) supaya kita tahu PASTI request ini yang berhasil mengubah
    // baris — bukan asumsi dari absennya error — dan email HANYA dikirim
    // sekali untuk transisi paid yang sebenarnya, bukan tiap notifikasi
    // duplikat yang sering dikirim ulang oleh Midtrans.
    const { data: paidRows, error: updateError } = await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("id");

    if (updateError) {
      console.error("[midtrans-webhook] gagal update status order jadi paid:", updateError);
      return jsonResponse(500, { error: "Gagal update status order" });
    }

    if (paidRows && paidRows.length > 0) {
      // Modul 9 — Email Notification. Best-effort: kegagalan email tidak
      // boleh menggagalkan response 200 ke Midtrans (lihat komentar di
      // `sendPaidOrderEmails`).
      await sendPaidOrderEmails(supabase, order.id);
    }
  }

  // Modul 8 — Security Hardening: Pembatalan Order & Restore Stok.
  const isCancelledStatus =
    transaction_status === "deny" ||
    transaction_status === "cancel" ||
    transaction_status === "expire";

  if (isCancelledStatus) {
    // `.select("id")` dipakai supaya kita tahu PASTI baris ini yang
    // berhasil ter-update oleh REQUEST INI (bukan asumsi dari absennya
    // error) — kalau hasilnya array kosong, berarti order sudah bukan
    // `pending` lagi (mis. notifikasi `expire` duplikat yang datang
    // setelah notifikasi pertama selesai diproses, atau order sudah
    // keburu `paid`), jadi restore stok DILEWATI supaya tidak dobel.
    const { data: cancelledRows, error: cancelError } = await supabase
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("id");

    if (cancelError) {
      console.error("[midtrans-webhook] gagal update status order jadi cancelled:", cancelError);
      return jsonResponse(500, { error: "Gagal update status order" });
    }

    if (cancelledRows && cancelledRows.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("product_id, qty")
        .eq("order_id", order.id);

      if (itemsError) {
        console.error(
          "[midtrans-webhook] order berhasil di-cancel tapi gagal ambil order_items untuk restore stok:",
          itemsError,
        );
      } else {
        // Restore per item (bukan sekali borong) supaya kalau 1 produk
        // gagal direstore (mis. race langka), produk lain di order yang
        // sama tetap ikut direstore — dicatat jelas di log, bukan
        // menggagalkan seluruh proses restore.
        for (const item of items ?? []) {
          // `product_id` bisa null kalau produknya sudah dihapus admin
          // (order_items.product_id "on delete set null", ARCHITECTURE.md
          // §3) — tidak ada baris products untuk direstore, dilewati.
          if (!item.product_id) continue;
          const { error: restoreError } = await supabase.rpc("restore_product_stock", {
            p_product_id: item.product_id,
            p_qty: item.qty,
          });
          if (restoreError) {
            console.error(
              "[midtrans-webhook] gagal restore stok untuk produk",
              item.product_id,
              "order",
              order.id,
              restoreError,
            );
          }
        }
      }
    }
  }

  return jsonResponse(200, { received: true });
});
