import { useScrollReveal } from "../../hooks/useScrollReveal.js";

// Wrapper tipis supaya section/blok cukup dibungkus <Reveal> untuk dapat
// animasi fade+slide-up saat masuk viewport (lihat useScrollReveal.js &
// class `.reveal` / `.reveal-visible` di index.css). Satu observer per
// blok besar (bukan per kartu produk) supaya tetap ringan.
export default function Reveal({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = useScrollReveal();
  return (
    <Tag ref={ref} className={`reveal ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
