"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import {
  BANK_BOARD,
  CAR_COLORS,
  GROUP_COLORS,
  bankRent,
  bankWorth,
  buildCost,
  buildingOf,
  fullGroup,
  rentAt,
  type BankProp,
  type BankSquare,
  type Car,
} from "@/lib/bankBoard";
import type { BankEvent, BankState, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";
import { CarIcon } from "./CarIcon";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة القرار والكشف (يجب أن تطابق 0033_bank_v2.sql). السؤال بلا وقت
const DECIDE_SECONDS = 30;
const REVEAL_SECONDS = 4;

const money = (n: number) => `${n.toLocaleString("en-US")} 💵`;

/** سيارة اللاعب رقم i أثناء اللعب (أو سيارة افتراضية للغرف القديمة) */
export function carOf(b: BankState, i: number): Car {
  const cars = Array.isArray(b.cars) ? b.cars : null;
  return cars?.[i] ?? { shape: "sedan", color: CAR_COLORS[i % CAR_COLORS.length] };
}

export const bankColor = (b: BankState, i: number) => carOf(b, i).color;

const SQUARE_NAMES: Record<string, string> = {
  start: "البداية",
  quiz: "⭐ سؤال",
  oasis: "الواحة",
  tax: "الضريبة",
  treasure: "الكنز",
  jail: "السجن",
  luck: "حظك اليوم",
  court: "المحكمة",
};

const squareName = (sq: number) => {
  const s = BANK_BOARD[sq];
  return s.t === "city" ? s.n : SQUARE_NAMES[s.t];
};

const diceValue = (d: BankState["dice"]) => (Array.isArray(d) ? d[0] + d[1] : d);

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

  const total = b.phase === "reveal" ? REVEAL_SECONDS : DECIDE_SECONDS;
  const endless = !b.rounds;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-3">
      {/* اللاعبون: السيارة والنقود */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {order.map((uid, i) => {
          const out = b.out?.[i];
          const car = carOf(b, i);
          return (
            <li
              key={uid}
              className={`flex items-center gap-2 rounded-2xl border-2 px-2.5 py-1.5 text-sm ${
                i === turn && b.phase !== "done" ? "" : "border-transparent"
              } ${i === me ? "bg-white/15" : "bg-white/5"} ${out ? "opacity-40" : ""}`}
              style={i === turn && b.phase !== "done" ? { borderColor: car.color } : undefined}
            >
              <CarIcon shape={car.shape} color={car.color} size={16} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{name(i)}</span>
                <span className="block text-xs text-indigo-200" dir="ltr">
                  {out ? "💸 أفلس" : money(cash[i] ?? 0)}
                  {(b.jail?.[i] ?? 0) > 0 && " • 🔒"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <Board b={b} props={props} order={order} name={name} />

      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-sm text-indigo-200">
          {endless ? `♾️ لعب لا نهائي • الجولة ${b.round}` : `الجولة ${b.round} من ${b.rounds}`}
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
          onBuild={(sq) => act("bank_build", { p_sq: sq })}
          onDecide={(c) => act("bank_decide", { p_choice: c })}
          onAnswer={(i) => act("bank_answer", { p_choice: i })}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        {b.phase !== "done" && room.question_deadline && (
          <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
        )}
        {b.phase === "question" && <p className="text-xs text-indigo-300">⏳ السؤال مفتوح بلا وقت</p>}
      </div>

      {me >= 0 && <MyCities b={b} me={me} />}

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

// ---------- لوحة الدور: البناء والزهر والقرارات والسؤال ----------

function TurnPanel({
  room,
  b,
  myTurn,
  me,
  busy,
  name,
  props,
  onRoll,
  onBuild,
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
  onBuild: (sq: number) => void;
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
  const lastLine = b.last && <p className="text-sm text-indigo-200">{describe(b.last, name)}</p>;

  if (b.phase === "roll") {
    // المدن التي أستطيع البناء عليها: المجموعة كاملة ملكي، وأقل من سوق
    const buildable = myTurn
      ? BANK_BOARD.map((s, i) => ({ s, i })).filter(
          ({ s, i }) => s.t === "city" && props[i]?.o === me && props[i].lv < 3 && fullGroup(props, i),
        )
      : [];
    return myTurn ? (
      <>
        {lastLine}
        {buildable.length > 0 && (
          <div className="space-y-1.5 rounded-2xl bg-amber-400/10 p-3">
            <p className="text-sm font-bold text-amber-200">🏗️ ابنِ قبل أن ترمي الزهر</p>
            {buildable.map(({ s, i }) => {
              if (s.t !== "city") return null;
              const next = buildingOf(props[i].lv + 1)!;
              const cost = buildCost(s.p, next.level);
              return (
                <button
                  key={i}
                  onClick={() => onBuild(i)}
                  disabled={busy || myCash < cost}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm transition hover:bg-white/20 disabled:opacity-40"
                >
                  <span className="font-bold">
                    {next.icon} {next.name} في {s.n}
                  </span>
                  <span className="text-xs text-indigo-100">
                    {money(cost)} • الإيجار يصبح {rentAt(s.p, next.level, true)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <Die value={diceValue(b.dice)} />
        <button onClick={onRoll} disabled={busy} className="btn-primary px-8 py-3 text-lg">
          🎲 ارمِ الزهر
        </button>
      </>
    ) : (
      <>
        <Die value={diceValue(b.dice)} />
        <p className="text-lg font-black">⏳ دور {who}</p>
        {lastLine}
      </>
    );
  }

  if (b.phase === "buy")
    return (
      <>
        <Die value={diceValue(b.dice)} />
        <p className="text-lg font-black">
          {myTurn ? "🏙️ وصلت إلى" : `${who} وصل إلى`} {squareName(sq)} ({money(price)})
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
    const lv = props[sq]?.lv ?? 0;
    const building = buildingOf(lv);
    return (
      <>
        <Die value={diceValue(b.dice)} />
        <p className="text-lg font-black">
          {myTurn ? "🏠 أنت في" : `${who} في`} {squareName(sq)} وهي ملك {name(p?.owner)}
          {building && ` (${building.icon} ${building.name})`}
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

/** زهر واحد */
function Die({ value }: { value: number | null | undefined }) {
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  if (!value) return <div className="text-5xl leading-none">🎲</div>;
  return (
    <div key={value} className="animate-dice text-6xl leading-none">
      {faces[value] ?? value}
    </div>
  );
}

// ---------- مدني: الإيجار الحالي والمبنى التالي ----------

function MyCities({ b, me }: { b: BankState; me: number }) {
  const props = b.props ?? [];
  const mine = BANK_BOARD.map((s, i) => ({ s, i })).filter(({ i }) => props[i]?.o === me);
  if (mine.length === 0) return null;
  return (
    <details className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <summary className="cursor-pointer font-black text-amber-300">🏙️ مدني ({mine.length})</summary>
      <ul className="mt-2 space-y-1.5">
        {mine.map(({ s, i }) => {
          if (s.t !== "city") return null;
          const lv = props[i].lv;
          const full = fullGroup(props, i);
          const next = buildingOf(lv + 1);
          return (
            <li key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: GROUP_COLORS[s.g] }} />
              <span className="flex-1 font-bold">
                {s.n} {buildingOf(lv)?.icon}
              </span>
              <span className="text-xs text-indigo-200">
                إيجار {bankRent(props, i)}
                {next &&
                  (full ? ` • ${next.icon} ${next.name} بـ ${buildCost(s.p, next.level)}` : " • اجمع المجموعة لتبني")}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ---------- اللوحة: 28 مربعاً حول حافة شبكة 8×8 ----------

/** مكان المربع في الشبكة: البداية في الركن الأيمن السفلي، ثم يساراً، فأعلى، فيميناً، فأسفل */
function cellOf(i: number): [number, number] {
  if (i <= 7) return [7, 7 - i];
  if (i <= 14) return [7 - (i - 7), 0];
  if (i <= 21) return [0, i - 14];
  return [i - 21, 7];
}

const SQUARE_ICON: Record<string, string> = {
  start: "🏁",
  oasis: "🌴",
  tax: "🧾",
  treasure: "💰",
  quiz: "⭐",
  jail: "🔒",
  luck: "🍀",
  court: "⚖️",
};

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
    <div className="mx-auto w-full max-w-[560px] select-none" dir="ltr">
      <div className="grid aspect-square grid-cols-8 grid-rows-8 gap-0.5 rounded-2xl bg-emerald-950 p-1 shadow-2xl">
        {BANK_BOARD.map((s, i) => {
          const [row, col] = cellOf(i);
          const pr = props[i];
          const here = order.map((_, k) => k).filter((k) => pos[k] === i && !b.out?.[k]);
          const ownerColor = pr?.o != null ? bankColor(b, pr.o) : undefined;
          return (
            <div
              key={i}
              style={{ gridRow: row + 1, gridColumn: col + 1, borderColor: ownerColor }}
              className={`relative flex flex-col overflow-hidden rounded-md bg-[#f5ecd7] text-slate-900 ${
                pr?.o != null ? "border-[3px]" : "border border-black/10"
              }`}
              title={squareTitle(s, i, props, name)}
            >
              <Square s={s} level={pr?.lv ?? 0} rent={bankRent(props, i)} owned={pr?.o != null} />
              {/* السيارات */}
              {here.length > 0 && (
                <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-center">
                  {here.map((k) => {
                    const car = carOf(b, k);
                    return (
                      <span
                        key={k}
                        className={k === b.turn && b.phase !== "done" ? "animate-bounce" : ""}
                        style={{ marginInline: here.length > 1 ? -4 : 0 }}
                      >
                        <CarIcon shape={car.shape} color={car.color} size={here.length > 2 ? 9 : 12} />
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {/* وسط اللوحة */}
        <div
          className="flex flex-col items-center justify-center rounded-xl bg-emerald-800/60 text-center text-white"
          style={{ gridRow: "2 / 8", gridColumn: "2 / 8" }}
        >
          <div className="text-4xl sm:text-6xl">🏙️</div>
          <p className="mt-1 text-lg font-black sm:text-2xl">إمبراطورية المدن</p>
          <p className="px-2 text-[11px] text-emerald-100 sm:text-sm">
            اجمع المجموعة، ابنِ 🅿️ ← 🏨 ← 🏬، واحذر ⚖️ المحكمة
          </p>
          <div className="mt-2 text-5xl sm:text-6xl">
            {b.dice ? ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][diceValue(b.dice) ?? 0] : "🎲"}
          </div>
        </div>
      </div>
    </div>
  );
}

function Square({ s, level, rent, owned }: { s: BankSquare; level: number; rent: number; owned: boolean }) {
  if (s.t === "city")
    return (
      <>
        <div className="h-[16%] w-full shrink-0" style={{ background: GROUP_COLORS[s.g] }} />
        <div
          className="flex flex-1 flex-col items-center justify-start px-0.5 pt-0.5 text-center leading-tight"
          dir="rtl"
        >
          <span className="text-[min(2vw,10px)] font-black">{s.n}</span>
          <span className="text-[min(1.8vw,8px)] text-slate-600">{owned ? `إيجار ${rent}` : s.p}</span>
          {level > 0 && <span className="text-[min(2.6vw,12px)] leading-none">{buildingOf(level)?.icon}</span>}
        </div>
      </>
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center leading-tight" dir="rtl">
      <span className="text-[min(4.4vw,20px)]">{SQUARE_ICON[s.t]}</span>
      <span className="text-[min(1.9vw,9px)] font-bold">
        {s.t === "start"
          ? "+200"
          : s.t === "tax" || s.t === "treasure"
            ? `${s.t === "tax" ? "ضريبة" : "كنز"} ${s.a}`
            : SQUARE_NAMES[s.t].replace("⭐ ", "")}
      </span>
    </div>
  );
}

function squareTitle(s: BankSquare, i: number, props: BankProp[], name: (i: number | undefined) => string) {
  if (s.t !== "city") return squareName(i);
  const pr = props[i];
  const building = buildingOf(pr?.lv ?? 0);
  return pr?.o != null
    ? `${s.n} • ملك ${name(pr.o)}${building ? ` • ${building.name}` : ""} • إيجار ${bankRent(props, i)}`
    : `${s.n} • ${s.p}`;
}

// ---------- الأحداث ----------

const CARD_TEXT: Record<string, string> = {
  prize: "ربحت جائزة",
  bonus: "مكافأة من البنك",
  dividend: "أرباح أسهم",
  birthday: "عيد ميلادك! كل لاعب أهداك 20",
  to_start: "تقدّم إلى البداية",
  forward3: "تقدّم 3 خطوات",
  back2: "ارجع خطوتين",
  oasis: "رحلة إلى الواحة",
  fine50: "مخالفة مرور",
  fine100: "غرامة المحكمة",
  fine150: "غرامة كبيرة",
  pay_all: "تعويض: ادفع لكل لاعب 25",
  jail: "حُكم عليك بالسجن 🔒",
  acquit: "براءة! تعويض",
};

const GAIN_CARDS = ["prize", "bonus", "dividend", "birthday", "acquit"];

function describe(e: BankEvent, name: (i: number | undefined) => string): string {
  const who = name(e.p);
  const city = e.sq != null ? squareName(e.sq) : "";
  switch (e.type) {
    case "roll":
      return Array.isArray(e.dice)
        ? `🎲 ${who} رمى ${e.dice[0]} و${e.dice[1]} ووصل إلى ${squareName(e.to ?? 0)}`
        : `🎲 ${who} رمى ${e.dice} ووصل إلى ${squareName(e.to ?? 0)}`;
    case "pass_start":
      return `🏁 ${who} مرّ بالبداية (+${e.amount})`;
    case "buy":
      return `🏙️ ${who} اشترى ${city} بـ ${e.amount}${e.full ? " واكتملت مجموعته! يستطيع البناء الآن 🏗️" : ""}`;
    case "skip":
      return `${who} ترك ${city}`;
    case "rent":
      return `🏠 ${who} دفع إيجار ${e.amount} لـ ${name(e.owner)}`;
    case "build": {
      const bld = buildingOf(e.level ?? 0);
      return `🏗️ ${who} بنى ${bld?.icon} ${bld?.name} في ${city} بـ ${e.amount}`;
    }
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
    case "card": {
      const icon = e.kind === "court" ? "⚖️" : "🍀";
      const text = CARD_TEXT[e.card ?? ""] ?? "";
      const amount = e.amount ? ` (${GAIN_CARDS.includes(e.card ?? "") ? "+" : "−"}${e.amount})` : "";
      return `${icon} ${e.kind === "court" ? "المحكمة" : "حظك اليوم"} لـ ${who}: ${text}${amount}`;
    }
    case "jail":
      return `🔒 ${who} دخل السجن ويفوته دوره القادم`;
    case "jail_skip":
      return `🔒 ${who} في السجن، فاته الدور`;
    case "bankrupt":
      return `💸 ${who} أفلس وعادت مدنه للبنك`;
    case "left":
      return `🚪 ${who} خرج من اللعبة وعادت مدنه للبنك`;
  }
}

function useBankSounds(b: BankState) {
  const last = useRef(b.seq);
  useEffect(() => {
    if (b.seq === last.current) return;
    last.current = b.seq;
    const e = b.last;
    if (!e) return;
    const loss =
      e.type === "bankrupt" ||
      e.type === "jail" ||
      e.ok === false ||
      e.type === "tax" ||
      (e.type === "card" && !GAIN_CARDS.includes(e.card ?? ""));
    if (loss) sounds.wrong();
    else if (e.ok || e.type === "buy" || e.type === "treasure" || e.type === "build" || e.type === "card")
      sounds.correct();
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
