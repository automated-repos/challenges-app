"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import type { C4State, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة المراحل (يجب أن تطابق 0028_connect4.sql)
const DROP_SECONDS = 30;
const REVEAL_SECONDS = 3;

export const C4_COLORS = ["#ef4444", "#facc15"];
const C4_NAMES = ["الأحمر", "الأصفر"];

export function c4SideName(c: C4State, side: number, players: Player[]) {
  const s = c.sides?.[side];
  if (!s) return "";
  if (s.team != null) return teamInfo(s.team).name;
  const p = players.find((x) => x.user_id === s.user);
  return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
}

/** طرف اللاعب: فريقه، أو هو نفسه */
function sideOf(c: C4State, userId: string, players: Player[]) {
  const team = players.find((p) => p.user_id === userId)?.team ?? null;
  return (c.sides ?? []).findIndex((s) => (s.team != null ? s.team === team : s.user === userId));
}

export function Connect4Game({
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
  const c = room.c4!;
  const turn = c.turn ?? 0;
  const mine = sideOf(c, userId, players);
  const myTurn = mine === turn && c.phase !== "done";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useC4Sounds(c);

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

  const name = (side: number) => c4SideName(c, side, players);
  const color = C4_COLORS[turn];
  const asking = c.phase === "question" || c.phase === "reveal";
  const total = c.phase === "question" ? room.question_seconds : c.phase === "reveal" ? REVEAL_SECONDS : DROP_SECONDS;

  return (
    <section className="mx-auto w-full max-w-xl space-y-3">
      {/* الطرفان */}
      <div className="grid grid-cols-2 gap-2">
        {[0, 1].map((side) => (
          <div
            key={side}
            className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-2 ${
              side === turn && c.phase !== "done" ? "" : "border-transparent"
            } ${side === mine ? "bg-white/15" : "bg-white/5"}`}
            style={side === turn && c.phase !== "done" ? { borderColor: C4_COLORS[side] } : undefined}
          >
            <span className="h-5 w-5 shrink-0 rounded-full shadow-inner" style={{ background: C4_COLORS[side] }} />
            <span className="min-w-0 flex-1 truncate font-bold">
              {name(side)}
              {side === mine && " (أنت)"}
            </span>
          </div>
        ))}
      </div>

      {/* لوحة الدور (فوق اللوحة حتى لا يحتاج اللاعب للنزول) */}
      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-lg font-black" style={{ color }}>
          {c.phase === "done"
            ? "🏁 انتهت اللعبة"
            : myTurn
              ? c.phase === "drop"
                ? "👇 دورك! اختر عموداً لقطعتك"
                : c.phase === "question"
                  ? "❓ دورك! أجب صح لتضع قطعتك"
                  : ""
              : `⏳ دور ${C4_NAMES[turn]}: ${name(turn)}`}
        </p>
        {asking && room.question && (
          <Question
            room={room}
            c={c}
            canAnswer={myTurn && c.phase === "question" && !busy}
            onAnswer={(i) => act("c4_answer", { p_choice: i })}
          />
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        {c.phase !== "done" && <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />}
      </div>

      <Board c={c} canDrop={myTurn && c.phase === "drop" && !busy} onDrop={(col) => act("c4_drop", { p_col: col })} />

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

function Question({
  room,
  c,
  canAnswer,
  onAnswer,
}: {
  room: Room;
  c: C4State;
  canAnswer: boolean;
  onAnswer: (i: number) => void;
}) {
  const q = room.question!;
  const reveal = c.phase === "reveal";
  return (
    <div className="space-y-3">
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category} • صح = تضع قطعتك، خطأ = يضيع الدور
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
                : reveal && c.choice === i
                  ? "bg-rose-500 text-white"
                  : canAnswer
                    ? "bg-white/10 hover:bg-indigo-500/40"
                    : "bg-white/10 opacity-70"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {reveal && (
        <p className={`text-lg font-black ${c.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {c.ok ? "✅ صح! اختر عموداً" : "❌ خطأ! الدور للخصم"}
        </p>
      )}
    </div>
  );
}

/** اللوحة: 7 أعمدة × 6 صفوف، والقطعة الأخيرة تسقط من الأعلى */
function Board({ c, canDrop, onDrop }: { c: C4State; canDrop: boolean; onDrop: (col: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const grid = c.grid ?? "0".repeat(42);
  const win = new Set(c.win ?? []);
  const full = (col: number) => grid[col] !== "0";

  return (
    <div className="mx-auto w-full max-w-[460px] select-none" dir="ltr">
      {/* مؤشر العمود */}
      <div className="grid grid-cols-7 px-2 pb-1">
        {Array.from({ length: 7 }, (_, col) => (
          <div key={col} className="flex h-6 items-center justify-center">
            {canDrop && hover === col && !full(col) && (
              <span className="h-4 w-4 animate-bounce rounded-full" style={{ background: C4_COLORS[c.turn ?? 0] }} />
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 rounded-3xl bg-blue-700 p-2 shadow-2xl ring-4 ring-blue-900">
        {Array.from({ length: 7 }, (_, col) => (
          <button
            key={col}
            onClick={() => canDrop && !full(col) && onDrop(col)}
            onMouseEnter={() => setHover(col)}
            onMouseLeave={() => setHover(null)}
            disabled={!canDrop || full(col)}
            className={`flex flex-col gap-1.5 rounded-2xl p-0.5 transition ${
              canDrop && !full(col) ? "cursor-pointer hover:bg-blue-500/50" : "cursor-default"
            }`}
            aria-label={`عمود ${col + 1}`}
          >
            {Array.from({ length: 6 }, (_, row) => {
              const v = grid[row * 7 + col];
              const idx = row * 7 + col;
              const isLast = c.last?.row === row && c.last?.col === col;
              return (
                <span key={row} className="relative block aspect-square w-full rounded-full bg-blue-950 shadow-inner">
                  {v !== "0" && (
                    <Disc
                      key={isLast ? `drop-${c.seq}` : "still"}
                      color={C4_COLORS[Number(v) - 1]}
                      win={win.has(idx)}
                      dropRows={isLast ? row + 1 : 0}
                    />
                  )}
                </span>
              );
            })}
          </button>
        ))}
      </div>
    </div>
  );
}

/** قطعة؛ إن كانت الأخيرة تسقط من أعلى العمود (بعد الحركة تبقى في مكانها الطبيعي دائماً) */
function Disc({ color, win, dropRows }: { color: string; win: boolean; dropRows: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!dropRows || !ref.current?.animate) return;
    ref.current.animate([{ transform: `translateY(-${dropRows * 115}%)` }, { transform: "translateY(0)" }], {
      duration: 180 + dropRows * 70,
      easing: "cubic-bezier(0.5, 0, 0.75, 0)",
    });
  }, [dropRows]);
  return (
    <span
      ref={ref}
      className={`absolute inset-[6%] rounded-full shadow-[inset_0_-4px_0_rgba(0,0,0,0.25)] ${
        win ? "animate-pulse ring-4 ring-white" : ""
      }`}
      style={{ background: color }}
    />
  );
}

function useC4Sounds(c: C4State) {
  const last = useRef(c.seq);
  useEffect(() => {
    if (c.seq === last.current) return;
    last.current = c.seq;
    const e = c.last_event;
    if (!e) return;
    if (e.type === "win" || e.type === "correct") sounds.correct();
    else if (e.type === "wrong" || e.type === "timeout") sounds.wrong();
    else sounds.tick();
  }, [c.seq, c.last_event]);
}
