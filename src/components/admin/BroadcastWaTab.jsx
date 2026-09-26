import { useCallback, useEffect, useRef, useState } from "react";
import {
  listPendingScanOrders,
  formatOrderItemsSummary,
  sendBroadcastMessage,
} from "../../features/orders/broadcastApi.js";
import {
  getWaBroadcastTemplate,
  setWaBroadcastTemplate,
} from "../../features/settings/settingsApi.js";

// Fitur BARU (diminta owner via chat) — "Broadcast WA Belum Scan": kirim
// notifikasi WA custom ke SEMUA customer yang sudah bayar (cash/online)
// TAPI QR-nya belum discan admin, memberitahu pesanan gabin mereka akan
// segera diantarkan. Admin bisa custom isi pesan lewat beberapa "field"
// (tiap field = 1 chat WA terpisah, dikirim berurutan ke 1 nomor), field
// bisa ditambah/dikurang sendiri dan tersimpan (tabel `settings`, lihat
// settingsApi.js). Sebelum benar-benar kirim ke semua nomor, wajib masukin
// "password" konfirmasi (string tetap, diminta persis begini oleh owner).
//
// Pacing pengiriman (diminta owner persis begini):
// - Tiap field = 1 chat. Sebelum tiap chat terkirim, ada animasi
//   "mengetik..." selama 5 detik (TYPING_DELAY_MS).
// - Setelah SEMUA field/chat untuk 1 nomor selesai, ada jeda 10 detik
//   (GAP_BETWEEN_NUMBERS_MS) sebelum lanjut ke nomor berikutnya.
// - Urutan nomor: yang beli PALING DULUAN dikirim PALING DULU, yang beli
//   PALING TERAKHIR (paling akhir "pending"-nya) dikirim PALING AKHIR —
//   sudah dijamin oleh `listPendingScanOrders()` (order by created_at asc).
//
// Kenapa loop-nya di FRONTEND (bukan whatsapp-service `/send-batch` Modul
// 15b): supaya progress + animasi "mengetik" per pesan bisa ditampilkan
// LIVE di layar admin, sinkron persis dengan pesan yang sungguhan
// terkirim (`/send-batch` cuma balas cepat lalu proses di background,
// tidak ada cara admin panel tahu pesan ke berapa yang sedang berjalan).
const TYPING_DELAY_MS = 5000;
const GAP_BETWEEN_NUMBERS_MS = 10000;

// String password konfirmasi — SENGAJA persis seperti diminta owner
// (mirip perintah CLI Linux), bukan validasi keamanan sungguhan (endpoint
// pengirim sungguhan, wa-broadcast-notify, tetap wajib admin login — lihat
// Edge Function-nya). Ini murni "jeda sadar" sebelum broadcast ke banyak
// customer sekaligus supaya tidak kepencet tidak sengaja.
const CONFIRM_PASSWORD = "sudo apt udpate notification all";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Duplikasi sengaja dari `normalizeIndonesianPhoneLocal` di
// PengaturanTab.jsx (lihat komentar di sana kenapa tidak di-import dari
// `_shared/whatsapp.ts` — file itu Deno-only) — `orders.no_telp` diisi
// bebas oleh customer saat checkout (08xx/+62xx/62xx), sedangkan Edge
// Function `wa-broadcast-notify` mewajibkan format 62xxxxxxxxxx persis
// seperti whatsapp-service.
function normalizeIndonesianPhoneLocal(raw) {
  const cleaned = String(raw ?? "").trim().replace(/[^\d+]/g, "");
  let n = cleaned.replace(/^\+/, "");
  if (n.startsWith("0")) {
    n = "62" + n.slice(1);
  } else if (n.startsWith("8")) {
    n = "62" + n;
  }
  if (!/^62\d{8,13}$/.test(n)) return null;
  return n;
}

function fillTemplate(field, order) {
  return field
    .replaceAll("{nama}", order.nama_customer || "-")
    .replaceAll("{pesanan}", formatOrderItemsSummary(order));
}

const STATUS_LABEL = {
  waiting: "Menunggu",
  typing: "Mengetik...",
  sent: "Terkirim",
  failed: "Gagal",
  skipped: "Dilewati",
};

export default function BroadcastWaTab() {
  const [fields, setFields] = useState([]);
  const [savedFields, setSavedFields] = useState([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState(null);
  const [templateSuccess, setTemplateSuccess] = useState(false);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(null);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(null);

  const [sending, setSending] = useState(false);
  // progress: { [orderId]: { fieldIndex, status, error? } }
  const [progress, setProgress] = useState({});
  const cancelRef = useRef(false);

  const loadTemplate = useCallback(async () => {
    setTemplateError(null);
    try {
      const stored = await getWaBroadcastTemplate();
      setFields(stored);
      setSavedFields(stored);
    } catch (err) {
      setTemplateError(err.message || "Gagal memuat template pesan");
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersError(null);
    try {
      const data = await listPendingScanOrders();
      setOrders(data);
    } catch (err) {
      setOrdersError(err.message || "Gagal memuat daftar pesanan");
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplate();
    loadOrders();
  }, [loadTemplate, loadOrders]);

  function handleFieldChange(index, value) {
    setFields((prev) => prev.map((f, i) => (i === index ? value : f)));
    setTemplateSuccess(false);
  }

  function handleAddField() {
    setFields((prev) => [...prev, ""]);
    setTemplateSuccess(false);
  }

  function handleRemoveField(index) {
    setFields((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [""];
    });
    setTemplateSuccess(false);
  }

  async function handleSaveTemplate() {
    setTemplateError(null);
    setTemplateSuccess(false);
    setTemplateSaving(true);
    try {
      const stored = await setWaBroadcastTemplate(fields);
      setFields(stored);
      setSavedFields(stored);
      setTemplateSuccess(true);
    } catch (err) {
      setTemplateError(err.message || "Gagal menyimpan template pesan");
    } finally {
      setTemplateSaving(false);
    }
  }

  const templateIsDirty = JSON.stringify(fields) !== JSON.stringify(savedFields);

  function openPasswordModal() {
    setPasswordInput("");
    setPasswordError(null);
    setShowPasswordModal(true);
  }

  function handleConfirmPassword() {
    if (passwordInput !== CONFIRM_PASSWORD) {
      setPasswordError("Password salah — broadcast dibatalkan.");
      return;
    }
    setShowPasswordModal(false);
    runBroadcast();
  }

  async function runBroadcast() {
    const activeFields = fields.map((f) => f.trim()).filter(Boolean);
    if (!activeFields.length || !orders.length) return;

    cancelRef.current = false;
    setSending(true);
    const initialProgress = {};
    for (const order of orders) {
      initialProgress[order.id] = { fieldIndex: -1, status: "waiting" };
    }
    setProgress(initialProgress);

    for (let orderIdx = 0; orderIdx < orders.length; orderIdx++) {
      if (cancelRef.current) break;
      const order = orders[orderIdx];
      const phone = normalizeIndonesianPhoneLocal(order.no_telp);

      if (!phone) {
        setProgress((prev) => ({
          ...prev,
          [order.id]: { fieldIndex: -1, status: "skipped", error: "Format nomor tidak dikenali" },
        }));
        continue;
      }

      let orderFailed = false;
      for (let fieldIdx = 0; fieldIdx < activeFields.length; fieldIdx++) {
        if (cancelRef.current) break;

        // Animasi "mengetik..." selama TYPING_DELAY_MS SEBELUM pesan
        // sungguhan dikirim — ditampilkan dulu di UI, baru setelah delay
        // selesai pesan benar-benar dikirim ke whatsapp-service.
        setProgress((prev) => ({
          ...prev,
          [order.id]: { fieldIndex: fieldIdx, status: "typing" },
        }));
        await sleep(TYPING_DELAY_MS);
        if (cancelRef.current) break;

        const text = fillTemplate(activeFields[fieldIdx], order);
        try {
          await sendBroadcastMessage(phone, text);
        } catch (err) {
          orderFailed = true;
          setProgress((prev) => ({
            ...prev,
            [order.id]: { fieldIndex: fieldIdx, status: "failed", error: err.message },
          }));
          // 1 nomor gagal tidak menghentikan broadcast ke nomor lain
          // (best-effort, sama filosofi dengan whatsapp-service) — lanjut
          // ke field berikutnya DIHENTIKAN untuk nomor ini (kalau field 1
          // gagal, field 2/3 tidak relevan dikirim), tapi nomor
          // berikutnya tetap dicoba.
          break;
        }
      }

      if (!orderFailed && !cancelRef.current) {
        setProgress((prev) => ({
          ...prev,
          [order.id]: { fieldIndex: activeFields.length - 1, status: "sent" },
        }));
      }

      // Jeda 10 detik sebelum lanjut ke nomor berikutnya — dilewati kalau
      // ini nomor terakhir atau broadcast dibatalkan.
      if (orderIdx < orders.length - 1 && !cancelRef.current) {
        await sleep(GAP_BETWEEN_NUMBERS_MS);
      }
    }

    setSending(false);
  }

  function handleCancel() {
    cancelRef.current = true;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Template Pesan Broadcast</h2>
        <p className="text-sm text-white/70">
          Tiap field di bawah = 1 chat WA terpisah, dikirim berurutan ke customer yang
          sama (jeda "mengetik..." 5 detik tiap chat). Bisa pakai{" "}
          <code className="bg-white/10 rounded px-1">{"{nama}"}</code> dan{" "}
          <code className="bg-white/10 rounded px-1">{"{pesanan}"}</code> — otomatis
          diganti nama customer & ringkasan produk yang dia beli.
        </p>

        {templateLoading ? (
          <p className="text-sm text-white/70">Memuat template...</p>
        ) : (
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={index} className="flex gap-2">
                <span className="pt-2 text-xs text-white/50 w-14 shrink-0">
                  Field {index + 1}
                </span>
                <textarea
                  value={field}
                  onChange={(e) => handleFieldChange(index, e.target.value)}
                  rows={2}
                  placeholder="mis. Pesanan kamu ({pesanan}) akan segera diantarkan siang ini"
                  className="flex-1 rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveField(index)}
                  className="self-start rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm hover:bg-white/20"
                  aria-label={`Hapus field ${index + 1}`}
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={handleAddField}
            className="rounded-lg bg-white/10 border border-white/30 px-4 py-2 text-sm hover:bg-white/20"
          >
            + Tambah field
          </button>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={templateSaving || !templateIsDirty}
            className="rounded-lg bg-white/20 border border-white/30 px-4 py-2 text-sm hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {templateSaving ? "Menyimpan..." : "Simpan Template"}
          </button>
          {templateError && <p className="text-sm text-red-200">{templateError}</p>}
          {templateSuccess && !templateError && (
            <p className="text-sm text-emerald-200">Template tersimpan.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Customer Belum Discan ({orders.length})
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadOrders}
              disabled={ordersLoading || sending}
              className="rounded-lg bg-white/10 border border-white/30 px-4 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
            >
              Muat Ulang
            </button>
            {sending ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg bg-red-500/30 border border-red-300/40 px-4 py-2 text-sm hover:bg-red-500/40"
              >
                Batalkan Broadcast
              </button>
            ) : (
              <button
                type="button"
                onClick={openPasswordModal}
                disabled={ordersLoading || !orders.length}
                className="rounded-lg bg-white text-[#0b2447] px-4 py-2 text-sm font-medium hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Kirim Semua
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-white/60">
          Diurutkan dari yang beli PALING DULUAN (dikirim paling awal) sampai yang beli
          paling terakhir (dikirim paling akhir). Jeda 10 detik antar nomor.
        </p>

        {ordersError && <p className="text-sm text-red-200">{ordersError}</p>}

        {ordersLoading ? (
          <p className="text-sm text-white/70">Memuat daftar pesanan...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-white/70">
            Tidak ada pesanan yang sudah dibayar tapi belum discan saat ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/60 border-b border-white/10">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">No. Telp</th>
                  <th className="py-2 pr-3">Pesanan</th>
                  <th className="py-2 pr-3">Metode</th>
                  <th className="py-2 pr-3">Status Kirim</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => {
                  const p = progress[order.id];
                  return (
                    <tr key={order.id} className="border-b border-white/5">
                      <td className="py-2 pr-3">{idx + 1}</td>
                      <td className="py-2 pr-3">{order.nama_customer}</td>
                      <td className="py-2 pr-3">{order.no_telp}</td>
                      <td className="py-2 pr-3">{formatOrderItemsSummary(order)}</td>
                      <td className="py-2 pr-3 capitalize">{order.payment_method}</td>
                      <td className="py-2 pr-3">
                        {!p ? (
                          <span className="text-white/50">-</span>
                        ) : p.status === "typing" ? (
                          <span className="text-amber-200">
                            Mengetik chat {p.fieldIndex + 1}
                            <span className="animate-pulse">...</span>
                          </span>
                        ) : p.status === "sent" ? (
                          <span className="text-emerald-200">Semua chat terkirim</span>
                        ) : p.status === "failed" ? (
                          <span className="text-red-200" title={p.error}>
                            Gagal (chat {p.fieldIndex + 1}): {p.error}
                          </span>
                        ) : p.status === "skipped" ? (
                          <span className="text-red-200" title={p.error}>
                            Dilewati: {p.error}
                          </span>
                        ) : (
                          <span className="text-white/60">{STATUS_LABEL[p.status]}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowPasswordModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#0b2447] border border-white/20 p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Konfirmasi Broadcast</h3>
            <p className="text-sm text-white/70">
              Ini akan mengirim {fields.filter((f) => f.trim()).length} chat WA ke{" "}
              {orders.length} nomor customer. Masukkan password konfirmasi untuk lanjut.
            </p>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmPassword()}
              autoFocus
              placeholder="Password konfirmasi"
              className="w-full rounded-lg bg-white/10 border border-white/30 px-3 py-2 text-sm placeholder:text-white/50"
            />
            {passwordError && <p className="text-sm text-red-200">{passwordError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="rounded-lg bg-white/10 border border-white/30 px-4 py-2 text-sm hover:bg-white/20"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmPassword}
                className="rounded-lg bg-white text-[#0b2447] px-4 py-2 text-sm font-medium hover:bg-white/90"
              >
                Kirim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
