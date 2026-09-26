-- Modul 15e — Antrian retry notifikasi WhatsApp (`wa_outbox`).
--
-- Latar belakang: sebelum migration ini, kalau `whatsapp-service` (hosting
-- Node.js terpisah, lihat `whatsapp-service/`) sedang down saat ada order
-- baru, `sendWhatsAppBatch()` (`_shared/whatsapp.ts`) gagal, error-nya cuma
-- di-log lalu DIBUANG (best-effort) — notifikasi itu hilang permanen, tidak
-- pernah dicoba lagi walau service-nya hidup lagi beberapa menit kemudian.
--
-- Dengan tabel ini, setiap batch WA yang gagal terkirim (karena service down/
-- unreachable) disimpan di sini dengan status 'pending', supaya bisa di-
-- proses ulang. Yang memproses ulang BUKAN cron/polling terjadwal (boros
-- egress & query buat skala 1 toko) — tapi `whatsapp-service/server.js`
-- sendiri, yang menyedot baris 'pending' dari tabel ini TEPAT SAAT koneksi
-- WA-nya balik `open` (lihat `flushPendingOutbox()` di situ). Jadi baris di
-- tabel ini cuma pernah dibaca kalau memang ada yang perlu di-retry — tidak
-- ada query berkala yang jalan terus-menerus selama service normal.
--
-- Order boleh null (`on delete set null`) — outbox tetap berguna buat audit/
-- retry meski order aslinya sudah dihapus/diarsipkan.
create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  phone text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Index utama yang dipakai `flushPendingOutbox()`: ambil status='pending'
-- terurut dari yang paling lama dulu (FIFO, pesan customer index 0 tetap
-- diusahakan terkirim duluan karena di-insert duluan per batch).
create index if not exists wa_outbox_pending_idx
  on public.wa_outbox (created_at)
  where status = 'pending';

-- RLS diaktifkan TANPA policy apapun (default deny total) — tabel ini
-- SENGAJA cuma boleh diakses lewat `service_role` key (yang otomatis bypass
-- RLS), dipakai dari 2 tempat: Edge Function (insert saat gagal kirim) dan
-- `whatsapp-service` (select + update saat flush). Tidak ada jalur publik/
-- anon yang butuh baca tabel ini sama sekali (pola sama dengan
-- `payment_transactions`, ARCHITECTURE.md §5).
alter table public.wa_outbox enable row level security;

comment on table public.wa_outbox is
  'Antrian retry notifikasi WhatsApp yang gagal terkirim (service down/dll). '
  'Diproses ulang oleh whatsapp-service saat koneksi WA reconnect, bukan oleh cron. '
  'Modul 15e.';
