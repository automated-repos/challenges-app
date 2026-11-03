"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import type { Player, Room } from "@/lib/types";
import { Avatar, ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Answer {
  user_id: string;
  cat: number;
  answer: string;
  points: number;
}
/** قرار صاحب الغرفة في كلمة (لا يوجد = الفحص التلقائي) */
interface Mark {
  user_id: string;
  cat: number;
  valid: boolean;
}

// نفس توحيد الكتابة في قاعدة البيانات (_ar_norm و _ar_starts)، للتنبيه فقط
const norm = (s: string) =>
  s
    .trim()
    .replace(/[ً-ْـ\s]+/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
const stripAl = (s: string) => (s.length > 3 && s.startsWith("ال") ? s.slice(2) : s);
export function startsWith(word: string, letter: string) {
  const w = norm(word);
  const l = norm(letter);
  return w.length >= 2 && (w[0] === l || stripAl(w)[0] === l);
}

/** أتوبيس كومبليت: مراحل الجولة (كتابة ← مراجعة صاحب الغرفة ← نتيجة) */
export function StopGame({
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
  const left = msLeft(room.question_deadline, now);
  const total = room.status === "writing" ? room.question_seconds : 10;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-400 text-4xl font-black text-black shadow-lg">
          {room.stop_letter}
        </div>
        <div className="flex-1">
          <p className="text-sm text-indigo-200">
            🚌 الجولة {room.current_index + 1} من {room.total_questions}
          </p>
          <p className="text-lg font-bold">
            {room.status === "writing"
              ? `اكتب كلمات تبدأ بحرف «${room.stop_letter}»`
              : room.status === "voting"
                ? isHost
                  ? "⚖️ صحّح الكلمات"
                  : "⚖️ صاحب الغرفة يصحح الكلمات"
                : "📊 نتيجة الجولة"}
          </p>
        </div>
        {isHost && <HostButtons room={room} call={call} />}
        {/* المراجعة بلا وقت: صاحب الغرفة ينهيها */}
        {room.status === "voting" ? (
          isHost ? (
            <button onClick={() => call("skip_question").catch(() => {})} className="btn-primary w-full py-3 text-lg">
              ✅ إنهاء التصحيح وحساب النقاط
            </button>
          ) : (
            <p className="w-full text-center text-sm text-indigo-200">⏳ بانتظار صاحب الغرفة لإنهاء التصحيح</p>
          )
        ) : (
          <div className="w-full">
            <TimerBar seconds={left} total={total} />
          </div>
        )}
      </header>

      {room.status === "writing" && (
        <Writing key={`w${room.current_index}`} room={room} players={players} userId={userId} call={call} />
      )}
      {(room.status === "voting" || room.status === "round_end") && (
        <Review
          key={`r${room.current_index}`}
          room={room}
          players={players}
          userId={userId}
          isHost={isHost}
          call={call}
        />
      )}
    </section>
  );
}

function HostButtons({ room, call }: { room: Room; call: Call }) {
  return (
    <div className="flex gap-2">
      <button onClick={() => call("skip_question").catch(() => {})} className="btn-ghost">
        {room.status === "writing"
          ? "إنهاء الكتابة ⏭️"
          : room.status === "voting"
            ? "إنهاء التصحيح ⏭️"
            : "الجولة التالية ⏭️"}
      </button>
      <button
        onClick={() => {
          if (confirm("إنهاء اللعبة الآن؟")) call("end_game").catch(() => {});
        }}
        className="btn-ghost"
      >
        🏁
      </button>
    </div>
  );
}

function Writing({ room, players, userId, call }: { room: Room; players: Player[]; userId: string; call: Call }) {
  const cats = room.stop_categories ?? [];
  const letter = room.stop_letter ?? "";
  const [answers, setAnswers] = useState<string[]>(() => cats.map(() => ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const latest = useRef(answers);
  useEffect(() => {
    latest.current = answers;
  }, [answers]);

  const stopper = room.buzzed_by ? players.find((p) => p.user_id === room.buzzed_by) : null;
  const locked = !!room.buzzed_by;

  // استرجاع ما كتبته (لو أعدت تحميل الصفحة)
  useEffect(() => {
    getSupabase()
      .from("stop_answers")
      .select("cat, answer")
      .eq("room_id", room.id)
      .eq("round", room.current_index)
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!data?.length || dirty.current) return;
        const next = cats.map(() => "");
        for (const a of data as { cat: number; answer: string }[]) next[a.cat] = a.answer;
        setAnswers(next);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مرة واحدة لكل جولة
  }, []);

  const save = useCallback(
    async (stop = false) => {
      dirty.current = false;
      await call("submit_stop", { p_answers: latest.current, p_stop: stop });
    },
    [call],
  );

  // حفظ تلقائي بعد التوقف عن الكتابة
  useEffect(() => {
    if (!dirty.current || locked) return;
    const id = setTimeout(() => save().catch(() => {}), 1200);
    return () => clearTimeout(id);
  }, [answers, locked, save]);

  // أحدهم ضغط ستوب: أرسل ما كتبته فوراً
  useEffect(() => {
    if (locked && room.buzzed_by !== userId) save().catch(() => {});
  }, [locked, room.buzzed_by, userId, save]);

  const complete = answers.every((a) => startsWith(a, letter));

  async function stop() {
    setBusy(true);
    setError("");
    try {
      await save(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
      {stopper && (
        <p className="animate-pop rounded-2xl bg-rose-500/20 p-3 text-center text-lg font-black text-rose-100">
          🛑 {stopper.avatar} {stopper.name} قال ستوب!
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {cats.map((c, i) => {
          const v = answers[i];
          const ok = startsWith(v, letter);
          return (
            <label key={c} className="block">
              <span className="mb-1 block text-sm font-bold text-indigo-200">{c}</span>
              <input
                value={v}
                readOnly={locked}
                maxLength={40}
                onChange={(e) => {
                  dirty.current = true;
                  const next = [...answers];
                  next[i] = e.target.value;
                  setAnswers(next);
                }}
                placeholder={`${letter}...`}
                className={`input ${v && !ok ? "border-amber-400/70" : ""} ${ok ? "border-emerald-400/60" : ""}`}
              />
              {v && !ok && <span className="text-xs text-amber-300">يجب أن تبدأ بحرف «{letter}»</span>}
            </label>
          );
        })}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button
        onClick={stop}
        disabled={!complete || locked || busy}
        className="w-full rounded-2xl bg-linear-to-b from-rose-500 to-rose-700 py-4 text-2xl font-black shadow-lg transition active:translate-y-1 disabled:opacity-40"
      >
        {busy ? "..." : "🚌 ستوب! (كومبليت)"}
      </button>
      {!complete && !locked && (
        <p className="text-center text-xs text-indigo-300">املأ كل الخانات بكلمات تبدأ بالحرف ليتفعّل الزر</p>
      )}
    </div>
  );
}

/** التصحيح ونتيجة الجولة: إجابات الجميع في كل خانة، وصاحب الغرفة يقبل أو يرفض */
function Review({
  room,
  players,
  userId,
  isHost,
  call,
}: {
  room: Room;
  players: Player[];
  userId: string;
  isHost: boolean;
  call: Call;
}) {
  const cats = room.stop_categories ?? [];
  const letter = room.stop_letter ?? "";
  const voting = room.status === "voting";
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [a, v] = await Promise.all([
      sb
        .from("stop_answers")
        .select("user_id, cat, answer, points")
        .eq("room_id", room.id)
        .eq("round", room.current_index),
      sb.from("stop_marks").select("user_id, cat, valid").eq("room_id", room.id).eq("round", room.current_index),
    ]);
    if (a.data) setAnswers(a.data as Answer[]);
    if (v.data) setMarks(v.data as Mark[]);
  }, [room.id, room.current_index]);

  // تحديث كل ثانيتين أثناء التصحيح (ليرى الجميع قرارات صاحب الغرفة)، ومرة عند ظهور النتيجة
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- مزامنة مع القاعدة
    load();
    if (!voting) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load, voting, room.status]);

  /** صاحب الغرفة يقلب حكم الكلمة. إن طابق الحكم الجديد الفحص التلقائي يُحذف القرار */
  async function judge(owner: string, cat: number, valid: boolean, auto: boolean) {
    setError("");
    const mark = valid === auto ? null : valid;
    setMarks((ms) => [
      ...ms.filter((m) => !(m.user_id === owner && m.cat === cat)),
      ...(mark == null ? [] : [{ user_id: owner, cat, valid: mark }]),
    ]);
    try {
      await call("stop_mark", { p_user: owner, p_cat: cat, p_valid: mark });
    } catch (e) {
      setError(errorMessage(e));
      load();
    }
  }

  const sorted = [...players].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const roundTotal = (u: string) => answers.filter((a) => a.user_id === u).reduce((s, a) => s + a.points, 0);

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      {!voting && (
        <div className="flex flex-wrap gap-2 rounded-3xl border border-white/10 bg-white/5 p-3">
          {[...sorted]
            .sort((a, b) => roundTotal(b.user_id) - roundTotal(a.user_id))
            .map((p) => (
              <span key={p.user_id} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm">
                {p.avatar} {p.name}
                <b dir="ltr" className="text-emerald-300">
                  +{roundTotal(p.user_id)}
                </b>
              </span>
            ))}
        </div>
      )}
      {cats.map((c, ci) => (
        <div key={c} className="rounded-3xl border border-white/10 bg-white/5 p-3">
          <h3 className="mb-2 font-bold text-indigo-200">{c}</h3>
          <ul className="space-y-1.5">
            {sorted.map((p) => {
              const a = answers.find((x) => x.user_id === p.user_id && x.cat === ci);
              const word = a?.answer?.trim() ?? "";
              const auto = !!word && startsWith(word, letter);
              const mark = marks.find((m) => m.user_id === p.user_id && m.cat === ci);
              const valid = !!word && (mark ? mark.valid : auto);
              const mine = p.user_id === userId;
              return (
                <li
                  key={p.user_id}
                  className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${
                    mine ? "bg-indigo-500/20" : "bg-black/15"
                  } ${word && !valid ? "opacity-60" : ""}`}
                >
                  <Avatar emoji={p.avatar} size="sm" />
                  <span className="w-20 truncate text-xs text-indigo-200 sm:w-28">{p.name}</span>
                  <span className={`flex-1 truncate font-bold ${word && !valid ? "line-through" : ""}`}>
                    {word || <span className="font-normal text-white/30">—</span>}
                  </span>
                  {word && !valid && <span className="text-xs text-amber-300">{mark ? "رفضها الحكم" : "حرف خطأ"}</span>}
                  {word && valid && mark && <span className="text-xs text-emerald-300">قبلها الحكم</span>}
                  {voting && isHost && word && (
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur();
                        judge(p.user_id, ci, !valid, auto);
                      }}
                      className={`rounded-lg px-2 py-1 text-xs font-bold ${
                        valid ? "bg-white/10 hover:bg-rose-500/40" : "bg-emerald-600/60 hover:bg-emerald-500"
                      }`}
                    >
                      {valid ? "❌ رفض" : "✅ قبول"}
                    </button>
                  )}
                  {!voting && (
                    <b
                      dir="ltr"
                      className={`w-10 text-left tabular-nums ${a?.points ? "text-emerald-300" : "text-white/40"}`}
                    >
                      +{a?.points ?? 0}
                    </b>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {voting && (
        <p className="text-center text-xs text-indigo-300">
          {isHost
            ? "الكلمات التي تبدأ بالحرف مقبولة تلقائياً. ارفض الخطأ، أو اقبل كلمة رفضها الفحص التلقائي."
            : "صاحب الغرفة يقبل الكلمات أو يرفضها."}{" "}
          الكلمة الوحيدة في خانتها = 20، غير المكررة = 10، المكررة = 5.
        </p>
      )}
    </div>
  );
}
