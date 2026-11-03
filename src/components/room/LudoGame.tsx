"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import type { Category, LudoEvent, LudoSide, LudoState, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة كل مرحلة بالثواني (يجب أن تطابق 0016_ludo_quiz.sql)
const ROLL_SECONDS = 20;
const PICK_SECONDS = 15;
const RESULT_SECONDS = 4;
const MEDALS = ["🥇", "🥈", "🥉"];

const sideColor = (s: LudoSide) => teamInfo(s.color).hex;

function sideName(s: LudoSide, players: Player[]): string {
  if (s.team != null) return teamInfo(s.team).name;
  const p = players.find((x) => x.user_id === s.user);
  return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
}

/** رقم لون اللاعب: فريقه، أو هو نفسه في الفردي */
function sideOf(l: LudoState, userId: string, players: Player[]): number {
  const team = players.find((p) => p.user_id === userId)?.team ?? null;
  return (l.sides ?? []).findIndex((s) => (s.team != null ? s.team === team : s.user === userId));
}

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
  const sides = l.sides ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLudoSounds(l);

  const mine = sideOf(l, userId, players);
  const myTurn = mine === l.turn;
  const turnSide = sides[l.turn];
  const color = turnSide ? sideColor(turnSide) : "#6366f1";

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

  const total =
    l.phase === "roll"
      ? ROLL_SECONDS
      : l.phase === "pick"
        ? PICK_SECONDS
        : l.phase === "answer"
          ? room.question_seconds
          : RESULT_SECONDS;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <SideChips l={l} players={players} mine={mine} />

      <Board l={l} />

      {/* لوحة الدور: الزهر، أو اختيار المجال، أو السؤال */}
      <div className="space-y-3 rounded-3xl border-2 bg-white/5 p-4 text-center" style={{ borderColor: `${color}99` }}>
        <p className="text-lg font-black" style={{ color }}>
          {turnSide && `دور ${sideName(turnSide, players)}`}
          {myTurn && " (دورك!)"}
        </p>

        {l.phase === "roll" && (
          <>
            <Dice value={l.dice} seq={l.seq} />
            <button
              onClick={() => act("ludo_roll")}
              disabled={!myTurn || busy}
              className={`mx-auto block rounded-2xl px-8 py-3 text-lg font-black text-white shadow-lg transition disabled:opacity-50 ${
                myTurn ? "hover:scale-105" : ""
              }`}
              style={{ background: color }}
            >
              ارمِ الزهر 🎲
            </button>
          </>
        )}

        {l.phase === "pick" && (
          <PickLudoCategory
            room={room}
            myTurn={myTurn}
            busy={busy}
            onPick={(id) => act("ludo_pick", { p_category: id })}
          />
        )}

        {(l.phase === "answer" || l.phase === "result") && room.question && (
          <LudoQuestion
            room={room}
            l={l}
            canAnswer={myTurn && l.phase === "answer" && !busy}
            onAnswer={(i) => act("ludo_answer", { p_choice: i })}
          />
        )}

        <p className="text-sm text-indigo-100">{eventText(l, players)}</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      <GameLog l={l} players={players} />

      {isHost && (
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => act("skip_question")} className="btn-ghost" title="لصاحب دور غائب مثلاً">
            ⏭️ تخطي المرحلة
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

/** الألوان وحالة كل لون: في البيت، الخطوات، أو المركز */
function SideChips({ l, players, mine }: { l: LudoState; players: Player[]; mine: number }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {(l.sides ?? []).map((s, i) => {
        const place = l.places.indexOf(i);
        const pos = l.pos[i];
        return (
          <li
            key={i}
            className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold ${
              i === l.turn ? "" : "border-transparent"
            } ${i === mine ? "bg-white/15" : "bg-white/5"}`}
            style={i === l.turn ? { borderColor: "#fbbf24" } : undefined}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: sideColor(s) }} />
            <span className="max-w-32 truncate">{sideName(s, players)}</span>
            <span className="text-xs text-indigo-200">
              {place >= 0 ? (MEDALS[place] ?? `🏁${place + 1}`) : pos < 0 ? "🏠" : `${pos}/${l.steps}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- اللوحة: دائرة، لكل لون مسار من بيته (الحافة) إلى النهاية (المركز) ----------

const C = 200; // مركز اللوحة
const HOME_R = 174; // بعد البيت عن المركز
const END_R = 50; // نهاية المسار عند حافة المركز
const CENTER_R = 40;

type Pt = [number, number];
const polar = (a: number, r: number): Pt => [C + r * Math.cos(a), C + r * Math.sin(a)];

interface Track {
  home: Pt;
  /** المسار كاملاً (للرسم) */
  line: Pt[];
  /** مكان كل خطوة 0..steps-1، بمسافات متساوية على طول المسار */
  cells: Pt[];
  /** مكان القطعة بعد الوصول (على حافة المركز) */
  finish: Pt;
}

/**
 * سكة متعرجة طويلة من البيت إلى المركز: تتمايل يميناً ويساراً أثناء اقترابها من النهاية،
 * وتتقاطع مع سكك الألوان المجاورة مثل جناحي الفراشة.
 */
function buildTrack(i: number, n: number, steps: number): Track {
  const a0 = -Math.PI / 2 + (2 * Math.PI * i) / n;
  const swing = Math.min((Math.PI / n) * 1.15, 0.95); // أكبر قليلاً من نصف المسافة بين الألوان، فتتقاطع السكك
  const waves = Math.round((1 + steps / 20) * 2) / 2; // عدد نصفي: السكة تنتهي في اتجاه بيتها
  const line: Pt[] = [];
  const N = 600;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const r = HOME_R - (HOME_R - END_R) * t;
    line.push(polar(a0 + swing * Math.sin(2 * Math.PI * waves * t) * (1 - 0.3 * t), r));
  }
  // الطول التراكمي لتوزيع الخطوات بالتساوي على السكة
  const acc = [0];
  for (let k = 1; k < line.length; k++) {
    acc.push(acc[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
  }
  const total = acc[acc.length - 1];
  const cells: Pt[] = [];
  let j = 0;
  for (let k = 0; k < steps; k++) {
    const target = (total * (k + 1)) / (steps + 1);
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const f = (target - acc[j]) / Math.max(acc[j + 1] - acc[j], 1e-9);
    cells.push([line[j][0] + (line[j + 1][0] - line[j][0]) * f, line[j][1] + (line[j + 1][1] - line[j][1]) * f]);
  }
  return { home: line[0], line, cells, finish: polar(a0, 28) };
}

function Board({ l }: { l: LudoState }) {
  const sides = l.sides ?? [];
  const n = Math.max(sides.length, 1);
  const steps = l.steps;
  const tracks = useMemo(() => Array.from({ length: n }, (_, i) => buildTrack(i, n, steps)), [n, steps]);
  // حجم الخطوة حسب المسافة بينها
  const [c0, c1] = tracks[0].cells;
  const dotR = Math.max(3.5, Math.min(9, (c1 ? Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) : 20) * 0.42));

  const piecePoint = (i: number): Pt => {
    const pos = l.pos[i];
    return pos < 0 ? tracks[i].home : pos >= steps ? tracks[i].finish : tracks[i].cells[pos];
  };

  return (
    <div className="mx-auto w-full max-w-[460px] select-none" dir="ltr">
      <svg viewBox="0 0 400 400" className="w-full drop-shadow-xl">
        <circle cx={C} cy={C} r={196} fill="#f7f0e3" />

        {/* السكك: شريط عريض فاتح وخط رفيع في المنتصف يوضح الاتجاه */}
        {sides.map((s, i) => {
          const pts = tracks[i].line.map(([x, y]) => `${x},${y}`).join(" ");
          return (
            <g key={i} fill="none" stroke={sideColor(s)} strokeLinecap="round" strokeLinejoin="round">
              <polyline points={pts} strokeOpacity={0.18} strokeWidth={dotR * 2.6} />
              <polyline points={pts} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="3 3" />
            </g>
          );
        })}

        {sides.map((s, i) => {
          const hex = sideColor(s);
          const [hx, hy] = tracks[i].home;
          return (
            <g key={i}>
              {/* الخطوات: الأقرب للنهاية أغمق، وما قطعه اللون ممتلئ */}
              {tracks[i].cells.map(([x, y], k) => (
                <circle
                  key={k}
                  cx={x}
                  cy={y}
                  r={dotR}
                  fill={hex}
                  opacity={l.pos[i] >= k ? 0.95 : 0.3 + (0.4 * k) / Math.max(steps - 1, 1)}
                  stroke="#fff"
                  strokeWidth={1}
                />
              ))}
              {/* البيت */}
              <circle cx={hx} cy={hy} r={20} fill={hex} />
              <circle cx={hx} cy={hy} r={13} fill="none" stroke="#1e1b4b" strokeWidth={3} />
            </g>
          );
        })}

        <circle cx={C} cy={C} r={CENTER_R} fill="#fde68a" stroke="#f59e0b" strokeWidth={2} />
        <text x={C} y={C + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#1e1b4b">
          النهاية
        </text>

        {/* القطع (تتحرك بسلاسة بتحويل CSS) */}
        {sides.map((s, i) => {
          const [x, y] = piecePoint(i);
          const active = i === l.turn && l.phase !== "done";
          return (
            <g key={i} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 0.7s ease" }}>
              {active && (
                <circle r={17} fill="none" stroke="#fbbf24" strokeWidth={3}>
                  <animate attributeName="r" values="15;20;15" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle r={12} fill={sideColor(s)} stroke="#fff" strokeWidth={3} />
              <circle r={12} fill="none" stroke="#1e1b4b" strokeWidth={1.5} />
              <circle r={4} fill="#fff" opacity={0.85} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- الزهر ----------

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Dice({ value, seq }: { value: number | null; seq: number }) {
  return (
    <div
      key={seq}
      className="animate-dice mx-auto grid h-16 w-16 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-[#f7f0e3] p-2.5 shadow-lg"
    >
      {Array.from({ length: 9 }, (_, k) => (
        <span key={k} className="flex items-center justify-center">
          {(PIPS[value ?? 1] ?? []).includes(k) && <span className="h-2.5 w-2.5 rounded-full bg-slate-900" />}
        </span>
      ))}
    </div>
  );
}

// ---------- اختيار المجال ----------

function PickLudoCategory({
  room,
  myTurn,
  busy,
  onPick,
}: {
  room: Room;
  myTurn: boolean;
  busy: boolean;
  onPick: (id: number) => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);

  useEffect(() => {
    if (!myTurn) return;
    getSupabase()
      .rpc("list_categories")
      .then(({ data }) => {
        const all = (data ?? []) as Category[];
        setCategories(room.category_ids ? all.filter((c) => room.category_ids!.includes(c.id)) : all);
      });
  }, [myTurn, room.category_ids]);

  if (!myTurn) return <p className="py-4 text-lg font-bold">⏳ يختار مجال السؤال...</p>;
  if (!categories) return <p className="text-indigo-200">جارٍ التحميل...</p>;
  return (
    <>
      <p className="font-bold">🗂️ اختر مجال سؤالك</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            disabled={busy}
            className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 font-bold transition hover:bg-indigo-500/30 disabled:opacity-50"
          >
            <span className="block text-2xl">{c.icon}</span>
            {c.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-indigo-300">إن انتهى الوقت يُختار مجال عشوائي</p>
    </>
  );
}

// ---------- السؤال ----------

function LudoQuestion({
  room,
  l,
  canAnswer,
  onAnswer,
}: {
  room: Room;
  l: LudoState;
  canAnswer: boolean;
  onAnswer: (i: number) => void;
}) {
  const q = room.question!;
  const result = l.phase === "result";
  const chosen = result ? (l.last?.choice ?? null) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category} • الزهر: {l.dice}
      </p>
      <h3 className="text-xl font-black leading-relaxed">{q.text}</h3>
      <div className="grid grid-cols-2 gap-2">
        {q.options.map((opt, i) => {
          const isCorrect = result && room.correct_index === i;
          const isWrong = result && chosen === i && room.correct_index !== i;
          return (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              disabled={!canAnswer}
              className={`rounded-2xl px-3 py-3 font-bold transition ${
                isCorrect
                  ? "bg-emerald-500 text-white"
                  : isWrong
                    ? "bg-rose-500 text-white"
                    : canAnswer
                      ? "bg-white/10 hover:bg-indigo-500/40"
                      : "bg-white/10 opacity-70"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- رسالة آخر حدث ----------

function eventText(l: LudoState, players: Player[]): string {
  const sides = l.sides ?? [];
  const who = (e: LudoEvent) => (sides[e.side] ? sideName(sides[e.side], players) : "");
  const e = l.last;
  if (l.phase === "roll") {
    const before = e ? `${describe(e, who(e))} • ` : "";
    const pos = l.pos[l.turn];
    const left = l.steps - pos;
    return (
      before +
      (pos < 0
        ? "ارمِ الزهر! محتاج 6 عشان تطلع من البيت."
        : left <= 6
          ? `محتاج ${left} بالظبط عشان توصل للنهاية.`
          : "ارمِ الزهر ثم جاوب صح عشان تتقدم.")
    );
  }
  if (!e) return "";
  if (l.phase === "answer" || l.phase === "pick")
    return e.type === "six"
      ? `🎉 ${who(e)} رمى 6! جاوب صح عشان تطلع من البيت.`
      : `${who(e)} رمى ${e.dice}. جاوب صح عشان تتقدم ${e.dice} خطوات.`;
  return describe(e, who(e));
}

function describe(e: LudoEvent, who: string): string {
  switch (e.type) {
    case "need6":
      return `${who} رمى ${e.dice} (محتاج 6)`;
    case "six":
      return `${who} رمى 6 🎉`;
    case "overshoot":
      return `${who} رمى ${e.dice} ومحتاج ${e.need} بالظبط للوصول`;
    case "roll":
      return `${who} رمى ${e.dice}`;
    case "correct":
      if (e.from === -1) return `✅ ${who} جاوب صح وطلع من البيت 🚀 (+${e.points})`;
      return `✅ ${who} جاوب صح وتقدم ${(e.to ?? 0) - (e.from ?? 0)} خطوات (+${e.points})${
        e.place ? ` 🏆 ووصل للنهاية في المركز ${e.place}!` : ""
      }`;
    case "wrong":
      return `❌ ${who} جاوب غلط (${e.points})`;
    case "timeout":
      return `⏰ ${who} انتهى وقته (${e.points})`;
  }
}

// ---------- سجل اللعبة ----------

function GameLog({ l, players }: { l: LudoState; players: Player[] }) {
  const sides = l.sides ?? [];
  return (
    <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-black text-amber-300">سجل اللعبة</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-indigo-200">
            <tr className="border-b border-white/10">
              <th className="py-1 text-start">اللون</th>
              <th>رميات</th>
              <th>صح</th>
              <th>غلط</th>
              <th>خطوات</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((s, i) => (
              <tr key={i} className="border-b border-white/5 text-center">
                <td className="max-w-36 truncate py-1 text-start font-bold" style={{ color: sideColor(s) }}>
                  {sideName(s, players)}
                </td>
                <td>{l.rolls[i]}</td>
                <td>{l.correct[i]}</td>
                <td>{l.wrong[i]}</td>
                <td dir="ltr">
                  {Math.max(l.pos[i], 0)}/{l.steps}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {l.log.length > 0 && (
        <ul className="space-y-1">
          {l.log.map((e, k) => (
            <li key={`${l.seq}-${k}`} className="rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              {describe(e, sides[e.side] ? sideName(sides[e.side], players) : "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** أصوات: الرمي، الإجابة الصحيحة، الخاطئة */
function useLudoSounds(l: LudoState) {
  const last = useRef(l.seq);
  useEffect(() => {
    if (l.seq === last.current) return;
    last.current = l.seq;
    const e = l.last;
    if (!e) return;
    if (e.type === "correct") sounds.correct();
    else if (e.type === "wrong" || e.type === "timeout") sounds.wrong();
    else sounds.tick();
  }, [l.seq, l.last]);
}
