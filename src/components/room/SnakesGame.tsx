"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import type { Category, Player, Room } from "@/lib/types";
import type { SnakesEvent, SnakesSide, SnakesState } from "@/lib/snakes";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";
import { SnakesBoard } from "./SnakesBoard";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة كل مرحلة بالثواني (يجب أن تطابق 0027_snakes_ladders.sql)
const ROLL_SECONDS = 20;
const PICK_SECONDS = 15;
const RESULT_SECONDS = 5;
const MEDALS = ["🥇", "🥈", "🥉"];

const sideColor = (s: SnakesSide) => teamInfo(s.color).hex;

export function snakesSideName(s: SnakesSide, players: Player[]): string {
  if (s.team != null) return teamInfo(s.team).name;
  const p = players.find((x) => x.user_id === s.user);
  return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
}

/** رقم لون اللاعب: فريقه، أو هو نفسه في الفردي */
function sideOf(st: SnakesState, userId: string, players: Player[]): number {
  const team = players.find((p) => p.user_id === userId)?.team ?? null;
  return (st.sides ?? []).findIndex((s) => (s.team != null ? s.team === team : s.user === userId));
}

export function SnakesGame({
  room,
  state: st,
  players,
  userId,
  isHost,
  offset,
  call,
}: {
  room: Room;
  state: SnakesState;
  players: Player[];
  userId: string;
  isHost: boolean;
  offset: RefObject<number>;
  call: Call;
}) {
  const now = useServerNow(offset);
  const sides = st.sides ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useSnakesSounds(st);

  const mine = sideOf(st, userId, players);
  const myTurn = mine === st.turn;
  const turnSide = sides[st.turn];
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
    st.phase === "roll"
      ? ROLL_SECONDS
      : st.phase === "pick"
        ? PICK_SECONDS
        : st.phase === "answer"
          ? room.question_seconds
          : RESULT_SECONDS;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <SideChips st={st} players={players} mine={mine} />

      <SnakesBoard l={st} />

      {/* لوحة الدور: الزهر، أو اختيار المجال، أو السؤال */}
      <div className="space-y-3 rounded-3xl border-2 bg-white/5 p-4 text-center" style={{ borderColor: `${color}99` }}>
        <p className="text-lg font-black" style={{ color }}>
          {turnSide && `دور ${snakesSideName(turnSide, players)}`}
          {myTurn && " (دورك!)"}
        </p>

        {st.phase === "roll" && (
          <>
            <Dice value={st.dice} seq={st.seq} />
            <button
              onClick={() => act("snakes_roll")}
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

        {st.phase === "pick" && (
          <PickCategory
            room={room}
            myTurn={myTurn}
            busy={busy}
            onPick={(id) => act("snakes_pick", { p_category: id })}
          />
        )}

        {(st.phase === "answer" || st.phase === "result") && room.question && (
          <SnakesQuestion
            room={room}
            st={st}
            canAnswer={myTurn && st.phase === "answer" && !busy}
            onAnswer={(i) => act("snakes_answer", { p_choice: i })}
          />
        )}

        <p className="text-sm text-indigo-100">{eventText(st, players)}</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      <GameLog st={st} players={players} />

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

/** الألوان وحالة كل لون: المربع، أو المركز */
function SideChips({ st, players, mine }: { st: SnakesState; players: Player[]; mine: number }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {(st.sides ?? []).map((s, i) => {
        const place = st.places.indexOf(i);
        const pos = st.pos[i];
        return (
          <li
            key={i}
            className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold ${
              i === st.turn ? "" : "border-transparent"
            } ${i === mine ? "bg-white/15" : "bg-white/5"}`}
            style={i === st.turn ? { borderColor: "#fbbf24" } : undefined}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: sideColor(s) }} />
            <span className="max-w-32 truncate">{snakesSideName(s, players)}</span>
            <span className="text-xs text-indigo-200">
              {place >= 0 ? (MEDALS[place] ?? `🏁${place + 1}`) : pos === 0 ? "🚩" : `${pos}/${st.steps}`}
            </span>
          </li>
        );
      })}
    </ul>
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
          {value != null && PIPS[value]?.includes(k) && <span className="h-2.5 w-2.5 rounded-full bg-[#1e1b4b]" />}
        </span>
      ))}
    </div>
  );
}

// ---------- اختيار المجال ----------

function PickCategory({
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

function SnakesQuestion({
  room,
  st,
  canAnswer,
  onAnswer,
}: {
  room: Room;
  st: SnakesState;
  canAnswer: boolean;
  onAnswer: (i: number) => void;
}) {
  const q = room.question!;
  const result = st.phase === "result";
  const chosen = result ? (st.last?.choice ?? null) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category} • الزهر: {st.dice}
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

function eventText(st: SnakesState, players: Player[]): string {
  const sides = st.sides ?? [];
  const who = (e: SnakesEvent) => (sides[e.side] ? snakesSideName(sides[e.side], players) : "");
  const e = st.last;
  if (st.phase === "roll") {
    const before = e ? `${describe(e, who(e))} • ` : "";
    const left = st.steps - st.pos[st.turn];
    return (
      before +
      (left <= 6
        ? `محتاج ${left} بالظبط عشان توصل للنهاية 🏁`
        : "ارمِ الزهر ثم جاوب صح عشان تتقدم... واحذر الثعابين 🐍")
    );
  }
  if (!e) return "";
  if (st.phase === "answer" || st.phase === "pick") {
    const target = Math.min(st.pos[e.side] + e.dice, st.steps);
    const jump = st.jumps[String(target)];
    const hint = jump == null ? "" : jump > target ? " (فيه سلم 🪜 هناك!)" : " (انتبه: هناك ثعبان 🐍!)";
    return `${who(e)} رمى ${e.dice}. جاوب صح عشان توصل للمربع ${target}${hint}`;
  }
  return describe(e, who(e));
}

function describe(e: SnakesEvent, who: string): string {
  const arrived = e.place ? ` 🏆 ووصل للنهاية في المركز ${e.place}!` : "";
  switch (e.type) {
    case "overshoot":
      return `${who} رمى ${e.dice} ومحتاج ${e.need} بالظبط للوصول`;
    case "roll":
      return `${who} رمى ${e.dice}`;
    case "correct":
      if (e.jump === "ladder")
        return `✅ ${who} جاوب صح ووقف على ${e.land} وطلع السلم 🪜 لحد ${e.to}! (+${e.points})${arrived}`;
      if (e.jump === "snake")
        return `✅ ${who} جاوب صح (+${e.points}) بس وقف على ${e.land} والثعبان 🐍 نزّله لـ ${e.to}!`;
      return `✅ ${who} جاوب صح وتقدم للمربع ${e.to} (+${e.points})${arrived}`;
    case "wrong":
      return `❌ ${who} جاوب غلط (${e.points})`;
    case "timeout":
      return `⏰ ${who} انتهى وقته (${e.points})`;
  }
}

// ---------- سجل اللعبة ----------

function GameLog({ st, players }: { st: SnakesState; players: Player[] }) {
  const sides = st.sides ?? [];
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
              <th>المربع</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((s, i) => (
              <tr key={i} className="border-b border-white/5 text-center">
                <td className="max-w-36 truncate py-1 text-start font-bold" style={{ color: sideColor(s) }}>
                  {snakesSideName(s, players)}
                </td>
                <td>{st.rolls[i]}</td>
                <td>{st.correct[i]}</td>
                <td>{st.wrong[i]}</td>
                <td dir="ltr">
                  {st.pos[i]}/{st.steps}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {st.log.length > 0 && (
        <ul className="space-y-1">
          {st.log.map((e, k) => (
            <li key={`${st.seq}-${k}`} className="rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              {describe(e, sides[e.side] ? snakesSideName(sides[e.side], players) : "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** أصوات: الرمي، الإجابة الصحيحة (والسلم)، الخاطئة (والثعبان) */
function useSnakesSounds(st: SnakesState) {
  const last = useRef(st.seq);
  useEffect(() => {
    if (st.seq === last.current) return;
    last.current = st.seq;
    const e = st.last;
    if (!e) return;
    if (e.type === "correct" && e.jump === "snake") sounds.wrong();
    else if (e.type === "correct") sounds.correct();
    else if (e.type === "wrong" || e.type === "timeout") sounds.wrong();
    else sounds.tick();
  }, [st.seq, st.last]);
}
