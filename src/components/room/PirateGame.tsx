"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import type { LudoSide, Player, PirateEvent, PirateState, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة المراحل بالثواني (يجب أن تطابق 0020_pirate.sql)
const PICK_SECONDS = 20;
const REVEAL_SECONDS = 4;

const sideColor = (s: LudoSide) => teamInfo(s.color).hex;

export function pirateSideName(s: LudoSide, players: Player[]): string {
  if (s.team != null) return teamInfo(s.team).name;
  const p = players.find((x) => x.user_id === s.user);
  return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
}

/** رقم لون اللاعب: فريقه، أو هو نفسه */
function sideOf(p: PirateState, userId: string, players: Player[]): number {
  const team = players.find((x) => x.user_id === userId)?.team ?? null;
  return (p.sides ?? []).findIndex((s) => (s.team != null ? s.team === team : s.user === userId));
}

export const islandCount = (p: PirateState, side: number) => (p.islands ?? []).filter((i) => i.owner === side).length;

export function PirateGame({
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
  const p = room.pirate!;
  const sides = p.sides ?? [];
  const islands = p.islands ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  usePirateSounds(p);

  const mine = sideOf(p, userId, players);
  const myTurn = mine === p.turn;
  const war = p.stage === "war";
  const turnSide = sides[p.turn];
  const name = (i: number | null | undefined) => (i != null && sides[i] ? pirateSideName(sides[i], players) : "");

  // الجزر التي يمكن اختيارها الآن
  const pickable =
    p.phase === "pick" && myTurn
      ? new Set(
          islands
            .map((isl, i) => ({ isl, i }))
            .filter(({ isl }) => (war ? isl.owner != null && isl.owner !== p.turn : isl.owner == null))
            .map(({ i }) => i),
        )
      : new Set<number>();

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

  const total = p.phase === "pick" ? PICK_SECONDS : p.phase === "question" ? room.question_seconds : REVEAL_SECONDS;
  const target = p.target != null ? islands[p.target] : null;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-3">
      {/* الألوان وعدد جزر كل منها */}
      <ul className="flex flex-wrap justify-center gap-2">
        <li className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold text-amber-200">
          {war ? "⚔️ مرحلة الحرب" : "⛵ مرحلة الغزو"}
        </li>
        {sides.map((s, i) => {
          const n = islandCount(p, i);
          const out = war && n === 0;
          return (
            <li
              key={i}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold ${
                i === p.turn ? "" : "border-transparent"
              } ${i === mine ? "bg-white/15" : "bg-white/5"} ${out ? "opacity-40" : ""}`}
              style={i === p.turn ? { borderColor: "#fbbf24" } : undefined}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: sideColor(s) }} />
              <span className="max-w-32 truncate">{pirateSideName(s, players)}</span>
              <span className="text-xs text-indigo-200">{out ? "☠️" : `🏝️ ${n}`}</span>
            </li>
          );
        })}
      </ul>

      <PirateMap p={p} pickable={pickable} disabled={busy} onPick={(i) => act("pirate_pick", { p_island: i })} />

      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        {p.phase === "pick" && (
          <p className="text-lg font-black" style={{ color: turnSide ? sideColor(turnSide) : undefined }}>
            {myTurn
              ? war
                ? "⚔️ دورك! اضغط على جزيرة خصم لتهاجمها"
                : "⛵ دورك! اضغط على جزيرة خالية لتغزوها"
              : `⏳ ${name(p.turn)} ${war ? "يختار جزيرة ليهاجمها..." : "يختار جزيرة ليغزوها..."}`}
          </p>
        )}

        {(p.phase === "question" || p.phase === "reveal") && target && room.question && (
          <Battle
            room={room}
            p={p}
            mine={mine}
            busy={busy}
            name={name}
            onAnswer={(i) => act("pirate_answer", { p_choice: i })}
          />
        )}

        {p.phase === "pick" && p.last && <p className="text-sm text-indigo-200">{describe(p.last, p, name)}</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      <div className="space-y-2 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h3 className="font-black text-amber-300">📜 سجل المعارك</h3>
        <ul className="space-y-1">
          {p.log.map((e, k) => (
            <li key={`${p.seq}-${k}`} className="rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              {describe(e, p, name)}
            </li>
          ))}
        </ul>
      </div>

      {isHost && (
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => act("skip_question")} className="btn-ghost" title="لصاحب دور غائب مثلاً">
            ⏭️ تخطي المرحلة
          </button>
          <button
            onClick={() => {
              if (confirm("إنهاء اللعبة الآن؟ الفائز صاحب أكثر الجزر.")) act("end_game");
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

// ---------- المعركة (السؤال) ----------

function Battle({
  room,
  p,
  mine,
  busy,
  name,
  onAnswer,
}: {
  room: Room;
  p: PirateState;
  mine: number;
  busy: boolean;
  name: (i: number | null | undefined) => string;
  onAnswer: (i: number) => void;
}) {
  const q = room.question!;
  const island = p.islands![p.target!];
  const reveal = p.phase === "reveal";
  const fighting = p.fighters.includes(mine);
  const canAnswer = p.phase === "question" && fighting && !p.answered.includes(mine) && !busy;

  return (
    <div className="space-y-3">
      <p className="text-lg font-black">
        ⚔️ معركة على {island.name}
        {p.stage === "war" && island.owner != null && (
          <span className="block text-sm font-normal text-indigo-200">
            {name(p.turn)} يهاجم {name(island.owner)}
          </span>
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {p.fighters.map((f) => {
          const answered = p.answered.includes(f);
          const won = reveal && p.winner === f;
          return (
            <span
              key={f}
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                won ? "bg-emerald-500 text-white" : "bg-black/25"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: sideColor(p.sides![f]) }} />
              {name(f)}
              {won ? " 🏆" : answered ? " ❌" : ""}
            </span>
          );
        })}
      </div>
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category} • أسرع إجابة صحيحة تفوز
      </p>
      <h3 className="text-xl font-black leading-relaxed">{q.text}</h3>
      <div className="grid grid-cols-2 gap-2">
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onAnswer(i)}
            disabled={!canAnswer}
            className={`rounded-2xl px-3 py-3 font-bold transition ${
              reveal && room.correct_index === i
                ? "bg-emerald-500 text-white"
                : canAnswer
                  ? "bg-white/10 hover:bg-indigo-500/40"
                  : "bg-white/10 opacity-70"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {p.phase === "question" && (
        <p className="text-sm text-indigo-200">
          {!fighting
            ? "👀 تشاهد المعركة"
            : p.answered.includes(mine)
              ? "❌ إجابة خاطئة، انتظر نهاية المعركة"
              : "أجب بسرعة قبل خصومك!"}
        </p>
      )}
      {reveal && (
        <p className={`text-lg font-black ${p.winner != null ? "text-emerald-300" : "text-rose-300"}`}>
          {p.winner == null
            ? p.stage === "war"
              ? `🛡️ لا أحد أجاب صح، ${island.name} تبقى لصاحبها`
              : "🌊 لا أحد أجاب صح، الجزيرة تبقى خالية"
            : p.stage === "war" && p.winner === island.owner
              ? `🛡️ ${name(p.winner)} صدّ الهجوم!`
              : `🏴‍☠️ ${name(p.winner)} يستولي على ${island.name}!`}
        </p>
      )}
    </div>
  );
}

// ---------- الخريطة ----------

const W = 400;
const H = 280;

/** رقم شبه عشوائي ثابت (نفس الخريطة عند الجميع) */
function hash(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface IslandShape {
  x: number;
  y: number;
  r: number;
  path: string;
}

/** أماكن الجزر على شبكة مع إزاحة، وشكل كل جزيرة منحنى مغلق متعرج */
function layout(n: number): IslandShape[] {
  const cols = Math.ceil(Math.sqrt(n * (W / H)));
  const rows = Math.ceil(n / cols);
  const cw = (W - 30) / cols;
  const ch = (H - 30) / rows;
  const r = Math.min(cw, ch) * 0.3;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    // الصف الأخير الناقص يتوسط الخريطة
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i % cols;
    const offsetX = ((cols - inRow) * cw) / 2;
    const x = 15 + offsetX + cw * (col + 0.5) + (hash(i + 1) - 0.5) * cw * 0.3;
    const y = 15 + ch * (row + 0.5) + (hash(i + 101) - 0.5) * ch * 0.25 - 6;
    const size = r * (0.85 + hash(i + 7) * 0.35);
    const pts = Array.from({ length: 9 }, (_, k) => {
      const a = (k / 9) * Math.PI * 2;
      const rr = size * (0.72 + hash(i * 31 + k) * 0.38);
      return [x + Math.cos(a) * rr * 1.25, y + Math.sin(a) * rr] as [number, number];
    });
    return { x, y, r: size, path: smooth(pts) };
  });
}

/** منحنى ناعم مغلق يمر بالنقاط (Catmull-Rom) */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

function PirateMap({
  p,
  pickable,
  disabled,
  onPick,
}: {
  p: PirateState;
  pickable: Set<number>;
  disabled: boolean;
  onPick: (i: number) => void;
}) {
  const islands = p.islands ?? [];
  const shapes = useMemo(() => layout(islands.length), [islands.length]);
  const fontSize = Math.max(7, Math.min(10, (shapes[0]?.r ?? 20) * 0.42));

  return (
    <div className="mx-auto w-full select-none" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-hidden rounded-3xl shadow-2xl">
        <defs>
          <radialGradient id="sea" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#1e88c7" />
            <stop offset="100%" stopColor="#0b3d6b" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#sea)" />
        {/* أمواج */}
        {Array.from({ length: 14 }, (_, k) => {
          const x = hash(k + 300) * W;
          const y = hash(k + 400) * H;
          return (
            <path
              key={k}
              d={`M${x},${y} q5,-4 10,0 t10,0`}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.18}
              strokeWidth={1.2}
            />
          );
        })}
        <text x={W - 18} y={22} fontSize={16} textAnchor="middle">
          🧭
        </text>

        {islands.map((isl, i) => {
          const s = shapes[i];
          const owner = isl.owner != null ? p.sides?.[isl.owner] : null;
          const fill = owner ? sideColor(owner) : "#e9d8a6";
          const target = p.target === i && p.phase !== "pick";
          const canPick = pickable.has(i) && !disabled;
          return (
            <g
              key={i}
              onClick={canPick ? () => onPick(i) : undefined}
              style={{ cursor: canPick ? "pointer" : "default" }}
            >
              {/* الشاطئ */}
              <path
                d={s.path}
                fill="#f6e7b4"
                transform={`translate(${s.x} ${s.y}) scale(1.12) translate(${-s.x} ${-s.y})`}
                opacity={0.55}
              />
              <path
                d={s.path}
                fill={fill}
                stroke={canPick ? "#fbbf24" : "#7c5a2b"}
                strokeWidth={canPick ? 3 : 1.2}
                style={{ transition: "fill 0.6s ease" }}
              >
                {canPick && (
                  <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
                )}
              </path>
              <text x={s.x} y={s.y + s.r * 0.3} fontSize={s.r * 0.85} textAnchor="middle">
                {owner ? "🏴‍☠️" : "🌴"}
              </text>
              {target && (
                <>
                  <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill="none" stroke="#ef4444" strokeWidth={2.5}>
                    <animate
                      attributeName="r"
                      values={`${s.r * 1.4};${s.r * 1.75};${s.r * 1.4}`}
                      dur="1s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <text x={s.x + s.r * 1.1} y={s.y - s.r * 0.9} fontSize={s.r * 0.7} textAnchor="middle">
                    ⚔️
                  </text>
                </>
              )}
              <text
                x={s.x}
                y={s.y + s.r + fontSize + 2}
                fontSize={fontSize}
                fontWeight="bold"
                textAnchor="middle"
                fill="#fff"
                stroke="#0b3d6b"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {isl.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- الأحداث ----------

function describe(e: PirateEvent, p: PirateState, name: (i: number | null | undefined) => string): string {
  const island = e.island != null ? p.islands?.[e.island]?.name : "";
  switch (e.type) {
    case "sail":
      return `⛵ ${name(e.side)} أبحر نحو ${island}`;
    case "attack":
      return `⚔️ ${name(e.side)} يهاجم ${island} (${name(e.defender)})`;
    case "wrong":
      return `❌ ${name(e.side)} أخطأ`;
    case "conquered":
      return `🏴‍☠️ ${name(e.side)} غزا ${island}`;
    case "captured":
      return `💥 ${name(e.side)} انتزع ${island} من ${name(e.from)}`;
    case "nobody":
      return `🌊 لا أحد أجاب صح، ${island} ما زالت خالية`;
    case "defended":
      return `🛡️ ${name(e.side)} احتفظ بـ${island}`;
    case "war":
      return "⚔️ امتلأت الخريطة، بدأت الحرب! من يخسر كل جزره يخرج";
  }
}

function usePirateSounds(p: PirateState) {
  const last = useRef(p.seq);
  useEffect(() => {
    if (p.seq === last.current) return;
    last.current = p.seq;
    const e = p.last;
    if (!e) return;
    if (e.type === "conquered" || e.type === "captured") sounds.correct();
    else if (e.type === "wrong" || e.type === "nobody") sounds.wrong();
    else if (e.type === "attack" || e.type === "war") sounds.buzz();
    else sounds.tick();
  }, [p.seq, p.last]);
}
