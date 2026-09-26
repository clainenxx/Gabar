import { Spinner } from "./ProcessingOverlayProvider.jsx";

// Loading screen full-page — diminta owner ("loading screen saat memuat
// pesanan"). Dipakai OrderQr.jsx (ganti teks polos "Memuat data
// pesanan..." sebelumnya jadi spinner + teks, konsisten dengan tema
// GABAR), dan boleh dipakai halaman lain yang butuh loading state serupa
// (mis. AdminPage.jsx sudah punya versi teksnya sendiri, tidak diubah di
// sini supaya scope tetap sesuai yang diminta — cuma disediakan
// komponennya, pemasangan di halaman lain menyusul kalau diminta).
//
// SENGAJA TIDAK membungkus <SnowEffect /> sendiri — biar pemanggil yang
// menentukan (banyak halaman publik sudah render <SnowEffect /> di root-nya
// masing-masing, membungkus di sini lagi akan bikin dobel/tumpang tindih).
export default function LoadingScreen({ message = "Memuat..." }) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center text-white">
      <Spinner size={44} />
      <p className="text-sm text-white/80">{message}</p>
    </div>
  );
}
