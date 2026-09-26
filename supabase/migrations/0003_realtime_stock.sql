-- Modul 6: Realtime Stok Produk (ARCHITECTURE.md §6)
--
-- Tabel `products` + kolom `stock` sudah ada sejak Modul 2
-- (0002_schema_and_rls.sql) — migration ini HANYA menambah:
-- 1. `products` ke publication `supabase_realtime` (supaya Postgres Changes
--    ke-broadcast ke client, dipakai `subscribeProductStock` di
--    `src/lib/realtime.js`, sudah discaffold sejak Modul 0/5).
-- 2. RPC `update_product_stock` (admin, dipanggil dari tab "Produk" /admin
--    untuk penyesuaian stok cepat tanpa buka form edit penuh) — sebagai
--    lapisan tambahan di atas RLS "products_update_admin" yang sudah ada,
--    supaya validasi (stok tidak boleh negatif, dsb) konsisten di 1 tempat
--    walau nanti dipanggil dari beberapa UI berbeda.
-- 3. RPC `decrement_product_stock`/`restore_product_stock` (SECURITY
--    DEFINER, HANYA untuk service role) — scaffolding untuk dipakai
--    Edge Function `public-checkout` (Modul 7) & `midtrans-webhook`
--    pembatalan (Modul 8). BELUM dipanggil dari kode manapun di Modul 6
--    ini (checkout online belum ada) — ditulis sekarang sesuai
--    ARCHITECTURE.md §6 Modul 6 supaya skema stok selesai sekaligus,
--    tidak perlu migration terpisah lagi nanti pas Modul 7/8. Fungsi ini
--    TIDAK diberi izin EXECUTE ke `anon`/`authenticated` (cuma bisa
--    dipanggil pakai service role key dari Edge Function), jadi aman
--    ditulis dari sekarang meski belum dipakai.

-- ============================================================================
-- 1. Realtime publication
-- ============================================================================
-- `supabase_realtime` adalah publication bawaan Supabase untuk Postgres
-- Changes. Idempotent: skip kalau tabel sudah pernah ditambahkan
-- (mis. migration ini dijalankan ulang).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;

-- ============================================================================
-- 2. RPC: update_product_stock (admin)
-- ============================================================================
-- SECURITY INVOKER (default) — cukup mengandalkan RLS "products_update_admin"
-- yang sudah ada (bukan bypass RLS seperti SECURITY DEFINER), jadi hanya
-- lapisan validasi tambahan di atas RLS, bukan pengganti RLS.
create or replace function public.update_product_stock(p_product_id uuid, p_new_stock int)
returns public.products
language plpgsql
as $$
declare
  v_row public.products;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Hanya admin yang boleh mengubah stok produk';
  end if;

  if p_new_stock < 0 then
    raise exception 'Stok tidak boleh negatif';
  end if;

  update public.products
  set stock = p_new_stock
  where id = p_product_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Produk tidak ditemukan';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_product_stock(uuid, int) from public;
grant execute on function public.update_product_stock(uuid, int) to authenticated;

-- ============================================================================
-- 3. RPC: decrement_product_stock / restore_product_stock (service role only)
-- ============================================================================
-- SECURITY DEFINER supaya bisa jalan meski dipanggil dari Edge Function
-- dengan service role (yang bypass RLS by default, tapi fungsi ini juga
-- perlu atomic check-and-decrement yang tidak bisa murni dari RLS biasa).
-- Guard "stok tidak boleh minus" ada di WHERE clause (atomic, aman dari
-- race condition 2 checkout bersamaan) bukan cek-lalu-update terpisah.
create or replace function public.decrement_product_stock(p_product_id uuid, p_qty int)
returns public.products
security definer
set search_path = public
language plpgsql
as $$
declare
  v_row public.products;
begin
  if p_qty <= 0 then
    raise exception 'Qty harus lebih dari 0';
  end if;

  update public.products
  set stock = stock - p_qty
  where id = p_product_id
    and stock >= p_qty
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Stok tidak mencukupi untuk produk %', p_product_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.restore_product_stock(p_product_id uuid, p_qty int)
returns public.products
security definer
set search_path = public
language plpgsql
as $$
declare
  v_row public.products;
begin
  if p_qty <= 0 then
    raise exception 'Qty harus lebih dari 0';
  end if;

  update public.products
  set stock = stock + p_qty
  where id = p_product_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Produk tidak ditemukan';
  end if;

  return v_row;
end;
$$;

-- Sengaja TIDAK grant execute ke anon/authenticated — kedua fungsi ini
-- cuma boleh dipanggil dari Edge Function pakai service role key
-- (`public-checkout` Modul 7, `midtrans-webhook` pembatalan Modul 8).
revoke all on function public.decrement_product_stock(uuid, int) from public;
revoke all on function public.restore_product_stock(uuid, int) from public;

-- ============================================================================
-- Checklist testing manual DoD Modul 6 (ARCHITECTURE.md §6):
-- 1. Buka `/` di 2 tab browser berbeda. Login admin di tab lain, ubah stok
--    produk (lewat tombol +/- cepat atau form edit) -> kedua tab `/` harus
--    update angka/label "Stok Habis" tanpa reload, dalam <1 detik.
-- 2. Set stok produk ke 0 lewat admin -> tab publik yang sedang terbuka
--    otomatis menampilkan "Stok Habis" tanpa reload.
-- 3. Coba panggil `update_product_stock` pakai anon key (bukan admin) ->
--    harus ditolak ("Hanya admin yang boleh...").
-- 4. Coba `update_product_stock` dengan `p_new_stock` negatif -> ditolak.
-- 5. `decrement_product_stock`/`restore_product_stock` BELUM bisa ditest
--    end-to-end sampai Modul 7 (checkout) memanggilnya — untuk sekarang
--    cukup pastikan migration jalan tanpa error dan fungsi ini tidak bisa
--    dipanggil pakai anon/authenticated key (harus "permission denied").
-- ============================================================================
