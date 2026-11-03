"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import type { Player, Room, SpyState } from "@/lib/types";
import { Avatar, ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Card {
  round: number;
  category: string;
  spy: boolean;
  word: string | null;
  partners: number | null;
}

// مدة المراحل بالثواني (يجب أن تطابق 0023_spy.sql)
const GUESS_SECONDS = 25;
const ROUND_END_SECONDS = 12;

export function SpyGame({
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
  const s = room.spy!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useCard(room.id, s.round ?? 0);
  useSpySounds(s);

  const player = (uid: string | null | undefined) => players.find((p) => p.user_id === uid);
  const label = (uid: string | null | undefined) => {
    const p = player(uid);
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

  const total =
    s.phase === "hints"
      ? room.question_seconds
      : s.phase === "voting"
        ? room.answer_seconds
        : s.phase === "guess"
          ? GUESS_SECONDS
          : ROUND_END_SECONDS;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-indigo-200">
        <span>
          🕵️ الجولة {s.round} من {room.total_questions}
        </span>
        <span>
          المجال: <b className="text-white">{s.category}</b>
        </span>
        {s.phase === "hints" && s.hint_rounds > 1 && (
          <span>
            دورة التلميح {s.hint_round} من {s.hint_rounds}
          </span>
        )}
        {(s.spy_count ?? 1) > 1 && <span>👥 جاسوسان هذه الجولة</span>}
      </div>

      <SecretCard card={card} />

      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        {s.phase === "hints" && (
          <Hints s={s} userId={userId} label={label} busy={busy} onHint={(t) => act("spy_hint", { p_text: t })} />
        )}
        {s.phase === "voting" && (
          <Voting
            s={s}
            players={players}
            userId={userId}
            busy={busy}
            onVote={(u) => act("spy_vote", { p_target: u })}
          />
        )}
        {s.phase === "guess" && (
          <Guess s={s} userId={userId} label={label} busy={busy} onGuess={(w) => act("spy_guess", { p_word: w })} />
        )}
        {s.phase === "round_end" && <RoundEnd s={s} userId={userId} label={label} />}
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      {s.phase !== "hints" && (s.hints?.length ?? 0) > 0 && <HintList s={s} label={label} />}

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

/** بطاقتي السرية: مخفية حتى أضغط (حتى لا يراها من بجانبي) */
function SecretCard({ card }: { card: Card | null }) {
  const [open, setOpen] = useState(false);
  // جولة جديدة: البطاقة تُغلق من جديد
  const [round, setRound] = useState(card?.round);
  if (round !== card?.round) {
    setRound(card?.round);
    setOpen(false);
  }

  if (!card) return <div className="rounded-3xl bg-white/5 p-6 text-center text-indigo-200">جارٍ تحميل بطاقتك...</div>;
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className={`w-full rounded-3xl border-2 p-5 text-center transition ${
        !open
          ? "border-dashed border-white/25 bg-white/5 hover:bg-white/10"
          : card.spy
            ? "border-rose-400/60 bg-rose-500/20"
            : "border-emerald-400/60 bg-emerald-500/15"
      }`}
    >
      {!open ? (
        <>
          <div className="text-5xl">🃏</div>
          <p className="mt-2 text-lg font-black">اضغط لرؤية بطاقتك</p>
          <p className="text-xs text-indigo-200">لا تدع أحداً يرى شاشتك</p>
        </>
      ) : card.spy ? (
        <>
          <div className="text-5xl">🕵️</div>
          <p className="mt-1 text-3xl font-black text-rose-200">أنت الجاسوس!</p>
          <p className="mt-1 text-sm text-indigo-100">
            المجال: <b>{card.category}</b>. لا تعرف الكلمة؛ استمع للتلميحات وتظاهر أنك تعرفها
            {card.partners ? " (معك جاسوس آخر لا تعرفه)" : ""}.
          </p>
          <p className="mt-1 text-xs text-indigo-300">اضغط لإخفاء البطاقة</p>
        </>
      ) : (
        <>
          <p className="text-sm text-indigo-200">الكلمة السرية ({card.category})</p>
          <p className="my-1 text-4xl font-black text-emerald-200">{card.word}</p>
          <p className="text-sm text-indigo-100">لمّح لها بذكاء حتى لا يعرفها الجاسوس</p>
          <p className="mt-1 text-xs text-indigo-300">اضغط لإخفاء البطاقة</p>
        </>
      )}
    </button>
  );
}

function Hints({
  s,
  userId,
  label,
  busy,
  onHint,
}: {
  s: SpyState;
  userId: string;
  label: (uid: string | null | undefined) => string;
  busy: boolean;
  onHint: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const order = s.order ?? [];
  const current = order[s.turn ?? 0];
  const myTurn = current === userId;

  return (
    <div className="space-y-3">
      <p className="text-center text-lg font-black">
        {myTurn ? "💬 دورك! لمّح للكلمة" : `⏳ دور ${label(current)} للتلميح`}
      </p>
      {myTurn && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onHint(text);
            setText("");
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={60}
            placeholder="اكتب تلميحك (كلمة أو جملة قصيرة)"
            className="input min-w-0 flex-1"
            autoFocus
          />
          <button disabled={busy || !text.trim()} className="btn-primary">
            إرسال
          </button>
          <button type="button" disabled={busy} onClick={() => onHint("")} className="btn-ghost w-full sm:w-auto">
            🎤 قلتها في الصوت
          </button>
        </form>
      )}
      <ol className="space-y-1.5">
        {order.map((uid, i) => {
          const mine = (s.hints ?? []).filter((h) => h.u === uid);
          const active = i === s.turn;
          return (
            <li
              key={uid}
              className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                active ? "bg-amber-400/20 ring-2 ring-amber-300" : "bg-black/15"
              } ${uid === userId ? "font-bold" : ""}`}
            >
              <span className="w-28 truncate">{label(uid)}</span>
              {mine.map((h, k) => (
                <span key={k} className="rounded-full bg-white/10 px-2.5 py-0.5">
                  {h.t || (h.timeout ? "⏰ فات دوره" : "🎤 قالها في الصوت")}
                </span>
              ))}
              {active && <span className="animate-pulse text-amber-200">✍️</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** كل التلميحات (للرجوع إليها أثناء التصويت والتخمين) */
function HintList({ s, label }: { s: SpyState; label: (uid: string | null | undefined) => string }) {
  const order = s.order ?? [];
  return (
    <div className="space-y-1.5 rounded-3xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-black text-amber-300">💬 التلميحات</h3>
      {order.map((uid) => (
        <div key={uid} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 truncate text-indigo-200">{label(uid)}</span>
          {(s.hints ?? [])
            .filter((h) => h.u === uid)
            .map((h, k) => (
              <span key={k} className="rounded-full bg-white/10 px-2.5 py-0.5">
                {h.t || (h.timeout ? "⏰" : "🎤")}
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

function Voting({
  s,
  players,
  userId,
  busy,
  onVote,
}: {
  s: SpyState;
  players: Player[];
  userId: string;
  busy: boolean;
  onVote: (uid: string) => void;
}) {
  // اختياري يظهر عندي فقط (الأصوات مخفية حتى نهاية الجولة)
  const [choice, setChoice] = useState<string | null>(null);
  const voted = new Set(s.voted ?? []);
  const sorted = [...players].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return (
    <div className="space-y-3">
      <p className="text-center text-lg font-black">🗳️ من الجاسوس؟</p>
      <p className="text-center text-xs text-indigo-200">
        صوّت على من تشك فيه (يمكنك تغيير صوتك حتى ينتهي الوقت). صوّت {voted.size} من {players.length}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sorted.map((p) => {
          const me = p.user_id === userId;
          return (
            <button
              key={p.user_id}
              disabled={me || busy}
              onClick={() => {
                setChoice(p.user_id);
                onVote(p.user_id);
              }}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-start transition ${
                choice === p.user_id
                  ? "border-rose-400 bg-rose-500/30"
                  : "border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-50"
              }`}
            >
              <Avatar emoji={p.avatar} size="sm" />
              <span className="flex-1 truncate font-bold">
                {p.name}
                {me && " (أنت)"}
              </span>
              {voted.has(p.user_id) && <span title="صوّت">✅</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Guess({
  s,
  userId,
  label,
  busy,
  onGuess,
}: {
  s: SpyState;
  userId: string;
  label: (uid: string | null | undefined) => string;
  busy: boolean;
  onGuess: (word: string) => void;
}) {
  const accused = s.accused === userId;
  return (
    <div className="space-y-3 text-center">
      <p className="text-lg font-black">
        {accused ? "😱 كشفوك! خمّن الكلمة لتنجو" : `🎯 ${label(s.accused)} هو الجاسوس! يحاول تخمين الكلمة...`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(s.options ?? []).map((w) => (
          <button
            key={w}
            disabled={!accused || busy}
            onClick={() => onGuess(w)}
            className={`rounded-2xl px-3 py-3 font-bold transition ${
              accused ? "bg-white/10 hover:bg-indigo-500/40" : "bg-white/10 opacity-70"
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundEnd({
  s,
  userId,
  label,
}: {
  s: SpyState;
  userId: string;
  label: (uid: string | null | undefined) => string;
}) {
  const r = s.result;
  if (!r) return null;
  const spyWon = r.winner === "spies";
  const iAmSpy = r.spies.includes(userId);
  const won = spyWon === iAmSpy;
  return (
    <div className="space-y-3 text-center">
      <div className="text-5xl">{spyWon ? "🕵️" : "🎉"}</div>
      <p className={`text-2xl font-black ${spyWon ? "text-rose-200" : "text-emerald-200"}`}>
        {!r.caught
          ? r.accused
            ? `❌ ${label(r.accused)} بريء! الجاسوس نجا`
            : "🤷 لم يُكشف أحد، الجاسوس نجا"
          : r.guessed
            ? `😎 كُشف الجاسوس لكنه خمّن الكلمة!`
            : "✅ كُشف الجاسوس وفشل في التخمين!"}
      </p>
      <p className="text-sm text-indigo-100">{won ? "🏆 فزت هذه الجولة" : "حظ أوفر في الجولة القادمة 💪"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-emerald-500/15 p-3">
          <p className="text-xs text-indigo-200">الكلمة ({r.category})</p>
          <p className="text-2xl font-black">{r.word}</p>
          {r.guess && <p className="text-xs text-indigo-200">تخمين الجاسوس: {r.guess}</p>}
        </div>
        <div className="rounded-2xl bg-rose-500/15 p-3">
          <p className="text-xs text-indigo-200">{r.spies.length > 1 ? "الجاسوسان" : "الجاسوس"}</p>
          <p className="text-lg font-black">{r.spies.map(label).join("، ")}</p>
        </div>
      </div>
      {Object.keys(r.votes).length > 0 && (
        <div className="rounded-2xl bg-black/20 p-3 text-start text-sm">
          <p className="mb-1 font-bold text-indigo-200">🗳️ الأصوات</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {Object.entries(r.votes).map(([voter, target]) => (
              <li key={voter}>
                {label(voter)} ← <b className={r.spies.includes(target) ? "text-emerald-300" : ""}>{label(target)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-indigo-300">الجاسوس الناجي +30 • الجاسوس الذي خمّن +20 • من صوّت على الجاسوس +10</p>
    </div>
  );
}

/** بطاقتي من القاعدة (تُجلب عند كل جولة جديدة) */
function useCard(roomId: string, round: number): Card | null {
  const [card, setCard] = useState<Card | null>(null);
  useEffect(() => {
    if (!round) return;
    let alive = true;
    getSupabase()
      .rpc("spy_my_card", { p_room: roomId })
      .then(({ data }) => {
        if (alive && data) setCard(data as Card);
      });
    return () => {
      alive = false;
    };
  }, [roomId, round]);
  return card && card.round === round ? card : null;
}

function useSpySounds(s: SpyState) {
  const last = useRef(s.seq);
  const phase = useRef(s.phase);
  useEffect(() => {
    if (s.seq === last.current) return;
    last.current = s.seq;
    const changed = phase.current !== s.phase;
    phase.current = s.phase;
    if (s.phase === "round_end" && changed) {
      if (s.result?.winner === "town") sounds.correct();
      else sounds.wrong();
    } else if (changed) sounds.buzz();
    else sounds.tick();
  }, [s.seq, s.phase, s.result?.winner]);
}
