import { useId } from "react";

// Input upload gambar bergaya "kotak" (bukan cuma teks "Choose file" bawaan
// browser) — dipakai di ProductForm.jsx & BannerForm.jsx. Input file asli
// disembunyikan (className="hidden") dan dipicu lewat <label htmlFor>,
// supaya seluruh kotak bisa diklik, bukan cuma tulisan kecilnya.
export default function ImageDropInput({
  label,
  hint,
  imagePreview,
  onFileChange,
  previewClassName = "h-24 w-24",
  previewFit = "cover",
}) {
  const inputId = useId();

  return (
    <div>
      {label && <label className="block text-sm mb-1">{label}</label>}
      <div className="flex flex-wrap items-start gap-3">
        <label
          htmlFor={inputId}
          className="group flex w-full max-w-xs cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-white/30 bg-white/5 px-4 py-5 text-center transition-colors hover:border-white/50 hover:bg-white/10"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-7 w-7 text-white/60 transition-colors group-hover:text-white/90"
          >
            <path
              d="M12 16V4M12 4L7 9M12 4l5 5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-medium">
            {imagePreview ? "Ganti gambar" : "Klik untuk upload gambar"}
          </span>
          <span className="text-xs text-white/50">
            PNG / JPG, maks 5MB — otomatis dikompres sebelum diupload
          </span>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="hidden"
          />
        </label>

        {imagePreview && (
          <img
            src={imagePreview}
            alt="Pratinjau"
            className={`${previewClassName} rounded-lg ${
              previewFit === "contain" ? "object-contain bg-white/10" : "object-cover"
            } border border-white/30`}
          />
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-white/70">{hint}</p>}
    </div>
  );
}
