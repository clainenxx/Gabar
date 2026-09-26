import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

// Halaman internal (bukan bagian PRD) untuk bantu cek Definition of Done
// Modul 0: "semua service bisa Hello World konek". Cuma Supabase yang bisa
// dicek langsung dari browser dengan aman (anon key). R2/Midtrans/Gmail
// pakai secret key yang HARUS di Edge Function, jadi dicek lewat
// `scripts/test-connections.mjs` (Node, jalan di server) — lihat README.
export default function SetupCheck() {
  const [status, setStatus] = useState("Mengecek koneksi Supabase...");
  const [ok, setOk] = useState(null);

  useEffect(() => {
    async function check() {
      const envMissing =
        !import.meta.env.VITE_SUPABASE_URL ||
        !import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (envMissing) {
        setOk(false);
        setStatus(
          "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi di .env — isi dulu (lihat .env.example).",
        );
        return;
      }
      // Query paling ringan: hitung baris di tabel categories.
      // Kalau tabel belum ada (Modul 2 belum jalan), error-nya tetap
      // membuktikan koneksi ke project Supabase-nya sudah nyambung.
      const { error } = await supabase
        .from("categories")
        .select("*", { count: "exact", head: true });

      if (error && error.code !== "42P01") {
        // 42P01 = relation tidak ada, artinya konek OK tapi migration belum jalan.
        setOk(false);
        setStatus(`Gagal konek Supabase: ${error.message}`);
        return;
      }
      setOk(true);
      setStatus(
        error?.code === "42P01"
          ? "Konek ke project Supabase berhasil (tabel `categories` belum dibuat — wajar, itu Modul 2)."
          : "Konek ke project Supabase berhasil.",
      );
    }
    check();
  }, []);

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1>Cek Setup Modul 0</h1>
      <p style={{ color: ok === false ? "crimson" : ok === true ? "green" : undefined }}>
        {status}
      </p>
      <p>
        Untuk cek R2, Midtrans sandbox, dan Gmail SMTP (butuh secret key,
        tidak aman dicek dari browser), jalankan:
      </p>
      <pre style={{ background: "#f4f3ec", padding: 12, borderRadius: 8 }}>
        node scripts/test-connections.mjs
      </pre>
    </div>
  );
}
