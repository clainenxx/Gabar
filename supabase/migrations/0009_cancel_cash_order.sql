-- ============================================================================
-- Migration 0009: Pembatalan Manual Order Cash (Admin)
--
-- Latar belakang: Fitur Pembayaran Cash (migration 0008) membuat order cash
-- LANGSUNG `paid` tanpa pernah melalui Midtrans — konsekuensinya, jalur
-- otomatis "expire/cancel -> restore stok" yang sudah ada di
-- `midtrans-webhook` (Modul 8) TIDAK PERNAH terpanggil untuk order cash,
-- karena memang tidak ada transaksi Midtrans sama sekali. Ini dicatat
-- sebagai Open Question di `ARCHITECTURE.md` §7 setelah Modul 7d selesai,
-- dan dikonfirmasi owner (2026-09-14, via chat) untuk dikerjakan sebagai
-- tahap lanjutan: tombol "Batalkan" manual di tab Pesanan admin, khusus
-- untuk order `payment_method = 'cash'` yang ternyata tidak jadi
-- diantar/diambil.
--
-- Pola RPC ini SENGAJA meniru `verify_order_pickup` (migration 0004) —
-- tabel `orders` tetap TIDAK PERNAH diberi policy UPDATE untuk client
-- manapun (0002_schema_and_rls.sql, ARCHITECTURE.md §5 poin 1 & 3), jadi
-- mutasi status `paid` -> `cancelled` untuk order cash WAJIB lewat RPC
-- SECURITY DEFINER ini, dipanggil dari tab "Pesanan" admin
-- (`src/components/admin/PesananTab.jsx`) via
-- `src/features/orders/ordersApi.js`, pakai anon key sebagai admin yang
-- login (role `authenticated`, `current_user_role() = 'admin'` dicek di
-- dalam fungsi — sama seperti `verify_order_pickup`/`update_product_stock`).
--
-- Batasan yang SENGAJA diterapkan (supaya tombol ini tidak disalahgunakan
-- untuk order online, yang punya jalur pembatalan otomatisnya sendiri lewat
-- Midtrans/webhook):
--   - HANYA order dengan `payment_method = 'cash'` yang bisa dibatalkan
--     lewat RPC ini. Order `online` ditolak dengan pesan jelas —
--     pembatalannya tetap harus lewat Midtrans (expire/cancel di sisi
--     mereka) supaya status Midtrans & `orders` tidak pernah tidak-sinkron.
--   - HANYA order berstatus `paid` yang bisa dibatalkan (order yang sudah
--     `completed` — artinya sudah diverifikasi/diserahterimakan, TIDAK
--     boleh dibatalkan lagi lewat sini; order yang sudah `cancelled`
--     ditolak juga, bukan operasi yang idempotent diam-diam).
--   - Begitu berhasil dibatalkan, stok SEMUA item di order itu di-restore
--     lewat `restore_product_stock` (RPC yang sama dipakai
--     `midtrans-webhook` untuk expire/cancel order online, migration 0003)
--     — per-item, best-effort (1 item gagal tidak menggagalkan item lain
--     di order yang sama), SAMA POLA dengan Modul 8.
--
-- SQLSTATE custom: berbeda dari `verify_order_pickup` yang masih pakai
-- format lama `P0002`/`P0003`/`P0004` (PostgREST cuma memetakan `P0001`
-- PERSIS ke HTTP 400, jadi `P0002` dst. SEBENARNYA balas HTTP 500 walau ini
-- penolakan bisnis biasa — bug independen yang sudah didiagnosis di
-- Bug/Isu #6, `TODO.md`, rekomendasi fix belum dieksekusi di sana). Supaya
-- RPC BARU ini tidak mewarisi bug yang sama, dipakai format `PTxxx` yang
-- direkomendasikan di situ (PostgREST membaca 3 digit setelah `PT` sebagai
-- kode HTTP literal):
--   PT404 -> order tidak ditemukan
--   PT422 -> order bukan `payment_method = 'cash'` (bukan order cash)
--   PT409 -> order sudah `completed`/`cancelled` (tidak bisa dibatalkan lagi)
--   (default/tanpa errcode khusus, mis. race condition di guard atomic)
--   -> P0001 bawaan `raise exception`, tetap otomatis jadi HTTP 400.
-- ============================================================================

create or replace function public.cancel_cash_order(p_order_id uuid)
returns public.orders
security definer
set search_path = public
language plpgsql
as $$
declare
  v_row public.orders;
  v_item record;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Hanya admin yang boleh membatalkan pesanan';
  end if;

  select * into v_row from public.orders where id = p_order_id;

  if v_row.id is null then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'PT404';
  end if;

  if v_row.payment_method <> 'cash' then
    raise exception 'Pesanan ini bukan pesanan cash — order online dibatalkan otomatis lewat Midtrans (expire/cancel), bukan lewat tombol ini'
      using errcode = 'PT422';
  end if;

  if v_row.status = 'completed' then
    raise exception 'Pesanan ini sudah selesai diverifikasi/diserahterimakan, tidak bisa dibatalkan lagi'
      using errcode = 'PT409';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'Pesanan ini sudah dibatalkan sebelumnya' using errcode = 'PT409';
  end if;

  if v_row.status <> 'paid' then
    -- Seharusnya tidak pernah terjadi untuk order cash (selalu langsung
    -- `paid` sejak dibuat, migration 0008) — dijaga saja untuk kasus tak
    -- terduga di masa depan.
    raise exception 'Status pesanan cash ini tidak valid untuk dibatalkan: %', v_row.status
      using errcode = 'PT422';
  end if;

  -- Guard atomic `.eq('status','paid')` di WHERE (bukan cek-lalu-update
  -- terpisah) — mencegah race condition kalau order ini KEBETULAN sedang
  -- diverifikasi (scan QR, `verify_order_pickup`) nyaris bersamaan dengan
  -- admin lain menekan "Batalkan". Cuma salah satu yang akan berhasil.
  update public.orders
  set status = 'cancelled'
  where id = v_row.id
    and status = 'paid'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Gagal membatalkan — status pesanan berubah saat diproses, muat ulang & coba lagi';
  end if;

  -- Restore stok semua item di order ini — per-item, best-effort, POLA
  -- SAMA PERSIS dengan jalur expire/cancel order online di
  -- `midtrans-webhook` (Modul 8): kalau 1 produk gagal direstore (mis.
  -- produk sudah dihapus admin), produk lain di order yang sama tetap
  -- ikut direstore, tidak menggagalkan pembatalan order itu sendiri.
  for v_item in
    select product_id, qty from public.order_items where order_id = v_row.id
  loop
    if v_item.product_id is not null then
      begin
        perform public.restore_product_stock(v_item.product_id, v_item.qty);
      exception when others then
        raise notice 'Gagal restore stok produk % pada order % (dibatalkan tetap lanjut): %',
          v_item.product_id, v_row.id, sqlerrm;
      end;
    end if;
  end loop;

  return v_row;
end;
$$;

revoke all on function public.cancel_cash_order(uuid) from public;
grant execute on function public.cancel_cash_order(uuid) to authenticated;

-- ============================================================================
-- Checklist testing manual:
-- 1. Buat 1 order CASH sampai `paid` (checkout sungguhan pilih "Bayar
--    Cash"), catat stok produk yang dipesan SETELAH checkout (sudah
--    berkurang). Buka tab "Pesanan" admin -> tombol "Batalkan" harus
--    muncul HANYA di baris order cash yang masih `paid` (tidak muncul di
--    order online, atau order cash yang statusnya sudah `completed`).
-- 2. Klik "Batalkan" -> konfirmasi -> order berubah jadi status
--    "Dibatalkan", DAN stok produk yang dipesan tadi KEMBALI ke angka
--    semula (cek tab "Produk" atau langsung ke tabel `products`).
-- 3. Coba klik "Batalkan" lagi untuk order yang sama (mis. refresh dulu,
--    tombolnya harusnya sudah hilang karena status sudah `cancelled` --
--    tapi coba panggil RPC-nya langsung juga) -> harus ditolak jelas
--    "sudah dibatalkan sebelumnya" (PT409), stok TIDAK direstore dua kali.
-- 4. Buat order cash lain sampai `paid`, verifikasi/scan QR-nya dulu di tab
--    "Scan QR Verifikasi" sampai `completed`, BARU coba panggil
--    `cancel_cash_order` untuk order itu (lewat tombol kalau masih
--    kelihatan sesaat, atau langsung RPC) -> harus ditolak "sudah selesai
--    diverifikasi..." (PT409).
-- 5. Coba panggil `cancel_cash_order` untuk order ONLINE (payment_method
--    'online') yang masih `paid` -> harus ditolak "bukan pesanan cash..."
--    (PT422) — pastikan tidak ada tombol "Batalkan" yang muncul untuk
--    order online di UI sama sekali.
-- 6. Panggil `cancel_cash_order` pakai anon key TANPA login admin -> harus
--    ditolak "Hanya admin...".
-- ============================================================================
