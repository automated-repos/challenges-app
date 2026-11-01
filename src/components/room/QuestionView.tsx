"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];

export function QuestionView({
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
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState("");
  useEventSounds(room, userId);

  const q = room.question;
  const isReveal = room.status === "reveal";
  const iBuzzed = room.buzzed_by === userId;
  // في وضع الفرق: من انضم بعد البدء بدون فريق يشاهد فقط
  const spectator = room.team_size != null && players.find((p) => p.user_id === userId)?.team == null;
  const lockedOut = spectator || room.locked_out.includes(userId);
  const nameOf = (id?: string | null) => {
    const p = players.find((x) => x.user_id === id);
    return p ? `${p.avatar} ${p.name}` : "متسابق";
  };

  const questionLeft = msLeft(room.question_deadline, now);
  const answerLeft = msLeft(room.buzz_deadline, now);
  const revealLeft = msLeft(room.reveal_until, now);
  const canBuzz =
    !isReveal && !room.buzzed_by && !lockedOut && questionLeft > 0;

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }, []);

  const buzz = useCallback(async () => {
    if (!canBuzz || pending) return;
    setPending(true);
    sounds.buzz();
    try {
      const won = await call("buzz");
      if (!won) showFlash("سبقك متسابق آخر!");
    } catch (e) {
      showFlash(errorMessage(e));
    } finally {
      setPending(false);
    }
  }, [canBuzz, pending, call, showFlash]);

  const choose = useCallback(
    async (i: number) => {
      if (!iBuzzed || pending || room.wrong_choices.includes(i)) return;
      setPending(true);
      try {
        await call("answer", { p_choice: i });
      } catch (e) {
        showFlash(errorMessage(e));
      } finally {
        setPending(false);
      }
    },
    [iBuzzed, pending, room.wrong_choices, call, showFlash],
  );

  // المسافة أو Enter للضغط، والأرقام 1-4 لاختيار الإجابة
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        buzz();
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 6) choose(n - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buzz, choose]);

  if (!q) return null;
  const ev = room.last_event;
  const isLast = room.current_index + 1 >= room.total_questions;

  return (
    <section className="space-y-3 pb-52 sm:space-y-5 sm:pb-0">
      {/* رأس السؤال */}
      <div className="flex items-center justify-between text-sm text-indigo-200">
        <span className="rounded-full bg-white/10 px-3 py-1">
          {q.icon} {q.category}
        </span>
        <span>
          سؤال {room.current_index + 1} من {room.total_questions}
        </span>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-center shadow-xl sm:p-6">
        <h2 className="text-xl leading-relaxed font-bold sm:text-3xl">
          {q.text}
        </h2>
      </div>

      {/* الخيارات */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {q.options.map((opt, i) => {
          const wrong = room.wrong_choices.includes(i);
          const correct = isReveal && room.correct_index === i;
          const clickable = iBuzzed && !wrong && !pending;
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={!clickable}
              className={`flex items-center gap-2 rounded-2xl border-2 px-2.5 py-3 text-right text-sm font-semibold transition sm:gap-3 sm:px-4 sm:py-4 sm:text-lg ${
                correct
                  ? "animate-pop border-emerald-400 bg-emerald-500/30"
                  : wrong
                    ? "border-red-500/50 bg-red-500/15 text-red-200 line-through opacity-70"
                    : isReveal
                      ? "border-white/5 bg-white/5 opacity-50"
                      : clickable
                        ? "cursor-pointer border-indigo-400 bg-indigo-500/20 hover:bg-indigo-500/40"
                        : "border-white/10 bg-white/5"
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs sm:h-9 sm:w-9 sm:text-base">
                {LETTERS[i]}
              </span>
              <span className="flex-1">{opt}</span>
              {correct && <span className="hidden sm:inline">✅</span>}
              {wrong && <span className="hidden sm:inline">❌</span>}
            </button>
          );
        })}
      </div>

      {/* حالة اللعب: شريط ثابت أسفل الشاشة على الهاتف حتى يكون الزر ظاهراً دائماً */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0f0a2e]/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="mx-auto max-w-3xl">
          {isReveal ? (
            <div className="animate-pop rounded-2xl bg-white/5 p-3 text-center sm:p-5">
              <p className="text-base font-bold sm:text-xl">
                {ev?.type === "correct" &&
                  `✅ ${nameOf(ev.player)} أجاب إجابة صحيحة (+${ev.points})`}
                {ev?.type === "nobody" && "⏰ انتهى الوقت ولم يضغط أحد"}
                {ev?.type === "skipped" && "⏭️ تم تخطي السؤال"}
                {(ev?.type === "wrong" || ev?.type === "timeout") &&
                  "❌ لم يجب أحد إجابة صحيحة"}
              </p>
              <p className="mt-1 text-sm text-indigo-200 sm:mt-2 sm:text-base">
                {isLast ? "النتائج" : "السؤال التالي"} خلال{" "}
                {Math.ceil(revealLeft / 1000)}...
              </p>
            </div>
          ) : (
            <div className="space-y-2 sm:space-y-3">
              {(ev?.type === "wrong" || ev?.type === "timeout") && (
                <p className="animate-shake rounded-xl bg-red-500/15 px-3 py-1.5 text-center text-sm text-red-200 sm:px-4 sm:py-2 sm:text-base">
                  {ev.type === "wrong"
                    ? `❌ ${nameOf(ev.player)} أخطأ`
                    : `⏰ انتهى وقت ${nameOf(ev.player)}`}{" "}
                  ({ev.points}) — السؤال مفتوح للباقين
                </p>
              )}

              {iBuzzed ? (
                <Status
                  tone="amber"
                  seconds={answerLeft}
                  total={room.answer_seconds}
                >
                  🎯 دورك! اختر الإجابة الصحيحة
                </Status>
              ) : room.buzzed_by ? (
                <Status
                  tone="amber"
                  seconds={answerLeft}
                  total={room.answer_seconds}
                >
                  🔔 {nameOf(room.buzzed_by)} يجيب الآن...
                </Status>
              ) : lockedOut ? (
                <Status
                  tone="gray"
                  seconds={questionLeft}
                  total={room.question_seconds}
                >
                  {spectator
                    ? "👀 انضممت بعد البدء، أنت تشاهد فقط"
                    : room.team_size != null
                      ? "🚫 فريقك ممنوع من هذا السؤال، انتظر السؤال التالي"
                      : "🚫 أخطأت في هذا السؤال، انتظر السؤال التالي"}
                </Status>
              ) : (
                <div className="flex flex-col items-center gap-2 sm:gap-3">
                  <button
                    onClick={buzz}
                    disabled={!canBuzz || pending}
                    className="h-20 w-full touch-manipulation rounded-2xl border-4 border-red-800 bg-gradient-to-b from-red-500 to-red-700 text-3xl font-black shadow-[0_6px_0_#7f1d1d,0_10px_30px_rgba(239,68,68,0.45)] transition select-none active:translate-y-1.5 active:shadow-[0_1px_0_#7f1d1d] disabled:opacity-50 sm:h-48 sm:w-48 sm:rounded-full sm:border-8 sm:shadow-[0_10px_0_#7f1d1d,0_15px_40px_rgba(239,68,68,0.5)] sm:active:translate-y-2"
                  >
                    {pending ? "..." : "🔔 اضغط!"}
                  </button>
                  <p className="hidden text-xs text-indigo-300 sm:block">
                    أو اضغط زر المسافة
                  </p>
                  <TimerBar
                    seconds={questionLeft}
                    total={room.question_seconds}
                  />
                </div>
              )}
              {flash && (
                <p className="animate-pop text-center text-sm text-amber-300 sm:text-base">
                  {flash}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {isHost && <HostControls isReveal={isReveal} call={call} />}
    </section>
  );
}

function HostControls({ isReveal, call }: { isReveal: boolean; call: Call }) {
  return (
    <div className="flex justify-center gap-2 border-t border-white/10 pt-4">
      <button
        className="btn-ghost"
        onClick={() => call("skip_question").catch(() => {})}
      >
        {isReveal ? "⏭️ التالي الآن" : "⏭️ تخطي السؤال"}
      </button>
      <button
        className="btn-ghost text-red-200"
        onClick={() => {
          if (confirm("إنهاء المسابقة وعرض النتائج الآن؟"))
            call("end_game").catch(() => {});
        }}
      >
        ⏹️ إنهاء المسابقة
      </button>
    </div>
  );
}

function Status({
  tone,
  seconds,
  total,
  children,
}: {
  tone: "amber" | "gray";
  seconds: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`animate-pop space-y-2 rounded-2xl p-3 text-center text-base font-bold sm:space-y-3 sm:p-5 sm:text-xl ${
        tone === "amber"
          ? "bg-amber-400/15 text-amber-100"
          : "bg-white/5 text-indigo-200"
      }`}
    >
      <p>{children}</p>
      <TimerBar seconds={seconds} total={total} />
    </div>
  );
}

function TimerBar({ seconds: ms, total }: { seconds: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (ms / (total * 1000)) * 100));
  const secs = Math.ceil(ms / 1000);
  return (
    <div className="flex w-full max-w-md items-center gap-3 self-center">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
            secs <= 3 ? "bg-red-400" : "bg-emerald-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-sm font-bold tabular-nums">{secs}</span>
    </div>
  );
}

function msLeft(deadline: string | null, now: number) {
  return deadline ? Math.max(0, Date.parse(deadline) - now) : 0;
}

/** الوقت الحالي حسب ساعة الخادم، يتحدث 5 مرات في الثانية */
function useServerNow(offset: RefObject<number>) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now() + offset.current);
    const id = setInterval(update, 200);
    update();
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

/** أصوات عند الضغط والإجابة الصحيحة والخاطئة */
function useEventSounds(room: Room, userId: string) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const ev = room.last_event;
    const key = ev
      ? `${room.current_index}:${ev.type}:${"player" in ev ? ev.player : ""}:${room.locked_out.length}`
      : "none";
    if (last.current === null) {
      last.current = key; // لا تشغّل صوتاً لحدث قديم عند فتح الصفحة
      return;
    }
    if (key === last.current || !ev) return;
    last.current = key;
    if (ev.type === "buzz" && ev.player !== userId) sounds.buzz();
    if (ev.type === "correct") sounds.correct();
    if (ev.type === "wrong" || ev.type === "timeout") sounds.wrong();
  }, [room, userId]);
}
