import type { Share } from "@/lib/licensing-types";

// Small SVG charts for the partner portal, drawn from real numbers.

export function LineChart({ points, labels, color = "#e3182d", label = "Sales by day" }: { points: number[]; labels: string[]; color?: string; label?: string }) {
  const W = 600, H = 180, max = Math.max(1, ...points);
  const xy = points.map((v, i) => [points.length > 1 ? (i * W) / (points.length - 1) : W / 2, H - 14 - (v / max) * (H - 34)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <div className="pc-line">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs><linearGradient id={`pcg${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#26262e" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {xy.length > 1 && <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#pcg${color.slice(1)})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="pc-x">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

const DONUT = ["#2bb3a3", "#e3182d", "#d4a23a", "#8b7cf6", "#8e8e99"];
export function Donut({ parts }: { parts: Share[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  let at = 0;
  const R = 62, C = 2 * Math.PI * R;
  return (
    <div className="pc-donut">
      <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Sales by channel">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#1b1b21" strokeWidth="24" />
        {total > 0 && parts.map((p, i) => {
          const len = (p.value / total) * C;
          const el = <circle key={p.name} cx="80" cy="80" r={R} fill="none" stroke={DONUT[i % DONUT.length]} strokeWidth="24" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-at} transform="rotate(-90 80 80)" />;
          at += len;
          return el;
        })}
      </svg>
      <ul>
        {parts.length ? parts.map((p, i) => <li key={p.name}><i style={{ background: DONUT[i % DONUT.length] }} />{p.name} {p.pct}%</li>) : <li>No sales yet</li>}
      </ul>
    </div>
  );
}

export function Bars({ rows, color, format }: { rows: Share[]; color: string; format: (s: Share) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="pt-empty">No sales in this period yet.</p>;
  return (
    <div className="pc-bars">
      {rows.map((r) => (
        <div key={r.name} className="pc-bar">
          <span title={r.name}>{r.name}</span>
          <i><b style={{ width: `${(r.value / max) * 100}%`, background: color }} /></i>
          <em>{format(r)}</em>
        </div>
      ))}
    </div>
  );
}

export function Columns({ values, from, labels }: { values: number[]; from: number; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="pc-cols">
      <div role="img" aria-label="Units sold by hour on premiere nights">
        {values.map((v, i) => <span key={i} title={`${String((from + i) % 24).padStart(2, "0")}:00 · ${v} units`} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />)}
      </div>
      <div className="pc-x">{labels.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
