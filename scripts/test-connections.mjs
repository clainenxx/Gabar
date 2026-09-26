// Modul 0 — Setup Project: script "Hello World" untuk 4 service eksternal.
// Dijalankan manual oleh owner/dev di komputer sendiri (BUKAN di browser),
// karena butuh secret key yang tidak boleh bocor ke frontend
// (ARCHITECTURE.md §5.9). Isi dulu file .env di root project (contoh di
// .env.example), baru jalankan:
//
//   node scripts/test-connections.mjs
//
// DoD Modul 0 (ARCHITECTURE.md §6): semua 4 baris di bawah harus "OK".

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";

const results = [];

function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name} — ${detail}`);
}

// 1. Supabase — pakai service role key, cukup panggil admin API ringan.
async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    report("Supabase", false, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi di .env");
    return;
  }
  try {
    const supabase = createClient(url, key);
    const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
    if (error) throw error;
    report("Supabase", true, "berhasil konek & panggil admin API");
  } catch (err) {
    report("Supabase", false, err.message);
  }
}

// 2. Cloudflare R2 (S3-compatible) — coba list isi bucket.
async function checkR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    report("Cloudflare R2", false, "R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME belum lengkap di .env");
    return;
  }
  try {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    report("Cloudflare R2", true, "berhasil konek & list bucket");
  } catch (err) {
    report("Cloudflare R2", false, err.message);
  }
}

// 3. Midtrans Sandbox — coba buat 1 transaksi Snap dummy nominal kecil.
async function checkMidtrans() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    report("Midtrans Sandbox", false, "MIDTRANS_SERVER_KEY belum diisi di .env");
    return;
  }
  try {
    const auth = Buffer.from(`${serverKey}:`).toString("base64");
    const res = await fetch("https://app.sandbox.midtrans.com/snap/v1/transactions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: `setup-check-${Date.now()}`,
          gross_amount: 10000,
        },
      }),
    });
    const body = await res.json();
    if (res.ok && body.token) {
      report("Midtrans Sandbox", true, "berhasil buat Snap token dummy");
    } else {
      report("Midtrans Sandbox", false, JSON.stringify(body));
    }
  } catch (err) {
    report("Midtrans Sandbox", false, err.message);
  }
}

// 4. Gmail SMTP + App Password (via nodemailer, pola sama denomailer di Edge Function).
async function checkGmailSmtp() {
  const user = process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    report("Gmail SMTP", false, "GMAIL_ADDRESS / GMAIL_APP_PASSWORD belum diisi di .env");
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transporter.verify();
    report("Gmail SMTP", true, "berhasil login SMTP");
  } catch (err) {
    report("Gmail SMTP", false, err.message);
  }
}

await checkSupabase();
await checkR2();
await checkMidtrans();
await checkGmailSmtp();

const allOk = results.every((r) => r.ok);
console.log(
  allOk
    ? "\nSemua service OK — DoD Modul 0 terpenuhi."
    : "\nMasih ada yang gagal — lengkapi .env sesuai .env.example lalu jalankan ulang.",
);
process.exit(allOk ? 0 : 1);
