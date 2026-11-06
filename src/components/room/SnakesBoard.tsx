"use client";

import { useMemo } from "react";
import { teamInfo } from "@/lib/teams";
import type { SnakesState } from "@/lib/snakes";

// ---------- لوحة سلم وثعبان: مربعات مرقمة من أسفل اليسار بشكل متعرج ----------

const S = 40; // حجم المربع
const START_H = 30; // شريط البداية أسفل اللوحة (المربع 0)

const SNAKE_COLORS = ["#16a34a", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#b45309"];

type Pt = [number, number];

function boardShape(size: number) {
  const cols = size === 30 ? 6 : 10;
  return { cols, rows: Math.ceil(size / cols) };
}

/** مركز المربع n (1..size) */
function cellCenter(n: number, cols: number, rows: number): Pt {
  const idx = n - 1;
  const row = Math.floor(idx / cols); // 0 = الصف السفلي
  const inRow = idx % cols;
  const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
  return [col * S + S / 2, (rows - 1 - row) * S + S / 2];
}

export function SnakesBoard({ l }: { l: SnakesState }) {
  const size = l.steps;
  const { cols, rows } = boardShape(size);
  const W = cols * S;
  const H = rows * S;
  const sides = l.sides ?? [];
  const center = (n: number) => cellCenter(n, cols, rows);

  const jumps = useMemo(
    () => Object.entries(l.jumps ?? {}).map(([from, to]) => ({ from: Number(from), to: Number(to) })),
    [l.jumps],
  );
  const ladders = jumps.filter((j) => j.to > j.from);
  const snakes = jumps.filter((j) => j.to < j.from);

  // مكان كل قطعة، مع إزاحة بسيطة إن اجتمعت أكثر من قطعة في نفس المربع
  const piecePoint = (i: number): Pt => {
    const pos = l.pos[i];
    const same = sides.map((_, k) => k).filter((k) => l.pos[k] === pos);
    const k = same.indexOf(i);
    if (pos <= 0) {
      // شريط البداية: القطع صف واحد
      return [S / 2 + i * (S * 0.62), H + START_H / 2];
    }
    const [x, y] = center(Math.min(pos, size));
    if (same.length === 1) return [x, y];
    const a = (2 * Math.PI * k) / same.length;
    return [x + Math.cos(a) * S * 0.2, y + Math.sin(a) * S * 0.2];
  };

  const pieceR = size === 100 ? S * 0.2 : S * 0.24;

  return (
    <div className="mx-auto w-full max-w-[460px] select-none" dir="ltr">
      <svg viewBox={`-4 -4 ${W + 8} ${H + START_H + 8}`} className="w-full drop-shadow-xl">
        <rect x={-4} y={-4} width={W + 8} height={H + START_H + 8} rx={12} fill="#1e1b4b" />

        {/* المربعات */}
        {Array.from({ length: size }, (_, k) => {
          const n = k + 1;
          const [cx, cy] = center(n);
          const last = n === size;
          return (
            <g key={n}>
              <rect
                x={cx - S / 2}
                y={cy - S / 2}
                width={S}
                height={S}
                fill={last ? "#fde68a" : (Math.floor(k / cols) + k) % 2 === 0 ? "#f7f0e3" : "#e9dcc3"}
              />
              <text x={cx - S / 2 + 3} y={cy - S / 2 + 10} fontSize={8.5} fontWeight="bold" fill="#6b5b3e">
                {n}
              </text>
              {last && (
                <text x={cx} y={cy + 8} textAnchor="middle" fontSize={16}>
                  🏁
                </text>
              )}
            </g>
          );
        })}

        {/* شريط البداية */}
        <rect x={0} y={H + 3} width={W} height={START_H - 6} rx={6} fill="#312e81" />
        <text x={W - 6} y={H + START_H / 2 + 4} textAnchor="end" fontSize={10} fill="#c7d2fe" fontWeight="bold">
          🚩 البداية
        </text>

        {/* السلالم */}
        {ladders.map(({ from, to }) => (
          <Ladder key={`l${from}`} a={center(from)} b={center(to)} />
        ))}

        {/* الثعابين */}
        {snakes.map(({ from, to }, k) => (
          <Snake key={`s${from}`} head={center(from)} tail={center(to)} color={SNAKE_COLORS[k % SNAKE_COLORS.length]} />
        ))}

        {/* القطع */}
        {sides.map((s, i) => {
          const [x, y] = piecePoint(i);
          const active = i === l.turn && l.phase !== "done";
          return (
            <g key={i} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 0.8s ease" }}>
              {active && (
                <circle r={pieceR + 4} fill="none" stroke="#fbbf24" strokeWidth={2.5}>
                  <animate
                    attributeName="r"
                    values={`${pieceR + 3};${pieceR + 7};${pieceR + 3}`}
                    dur="1.2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle r={pieceR} fill={teamInfo(s.color).hex} stroke="#fff" strokeWidth={2.5} />
              <circle r={pieceR} fill="none" stroke="#1e1b4b" strokeWidth={1.2} />
              <circle r={pieceR * 0.32} fill="#fff" opacity={0.85} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** سلم: قضيبان جانبيان ودرجات */
function Ladder({ a, b }: { a: Pt; b: Pt }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * S * 0.16; // عمودي على اتجاه السلم
  const ny = (dx / len) * S * 0.16;
  const rungs = Math.max(2, Math.floor(len / (S * 0.38)));
  return (
    <g stroke="#92400e" strokeLinecap="round" opacity={0.92}>
      <line x1={a[0] + nx} y1={a[1] + ny} x2={b[0] + nx} y2={b[1] + ny} strokeWidth={3.2} />
      <line x1={a[0] - nx} y1={a[1] - ny} x2={b[0] - nx} y2={b[1] - ny} strokeWidth={3.2} />
      {Array.from({ length: rungs }, (_, k) => {
        const t = (k + 0.5) / rungs;
        const x = a[0] + dx * t;
        const y = a[1] + dy * t;
        return <line key={k} x1={x + nx} y1={y + ny} x2={x - nx} y2={y - ny} strokeWidth={2.2} stroke="#b45309" />;
      })}
    </g>
  );
}

/** ثعبان متموج من الرأس (أعلى) إلى الذيل */
function Snake({ head, tail, color }: { head: Pt; tail: Pt; color: string }) {
  const dx = tail[0] - head[0];
  const dy = tail[1] - head[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const waves = Math.max(1.5, len / (S * 1.6));
  const amp = S * 0.22;
  const pts: Pt[] = [];
  for (let k = 0; k <= 48; k++) {
    const t = k / 48;
    const off = Math.sin(t * Math.PI * 2 * waves) * amp * Math.sin(t * Math.PI); // ثابت عند الطرفين
    pts.push([head[0] + dx * t + nx * off, head[1] + dy * t + ny * off]);
  }
  const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // اتجاه الرأس لوضع العينين
  const ex = (pts[1][0] - pts[0][0]) / (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1);
  const ey = (pts[1][1] - pts[0][1]) / (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1);
  return (
    <g opacity={0.92}>
      <path d={d} fill="none" stroke="#1e1b4b" strokeWidth={S * 0.24} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={S * 0.17} strokeLinecap="round" strokeLinejoin="round" />
      <path
        d={d}
        fill="none"
        stroke="#fff"
        strokeOpacity={0.35}
        strokeWidth={S * 0.05}
        strokeDasharray="2 5"
        strokeLinecap="round"
      />
      <circle cx={head[0]} cy={head[1]} r={S * 0.17} fill={color} stroke="#1e1b4b" strokeWidth={1.5} />
      {[-1, 1].map((side) => (
        <circle
          key={side}
          cx={head[0] - ex * S * 0.04 + -ey * side * S * 0.07}
          cy={head[1] - ey * S * 0.04 + ex * side * S * 0.07}
          r={S * 0.045}
          fill="#fff"
          stroke="#111"
          strokeWidth={0.8}
        />
      ))}
    </g>
  );
}
