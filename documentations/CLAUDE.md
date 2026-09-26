# CLAUDE.md

> Proyek ini memakai **`AGENTS.md`** sebagai sumber utama instruksi kerja untuk AI coding agent (struktur folder, coding style, larangan, referensi dokumen). **Baca `AGENTS.md` dulu** — file ini hanya berisi tambahan yang spesifik untuk Claude/Claude Code, supaya tidak ada duplikasi yang bisa "kadaluarsa" saat salah satu file diupdate tapi yang lain lupa diupdate.

## Tambahan Khusus Claude Code

1. **Urutan baca dokumen di awal sesi baru**: `PRD.md` → `ARCHITECTURE.md` → `AGENTS.md` → `TODO.md` (untuk tahu progres terakhir & changelog terbaru) → baru mulai kerja sesuai `WORKFLOW.md`. Kalau ketemu rujukan "AyamKu §X"/"seperti proyek asal" yang konteksnya tidak jelas dari kalimat sekitarnya, baca `AYAMKU_REFERENCE.md` — **jangan minta user upload ulang project/zip AyamKu** kecuali rangkuman di file itu ternyata tidak cukup untuk detail spesifik yang dibutuhkan.
2. **Gunakan skill lokal (`/mnt/skills`) yang relevan** setiap kali membuat file dokumen (docx/pdf) atau bekerja dengan file upload — output proyek ini sendiri kode & markdown, jadi skill dokumen biasanya tidak dipakai kecuali diminta laporan dalam format Word/PDF.
3. **Sebelum menandai modul selesai di `TODO.md`**, jalankan checklist Definition of Done dari `ARCHITECTURE.md` §6 untuk modul terkait — jangan tandai selesai hanya karena kode sudah ditulis, tapi karena kriteria selesainya terpenuhi.
4. **Kalau ragu antara "jalan sendiri" atau "tanya user"**, ikuti aturan di `WORKFLOW.md` §Kapan Harus Minta Izin — defaultnya untuk hal yang menyentuh uang/keamanan/skema database/tema visual utama, selalu konfirmasi dulu.
5. **Aturan changelog wajib** (spesifik proyek GAGI, lihat `WORKFLOW.md` §5 & `TODO.md`): sebelum menyerahkan file hasil perubahan apapun ke owner dalam satu giliran kerja, tambahkan dulu baris baru di `TODO.md` bagian "Perubahan Terbaru" yang menjelaskan apa yang diubah, kenapa, file apa saja yang tersentuh, dan status testing-nya (sudah/belum ditest live). Ini berlaku untuk perubahan sekecil apapun — bug fix CSS pun tetap dicatat.
6. **Kerjakan bertahap**: jangan langsung menulis seluruh modul (§6 `ARCHITECTURE.md`) sekaligus dalam satu giliran kerja kalau owner memintanya bertahap. Selesaikan 1 modul, laporkan ringkas (apa yang selesai, DoD apa yang terpenuhi, modul berikutnya apa), baru lanjut kalau owner konfirmasi lanjut.
7. File ini boleh berisi hampir apa saja tambahan spesifik AI selama tetap bisa dipahami manusia lain (developer non-AI) yang baca project ini — kalau tidak, taruh di `AGENTS.md` saja supaya konsisten.
