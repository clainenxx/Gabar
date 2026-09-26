const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// Chart batang ringan tanpa dependency eksternal (proyek ini sengaja tidak
// pakai library chart — lihat package.json) — cukup SVG murni + viewBox
// responsif, konsisten dengan pola ikon inline lain di codebase (mis.
// PesananTab.jsx). Dipakai DashboardTab.jsx untuk tren revenue 7 hari
// terakhir.
export default function RevenueBarChart({ data }) {
  const width = 560;
  const height = 200;
  const paddingLeft = 8;
  const paddingRight = 8;
  const paddingTop = 28;
  const paddingBottom = 28;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const barSlot = chartWidth / data.length;
  const barWidth = Math.min(40, barSlot * 0.5);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Grafik revenue dibagi 7 segmen mengikuti rentang filter"
    >
      <defs>
        <linearGradient id="revenueBarGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe0ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#5aa0e0" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* Garis dasar */}
      <line
        x1={paddingLeft}
        y1={height - paddingBottom}
        x2={width - paddingRight}
        y2={height - paddingBottom}
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1"
      />

      {data.map((d, i) => {
        const barHeight = maxValue > 0 ? (d.value / maxValue) * chartHeight : 0;
        const x = paddingLeft + i * barSlot + (barSlot - barWidth) / 2;
        const y = height - paddingBottom - barHeight;
        return (
          <g key={d.label + i}>
            {d.value > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 8}
                textAnchor="middle"
                fontSize="9.5"
                fill="rgba(255,255,255,0.75)"
              >
                {d.value >= 1000000
                  ? `${(d.value / 1000000).toFixed(1)}jt`
                  : d.value >= 1000
                    ? `${Math.round(d.value / 1000)}rb`
                    : d.value}
              </text>
            )}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, d.value > 0 ? 3 : 0)}
              rx={6}
              fill="url(#revenueBarGradient)"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1"
              className="transition-all duration-500 ease-out"
            >
              <title>{`${d.label}: ${currencyFormatter.format(d.value)}`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={height - paddingBottom + 16}
              textAnchor="middle"
              fontSize="10.5"
              fill="rgba(255,255,255,0.8)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
