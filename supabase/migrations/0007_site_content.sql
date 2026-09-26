-- ============================================================================
-- Konten Halaman Publik (bisa diedit dari admin) — penyempurnaan pasca-Modul 5/12
--
-- Teks-teks di landing page publik (hero, judul section Produk, section
-- "Tentang GABAR", footer) tadinya hardcode di komponen React. Supaya admin
-- bisa mengubahnya tanpa deploy ulang, disimpan sebagai SATU baris JSON di
-- tabel baru `site_content` (bukan ditumpuk ke tabel `settings` yang sudah
-- ada, karena `settings` sengaja admin-only/tidak boleh dibaca publik —
-- lihat 0002_schema_and_rls.sql. Konten halaman publik sebaliknya MEMANG
-- harus bisa dibaca publik, makanya dipisah tabel dengan RLS select terbuka).
--
-- Pola "single row" (id selalu 1, dijaga lewat CHECK) supaya query dari
-- publik/admin sederhana: selalu `select ... where id = 1` / upsert id 1,
-- tidak perlu tabel key-value dengan banyak baris untuk kasus ini karena
-- semua field memang selalu tampil bareng di satu render halaman.
-- ============================================================================

create table if not exists public.site_content (
  id smallint primary key default 1 check (id = 1),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger trg_site_content_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

-- Konten halaman publik memang harus terbaca oleh siapa saja (anon
-- termasuk), sama seperti kategori/produk aktif/banner aktif.
create policy "site_content_select_all"
  on public.site_content for select
  using (true);

-- Hanya admin yang boleh insert/update (baris seed di bawah pakai
-- `security definer`-free insert biasa saat migration, jadi tidak kena RLS).
create policy "site_content_insert_admin"
  on public.site_content for insert
  with check (public.current_user_role() = 'admin');

create policy "site_content_update_admin"
  on public.site_content for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Seed baris default (id=1) supaya frontend publik selalu dapat baris valid
-- sejak awal, isinya persis teks yang sebelumnya hardcode di komponen React
-- (Home.jsx hero/produk header, AboutSection.jsx, Footer.jsx) — jadi kalau
-- admin belum pernah mengubah apa pun, tampilan publik tidak berubah sama
-- sekali dibanding sebelum modul ini ada.
insert into public.site_content (id, content)
values (
  1,
  jsonb_build_object(
    'hero', jsonb_build_object(
      'badge', 'Khusus lingkungan sekolah',
      'title', 'Jajan Gabin, Pesan Online, Diantar ke Kelasmu',
      'subtitle', 'GABAR (Gabin Ice Bar) — pesan menu favoritmu lewat HP, bayar online, dan kami antar langsung ke lokasimu. Tanpa antre, tanpa ribet.',
      'cta1', 'Lihat Produk',
      'cta2', 'Tentang Kami'
    ),
    'produk', jsonb_build_object(
      'title', 'Produk Kami',
      'subtitle', 'Pilih menu, atur jumlah, lalu masukkan ke keranjang.'
    ),
    'about', jsonb_build_object(
      'title', 'Tentang GABAR',
      'desc', 'GABAR (Gabin Ice Bar) adalah usaha jajanan berbahan gabin yang bisa kamu pesan online, khusus untuk lingkungan sekolah. Tanpa meja kasir, tanpa antre — pilih menu favoritmu, checkout, dan kami antar langsung ke lokasimu di sekolah.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Pesan Online', 'desc', 'Pilih menu, atur jumlah, dan checkout langsung dari HP — tidak perlu chat manual lagi.'),
        jsonb_build_object('title', 'Tanpa Antre di Kasir', 'desc', 'Semua transaksi online, jadi kamu tidak perlu antre ke meja kasir sama sekali.'),
        jsonb_build_object('title', 'Diantar ke Lokasimu', 'desc', 'Cukup isi lokasi (misalnya kelasmu) saat checkout — pesanan kami antar langsung ke sana.')
      )
    ),
    'footer', jsonb_build_object(
      'brand', 'GABAR',
      'tagline', 'Gabin Ice Bar — jajanan berbahan gabin, pesan online, diantar langsung ke lokasimu di sekolah.',
      'cara', jsonb_build_array(
        '1. Pilih menu & masukkan ke keranjang',
        '2. Isi lokasi pengantaran (mis. kelasmu)',
        '3. Bayar, lalu tunggu diantar ke lokasimu'
      )
    )
  )
)
on conflict (id) do nothing;
