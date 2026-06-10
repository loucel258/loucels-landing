/**
 * Sparkline — tiny inline SVG line chart. No dependency. Server-renderable.
 *
 * Pass a series of numbers; the component normalizes and draws.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill,
  showDots = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  showDots?: boolean;
}) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });
  const path = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaPath = fill
    ? `${path} L ${width} ${height} L 0 ${height} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
    >
      {areaPath && <path d={areaPath} fill={fill} opacity="0.18" />}
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {showDots &&
        points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill={stroke} />
        ))}
    </svg>
  );
}

/**
 * BarStrip — horizontal bar chart, also dependency-free. Useful for cost
 * breakdowns and distributions ("80% of conversations resolved without
 * escalation").
 */
export function BarStrip({
  segments,
  height = 8,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <div className="h-2 rounded-full bg-neutral-100" />;
  }
  return (
    <div className="space-y-2">
      <div
        className="flex w-full overflow-hidden rounded-full bg-neutral-100"
        style={{ height }}
      >
        {segments.map((s, i) => {
          const pct = (s.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={i}
              className={s.color}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-600">
        {segments.map((s, i) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-sm ${s.color}`} aria-hidden />
              <span>{s.label}</span>
              <span className="font-medium tabular-nums text-neutral-800">
                {pct.toFixed(0)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
