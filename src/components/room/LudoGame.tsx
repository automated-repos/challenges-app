"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import type { LudoState, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
type Cell = [number, number]; // [عمود، صف] في شبكة 15×15

// ---------- هندسة اللوحة (يجب أن تطابق 0014_ludo.sql) ----------

// المسار المشترك: 52 مربعاً تبدأ من نقطة انطلاق الأحمر وتدور مع عقارب الساعة.
// نقاط البداية: الأحمر 0، الأخضر 13، الأصفر 26، الأزرق 39
const TRACK: Cell[] = [
  ...range(1, 5).map((x) => [x, 6] as Cell),
  ...range(5, 0, -1).map((y) => [6, y] as Cell),
  [7, 0],
  [8, 0],
  ...range(1, 5).map((y) => [8, y] as Cell),
  ...range(9, 14).map((x) => [x, 6] as Cell),
  [14, 7],
  [14, 8],
  ...range(13, 9, -1).map((x) => [x, 8] as Cell),
  ...range(9, 14).map((y) => [8, y] as Cell),
  [7, 14],
  [6, 14],
  ...range(13, 9, -1).map((y) => [6, y] as Cell),
  ...range(5, 0, -1).map((x) => [x, 8] as Cell),
  [0, 7],
  [0, 6],
];

// ممرات النهاية (المواقع 51..55) لكل لون
const HOME_LANE: Cell[][] = [
  range(1, 5).map((x) => [x, 7] as Cell),
  range(1, 5).map((y) => [7, y] as Cell),
  range(13, 9, -1).map((x) => [x, 7] as Cell),
  range(13, 9, -1).map((y) => [7, y] as Cell),
];

// زاوية البيت لكل لون (أعلى يسار المربع 6×6)
const YARD: Cell[] = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];

// مكان القطع بعد الوصول (حول المركز)
const FINISH: [number, number][] = [
  [6.5, 7.5],
  [7.5, 6.5],
  [8.5, 7.5],
  [7.5, 8.5],
];

const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

const COLORS = [
  { name: "الأحمر", fill: "#ef4444", light: "#fecaca", dark: "#991b1b" },
  { name: "الأخضر", fill: "#22c55e", light: "#bbf7d0", dark: "#166534" },
  { name: "الأصفر", fill: "#eab308", light: "#fef08a", dark: "#854d0e" },
  { name: "الأزرق", fill: "#3b82f6", light: "#bfdbfe", dark: "#1e3a8a" },
];

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function range(a: number, b: number, step = 1): number[] {
  const out: number[] = [];
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i);
  return out;
}

/** مركز القطعة على اللوحة */
function tokenPoint(color: number, pos: number, token: number): [number, number] {
  if (pos === -1) {
    const [x, y] = YARD[color];
    return [x + 1.75 + (token % 2) * 2.5, y + 1.75 + Math.floor(token / 2) * 2.5];
  }
  if (pos === 56) {
    const [x, y] = FINISH[color];
    return [x + ((token % 2) - 0.5) * 0.45, y + (Math.floor(token / 2) - 0.5) * 0.45];
  }
  const [x, y] = pos <= 50 ? TRACK[(color * 13 + pos) % 52] : HOME_LANE[color][pos - 51];
  return [x + 0.5, y + 0.5];
}

/** القطع التي يمكن تحريكها (نفس _ludo_legal) */
function legalTokens(l: LudoState, player: number, dice: number): number[] {
  return [0, 1, 2, 3].filter((t) => {
    const p = l.tokens[player][t];
    return (p === -1 && dice === 6) || (p >= 0 && p + dice <= 56);
  });
}

// ---------- المكوّن ----------

export function LudoGame({
  room,
  players,
  userId,
  isHost,
  offset,
  call,
}: {
  room: Room;
  players: Player[];
  userId: string;
  isHost: boolean;
  offset: RefObject<number>;
  call: Call;
}) {
  const now = useServerNow(offset);
  const l = room.ludo!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rolling, setRolling] = useState(false);

  const me = l.players.indexOf(userId);
  const myTurn = room.turn_player === userId;
  const turnName = (i: number) => players.find((p) => p.user_id === l.players[i]);
  const legal = myTurn && l.phase === "move" && l.dice ? legalTokens(l, me, l.dice) : [];
  useLudoSounds(l);

  async function act(fn: string, args: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      await call(fn, args);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function roll() {
    setRolling(true);
    setTimeout(() => setRolling(false), 450);
    await act("ludo_roll");
  }

  const turnPlayer = turnName(l.turn);
  const turnColor = COLORS[l.colors[l.turn]];

  return (
    <section className="space-y-3">
      {/* صاحب الدور والنرد */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-3xl border-2 p-3"
        style={{ borderColor: turnColor.fill, background: `${turnColor.fill}22` }}
      >
        <div className="flex-1">
          <p className="text-lg font-black">
            {myTurn
              ? l.phase === "roll"
                ? "🎲 دورك! ارمِ النرد"
                : "👆 اختر قطعة لتحريكها"
              : `⏳ دور ${turnPlayer?.avatar ?? ""} ${turnPlayer?.name ?? ""}`}
          </p>
          <LastEvent l={l} players={players} />
        </div>
        <button
          onClick={roll}
          disabled={!myTurn || l.phase !== "roll" || busy}
          className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-5xl leading-none text-black shadow-lg transition disabled:opacity-60 ${
            myTurn && l.phase === "roll" ? "animate-pulse ring-4 ring-amber-300" : ""
          } ${rolling ? "animate-spin" : ""}`}
          title="ارمِ النرد"
        >
          {l.dice ? DICE[l.dice] : l.last ? DICE[l.last.dice] : "🎲"}
        </button>
        <div className="w-full">
          <TimerBar seconds={msLeft(room.question_deadline, now)} total={room.question_seconds} />
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <Board l={l} legal={legal} me={me} onMove={(t) => act("ludo_move", { p_token: t })} disabled={busy} />

      {/* اللاعبون وألوانهم وتقدمهم */}
      <ul className="grid grid-cols-2 gap-2">
        {l.players.map((uid, i) => {
          const p = players.find((x) => x.user_id === uid);
          const c = COLORS[l.colors[i]];
          const home = l.tokens[i].filter((x) => x === 56).length;
          return (
            <li
              key={uid}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${i === l.turn ? "ring-2" : ""}`}
              style={{ background: `${c.fill}26`, ["--tw-ring-color" as string]: c.fill }}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-white" style={{ background: c.fill }} />
              <span className="flex-1 truncate">
                {p?.avatar} {p?.name}
                {uid === userId && " (أنت)"}
              </span>
              <span title="قطع وصلت">🏠 {home}/4</span>
            </li>
          );
        })}
      </ul>

      {isHost && (
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => act("skip_question")} className="btn-ghost" title="يُلعب عن صاحب الدور تلقائياً">
            ⏭️ العب عن صاحب الدور
          </button>
          <button
            onClick={() => {
              if (confirm("إنهاء اللعبة الآن؟")) act("end_game");
            }}
            className="btn-ghost"
          >
            🏁 إنهاء اللعبة
          </button>
        </div>
      )}
    </section>
  );
}

function LastEvent({ l, players }: { l: LudoState; players: Player[] }) {
  if (!l.last) return <p className="text-sm text-indigo-200">قطعة تخرج من البيت بالـ 6 فقط</p>;
  const p = players.find((x) => x.user_id === l.last!.player);
  const who = p ? `${p.avatar} ${p.name}` : "";
  const e = l.last;
  let text = `${who} رمى ${e.dice}`;
  if (e.type === "no_move") text += " ولا توجد حركة ممكنة";
  if (e.type === "three_sixes") text += " للمرة الثالثة: ضاع الدور 😅";
  if (e.type === "move") {
    if (e.from === -1) text = `${who} أخرج قطعة من البيت 🚀`;
    else if (e.to === 56) text = `${who} أوصل قطعة للنهاية 🏠 (+10)`;
    else text = `${who} حرّك قطعة ${e.dice} خطوات`;
    if (e.captured) text += ` وأكل ${e.captured > 1 ? `${e.captured} قطع` : "قطعة"} 💥 (+${e.captured * 5})`;
  }
  return <p className="text-sm text-indigo-100">{text}</p>;
}

function Board({
  l,
  legal,
  me,
  onMove,
  disabled,
}: {
  l: LudoState;
  legal: number[];
  me: number;
  onMove: (token: number) => void;
  disabled: boolean;
}) {
  // ألوان الزوايا: الألوان غير المستخدمة تظهر باهتة
  const used = new Set(l.colors);

  // تجميع القطع حسب المكان حتى تظهر المتراكبة بجانب بعضها
  const stacks = new Map<string, number>();
  const tokens = l.tokens.flatMap((arr, pi) =>
    arr.map((pos, t) => {
      const color = l.colors[pi];
      const [x, y] = tokenPoint(color, pos, t);
      const key = pos >= 0 && pos !== 56 ? `${x},${y}` : `${pi}-${t}`;
      const n = stacks.get(key) ?? 0;
      stacks.set(key, n + 1);
      return { pi, t, pos, color, x, y, n };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-[560px] select-none" dir="ltr">
      <svg viewBox="-0.2 -0.2 15.4 15.4" className="w-full rounded-2xl bg-white shadow-xl">
        {/* البيوت الأربعة */}
        {YARD.map(([x, y], c) => (
          <g key={c} opacity={used.has(c) ? 1 : 0.35}>
            <rect x={x} y={y} width={6} height={6} fill={COLORS[c].fill} />
            <rect x={x + 0.75} y={y + 0.75} width={4.5} height={4.5} rx={0.4} fill="#fff" />
            {[0, 1, 2, 3].map((t) => (
              <circle
                key={t}
                cx={x + 1.75 + (t % 2) * 2.5}
                cy={y + 1.75 + Math.floor(t / 2) * 2.5}
                r={0.55}
                fill={COLORS[c].light}
                stroke={COLORS[c].fill}
                strokeWidth={0.08}
              />
            ))}
          </g>
        ))}

        {/* المسار */}
        {TRACK.map(([x, y], i) => {
          const startColor = [0, 13, 26, 39].indexOf(i);
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={1}
                height={1}
                fill={startColor >= 0 ? COLORS[startColor].fill : "#fff"}
                stroke="#94a3b8"
                strokeWidth={0.04}
              />
              {SAFE.includes(i) && startColor < 0 && (
                <text x={x + 0.5} y={y + 0.72} fontSize={0.6} textAnchor="middle" fill="#64748b">
                  ★
                </text>
              )}
            </g>
          );
        })}

        {/* ممرات النهاية */}
        {HOME_LANE.map((lane, c) =>
          lane.map(([x, y], i) => (
            <rect
              key={`${c}-${i}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={COLORS[c].fill}
              opacity={used.has(c) ? 1 : 0.4}
              stroke="#94a3b8"
              strokeWidth={0.04}
            />
          )),
        )}

        {/* المركز */}
        <polygon points="6,6 7.5,7.5 6,9" fill={COLORS[0].fill} />
        <polygon points="6,6 7.5,7.5 9,6" fill={COLORS[1].fill} />
        <polygon points="9,6 7.5,7.5 9,9" fill={COLORS[2].fill} />
        <polygon points="6,9 7.5,7.5 9,9" fill={COLORS[3].fill} />

        {/* القطع */}
        {tokens.map(({ pi, t, color, x, y, n }) => {
          const canMove = pi === me && legal.includes(t) && !disabled;
          const shift = n * 0.18;
          return (
            <g
              key={`${pi}-${t}`}
              onClick={canMove ? () => onMove(t) : undefined}
              // تحويل CSS (وحدة px = وحدة اللوحة) حتى تتحرك القطعة بسلاسة
              style={{
                transform: `translate(${x + shift - (n ? 0.09 : 0)}px, ${y - shift}px)`,
                transition: "transform 0.35s ease",
                cursor: canMove ? "pointer" : "default",
              }}
            >
              {canMove && (
                <circle r={0.5} fill="none" stroke="#f59e0b" strokeWidth={0.1}>
                  <animate attributeName="r" values="0.42;0.56;0.42" dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}
              <circle r={0.36} fill={COLORS[color].fill} stroke="#fff" strokeWidth={0.1} />
              <circle r={0.36} fill="none" stroke={COLORS[color].dark} strokeWidth={0.04} />
              <circle r={0.12} fill="#fff" opacity={0.8} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** أصوات: رمي النرد، الأكل، الوصول */
function useLudoSounds(l: LudoState) {
  const last = useRef(l.seq);
  useEffect(() => {
    if (l.seq === last.current) return;
    last.current = l.seq;
    const e = l.last;
    if (!e) return;
    if (e.type === "move" && e.captured) sounds.wrong();
    else if (e.type === "move" && e.to === 56) sounds.correct();
    else sounds.tick();
  }, [l.seq, l.last]);
}
