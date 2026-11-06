"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import { BANK_BOARD, GROUP_COLORS, bankRent, bankWorth, type BankProp, type BankSquare } from "@/lib/bankBoard";
import type { BankEvent, BankState, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة القرار والكشف (يجب أن تطابق 0026_bank.sql)
const DECIDE_SECONDS = 30;
const REVEAL_SECONDS = 4;

export const bankColor = (i: number) => teamInfo(i + 1).hex;
const money = (n: number) => `${n.toLocaleString("en-US")} 💵`;

const squareName = (sq: number) => {
  const s = BANK_BOARD[sq];
  return s.t === "city"
    ? s.n
    : { start: "البداية", quiz: "⭐ سؤال", oasis: "الواحة", tax: "الضريبة", treasure: "الكنز" }[s.t];
};

export function BankGame({
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
  const b = room.bank!;
  const order = b.players ?? [];
  const cash = b.cash ?? [];
  const props = b.props ?? [];
  const turn = b.turn ?? 0;
  const me = order.indexOf(userId);
  const myTurn = me === turn && b.phase !== "done";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBankSounds(b);

  const name = (i: number | undefined) => {
    const p = players.find((x) => x.user_id === order[i ?? -1]);
    return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
  };

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

  const total = b.phase === "question" ? room.question_seconds : b.phase === "reveal" ? REVEAL_SECONDS : DECIDE_SECONDS;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-3">
      {/* اللاعبون: النقود والثروة */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {order.map((uid, i) => {
          const out = b.out?.[i];
          return (
            <li
              key={uid}
              className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-1.5 text-sm ${
                i === turn && b.phase !== "done" ? "" : "border-transparent"
              } ${i === me ? "bg-white/15" : "bg-white/5"} ${out ? "opacity-40" : ""}`}
              style={i === turn && b.phase !== "done" ? { borderColor: "#fbbf24" } : undefined}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: bankColor(i) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{name(i)}</span>
                <span className="block text-xs text-indigo-200" dir="ltr">
                  {out ? "💸 أفلس" : money(cash[i] ?? 0)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <Board b={b} props={props} order={order} name={name} />

      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-sm text-indigo-200">
          الجولة {b.round} من {b.rounds}
        </p>
        <TurnPanel
          room={room}
          b={b}
          myTurn={myTurn}
          me={me}
          busy={busy}
          name={name}
          props={props}
          onRoll={() => act("bank_roll")}
          onDecide={(c) => act("bank_decide", { p_choice: c })}
          onAnswer={(i) => act("bank_answer", { p_choice: i })}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        {b.phase !== "done" && <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />}
      </div>

      <div className="space-y-1.5 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h3 className="font-black text-amber-300">📜 سجل اللعبة</h3>
        <ul className="space-y-1">
          {(b.log ?? []).map((e, k) => (
            <li key={`${b.seq}-${k}`} className="rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              {describe(e, name)}
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
              if (confirm("إنهاء اللعبة الآن؟ يفوز الأغنى.")) act("end_game");
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

// ---------- لوحة الدور: الزهر والقرارات والسؤال ----------

function TurnPanel({
  room,
  b,
  myTurn,
  me,
  busy,
  name,
  props,
  onRoll,
  onDecide,
  onAnswer,
}: {
  room: Room;
  b: BankState;
  myTurn: boolean;
  me: number;
  busy: boolean;
  name: (i: number | undefined) => string;
  props: BankProp[];
  onRoll: () => void;
  onDecide: (choice: string) => void;
  onAnswer: (i: number) => void;
}) {
  const turn = b.turn ?? 0;
  const p = b.pending;
  const sq = p?.sq ?? b.pos?.[turn] ?? 0;
  const square = BANK_BOARD[sq];
  const price = square.t === "city" ? square.p : 0;
  const myCash = b.cash?.[me] ?? 0;
  const who = name(turn);

  if (b.phase === "roll")
    return myTurn ? (
      <>
        <Dice dice={b.dice ?? null} />
        <button onClick={onRoll} disabled={busy} className="btn-primary px-8 py-3 text-lg">
          🎲 ارمِ الزهرين
        </button>
        {b.last && <p className="text-sm text-indigo-200">{describe(b.last, name)}</p>}
      </>
    ) : (
      <>
        <Dice dice={b.dice ?? null} />
        <p className="text-lg font-black">⏳ دور {who}</p>
        {b.last && <p className="text-sm text-indigo-200">{describe(b.last, name)}</p>}
      </>
    );

  if (b.phase === "buy")
    return (
      <>
        <Dice dice={b.dice ?? null} />
        <p className="text-lg font-black">
          {myTurn ? "🏙️" : who} {myTurn ? "وصلت إلى" : "وصل إلى"} {squareName(sq)} ({money(price)})
        </p>
        {myTurn ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <button onClick={() => onDecide("buy")} disabled={busy || myCash < price} className="btn-primary">
              اشترِ بـ {money(price)}
            </button>
            <button onClick={() => onDecide("challenge")} disabled={busy} className="btn-ghost">
              ❓ تحدٍّ: صح = نصف السعر
            </button>
            <button onClick={() => onDecide("skip")} disabled={busy} className="btn-ghost">
              اتركها
            </button>
          </div>
        ) : (
          <p className="text-sm text-indigo-200">يقرر هل يشتريها...</p>
        )}
      </>
    );

  if (b.phase === "rent") {
    const rent = p?.rent ?? 0;
    return (
      <>
        <Dice dice={b.dice ?? null} />
        <p className="text-lg font-black">
          {myTurn ? "🏠 أنت في" : `${who} في`} {squareName(sq)} وهي ملك {name(p?.owner)}
        </p>
        {myTurn ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => onDecide("pay")} disabled={busy} className="btn-primary">
              ادفع الإيجار {money(rent)}
            </button>
            <button onClick={() => onDecide("challenge")} disabled={busy} className="btn-ghost">
              ❓ تحدٍّ: صح = {money(Math.floor(rent / 2))}، خطأ = {money(rent * 2)}
            </button>
          </div>
        ) : (
          <p className="text-sm text-indigo-200">الإيجار {money(rent)}، يقرر هل يدفع أم يتحدى...</p>
        )}
      </>
    );
  }

  if (b.phase === "upgrade") {
    const level = props[sq]?.lv ?? 0;
    return (
      <>
        <Dice dice={b.dice ?? null} />
        <p className="text-lg font-black">
          {myTurn ? "🏗️ أنت في مدينتك" : `${who} في مدينته`} {squareName(sq)} ({"⭐".repeat(level) || "بدون ترقية"})
        </p>
        {myTurn ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => onDecide("yes")} disabled={busy || myCash < (p?.cost ?? 0)} className="btn-primary">
              رقِّها بـ {money(p?.cost ?? 0)}
            </button>
            <button onClick={() => onDecide("no")} disabled={busy} className="btn-ghost">
              لا، شكراً
            </button>
          </div>
        ) : (
          <p className="text-sm text-indigo-200">يقرر هل يرقّيها...</p>
        )}
      </>
    );
  }

  if ((b.phase === "question" || b.phase === "reveal") && room.question) {
    const q = room.question;
    const reveal = b.phase === "reveal";
    const stake =
      p?.kind === "quiz"
        ? "صح = +150، خطأ = −50"
        : p?.kind === "buy"
          ? `صح = تشتري ${squareName(sq)} بنصف السعر`
          : `صح = إيجار ${money(Math.floor((p?.rent ?? 0) / 2))}، خطأ = ${money((p?.rent ?? 0) * 2)}`;
    return (
      <div className="space-y-3">
        <p className="text-sm text-amber-200">
          {myTurn ? "سؤالك" : `سؤال ${who}`} • {stake}
        </p>
        <p className="text-xs text-indigo-200">
          {q.icon} {q.category}
        </p>
        <h3 className="text-xl font-black leading-relaxed">{q.text}</h3>
        <div className="grid grid-cols-2 gap-2">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              disabled={!myTurn || reveal || busy}
              className={`rounded-2xl px-3 py-3 font-bold transition ${
                reveal && room.correct_index === i
                  ? "bg-emerald-500 text-white"
                  : reveal && p?.choice === i
                    ? "bg-rose-500 text-white"
                    : myTurn && !reveal
                      ? "bg-white/10 hover:bg-indigo-500/40"
                      : "bg-white/10 opacity-70"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {reveal && b.last && (
          <p className={`text-lg font-black ${p?.ok ? "text-emerald-300" : "text-rose-300"}`}>
            {describe(b.last, name)}
          </p>
        )}
      </div>
    );
  }

  return null;
}

function Dice({ dice }: { dice: [number, number] | null }) {
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  if (!dice) return <div className="text-5xl leading-none">🎲</div>;
  return (
    <div className="flex justify-center gap-2 text-5xl leading-none" dir="ltr">
      <span key={`a${dice[0]}`} className="animate-dice inline-block">
        {faces[dice[0]]}
      </span>
      <span key={`b${dice[1]}`} className="animate-dice inline-block">
        {faces[dice[1]]}
      </span>
      <span className="self-center text-lg font-black text-amber-300">= {dice[0] + dice[1]}</span>
    </div>
  );
}

// ---------- اللوحة: 24 مربعاً حول حافة شبكة 7×7 ----------

/** مكان المربع في الشبكة: البداية في الركن الأيمن السفلي، ثم يساراً، فأعلى، فيميناً، فأسفل */
function cellOf(i: number): [number, number] {
  if (i <= 6) return [6, 6 - i];
  if (i <= 12) return [6 - (i - 6), 0];
  if (i <= 18) return [0, i - 12];
  return [i - 18, 6];
}

const CORNER_ICON: Record<string, string> = { start: "🏁", oasis: "🌴", tax: "🧾", treasure: "💰", quiz: "⭐" };

function Board({
  b,
  props,
  order,
  name,
}: {
  b: BankState;
  props: BankProp[];
  order: string[];
  name: (i: number | undefined) => string;
}) {
  const pos = b.pos ?? [];
  return (
    <div className="mx-auto w-full max-w-[520px] select-none" dir="ltr">
      <div className="grid aspect-square grid-cols-7 grid-rows-7 gap-0.5 rounded-2xl bg-emerald-950 p-1 shadow-2xl">
        {BANK_BOARD.map((s, i) => {
          const [row, col] = cellOf(i);
          const pr = props[i];
          const here = order.map((_, k) => k).filter((k) => pos[k] === i && !b.out?.[k]);
          return (
            <div
              key={i}
              style={{
                gridRow: row + 1,
                gridColumn: col + 1,
                borderColor: pr?.o != null ? bankColor(pr.o) : undefined,
              }}
              className={`relative flex flex-col overflow-hidden rounded-md bg-[#f5ecd7] text-slate-900 ${
                pr?.o != null ? "border-[3px]" : "border border-black/10"
              }`}
              title={squareTitle(s, i, props, name)}
            >
              <Square s={s} level={pr?.lv ?? 0} rent={bankRent(props, i)} owned={pr?.o != null} />
              {/* القطع */}
              {here.length > 0 && (
                <div className="absolute inset-x-0 bottom-0.5 flex flex-wrap justify-center gap-0.5">
                  {here.map((k) => (
                    <span
                      key={k}
                      className={`h-2.5 w-2.5 rounded-full border border-white shadow sm:h-3.5 sm:w-3.5 ${
                        k === b.turn ? "animate-bounce" : ""
                      }`}
                      style={{ background: bankColor(k) }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {/* وسط اللوحة */}
        <div
          className="flex flex-col items-center justify-center rounded-xl bg-emerald-800/60 text-center text-white"
          style={{ gridRow: "2 / 7", gridColumn: "2 / 7" }}
        >
          <div className="text-4xl sm:text-6xl">🏙️</div>
          <p className="mt-1 text-lg font-black sm:text-2xl">إمبراطورية المدن</p>
          <p className="text-xs text-emerald-100 sm:text-sm">اشترِ، رقِّ، واجمع الإيجارات</p>
        </div>
      </div>
    </div>
  );
}

function Square({ s, level, rent, owned }: { s: BankSquare; level: number; rent: number; owned: boolean }) {
  if (s.t === "city")
    return (
      <>
        <div className="h-[18%] w-full shrink-0" style={{ background: GROUP_COLORS[s.g] }} />
        <div
          className="flex flex-1 flex-col items-center justify-start px-0.5 pt-0.5 text-center leading-tight"
          dir="rtl"
        >
          <span className="text-[min(2.3vw,11px)] font-black">{s.n}</span>
          <span className="text-[min(2vw,9px)] text-slate-600">{owned ? `إيجار ${rent}` : s.p}</span>
          {level > 0 && <span className="text-[min(2vw,9px)] leading-none">{"⭐".repeat(level)}</span>}
        </div>
      </>
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center leading-tight" dir="rtl">
      <span className="text-[min(5vw,22px)]">{CORNER_ICON[s.t]}</span>
      <span className="text-[min(2.1vw,10px)] font-bold">
        {s.t === "start"
          ? "البداية +200"
          : s.t === "quiz"
            ? "سؤال"
            : s.t === "oasis"
              ? "واحة"
              : `${s.t === "tax" ? "ضريبة" : "كنز"} ${"a" in s ? s.a : ""}`}
      </span>
    </div>
  );
}

function squareTitle(s: BankSquare, i: number, props: BankProp[], name: (i: number | undefined) => string) {
  if (s.t !== "city") return squareName(i);
  const pr = props[i];
  return pr?.o != null ? `${s.n} • ملك ${name(pr.o)} • إيجار ${bankRent(props, i)}` : `${s.n} • ${s.p}`;
}

// ---------- الأحداث ----------

function describe(e: BankEvent, name: (i: number | undefined) => string): string {
  const who = name(e.p);
  const city = e.sq != null ? squareName(e.sq) : "";
  switch (e.type) {
    case "roll":
      return `🎲 ${who} رمى ${e.dice?.[0]} و${e.dice?.[1]} ووصل إلى ${squareName(e.to ?? 0)}${
        e.start ? " (مرّ بالبداية +200)" : ""
      }`;
    case "buy":
      return `🏙️ ${who} اشترى ${city} بـ ${e.amount}`;
    case "skip":
      return `${who} ترك ${city}`;
    case "rent":
      return `🏠 ${who} دفع إيجار ${e.amount} لـ ${name(e.owner)}`;
    case "upgrade":
      return `🏗️ ${who} رقّى ${city} للمستوى ${e.level}`;
    case "quiz":
      return e.ok ? `✅ ${who} أجاب صح (+150)` : `❌ ${who} أخطأ (−50)`;
    case "buy_challenge":
      return e.ok ? `✅ ${who} أجاب صح واشترى ${city} بنصف السعر (${e.amount})` : `❌ ${who} أخطأ ولم يشترِ ${city}`;
    case "rent_challenge":
      return e.ok
        ? `✅ ${who} أجاب صح ودفع نصف الإيجار (${e.amount}) لـ ${name(e.owner)}`
        : `❌ ${who} أخطأ ودفع ضعف الإيجار (${e.amount}) لـ ${name(e.owner)}`;
    case "tax":
      return `🧾 ${who} دفع ضريبة ${e.amount}`;
    case "treasure":
      return `💰 ${who} وجد كنزاً (+${e.amount})`;
    case "bankrupt":
      return `💸 ${who} أفلس وعادت مدنه للبنك`;
  }
}

function useBankSounds(b: BankState) {
  const last = useRef(b.seq);
  useEffect(() => {
    if (b.seq === last.current) return;
    last.current = b.seq;
    const e = b.last;
    if (!e) return;
    if (e.type === "bankrupt" || e.ok === false || e.type === "tax") sounds.wrong();
    else if (e.ok || e.type === "buy" || e.type === "treasure" || e.type === "upgrade") sounds.correct();
    else sounds.tick();
  }, [b.seq, b.last]);
}

/** الترتيب النهائي بالثروة (للنتائج) */
export function bankStandings(b: BankState): { i: number; worth: number }[] {
  const order = b.players ?? [];
  const worth =
    b.result?.worth ?? order.map((_, i) => (b.out?.[i] ? 0 : bankWorth(b.cash?.[i] ?? 0, b.props ?? [], i)));
  return order.map((_, i) => ({ i, worth: worth[i] ?? 0 })).sort((a, b2) => b2.worth - a.worth);
}
