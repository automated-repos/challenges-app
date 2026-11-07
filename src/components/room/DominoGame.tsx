"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";
import { tileFits, type DominoEvent, type DominoState, type Tile } from "@/lib/domino";
import { Avatar, ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة كل مرحلة بالثواني (يجب أن تطابق 0029_domino.sql)
const PLAY_SECONDS = 30;
const REVEAL_SECONDS = 3;

export function DominoGame({
  room,
  state: st,
  players,
  userId,
  isHost,
  offset,
  call,
}: {
  room: Room;
  state: DominoState;
  players: Player[];
  userId: string;
  isHost: boolean;
  offset: RefObject<number>;
  call: Call;
}) {
  const now = useServerNow(offset);
  const order = st.players ?? [];
  const turnUser = order[st.turn ?? 0];
  const myTurn = turnUser === userId;
  const hand = useMyHand(room.id, st.seq ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Tile | null>(null); // قطعة تطابق الطرفين: ننتظر اختيار الطرف
  useDominoSounds(st);

  const nameOf = (id?: string | null) => {
    const p = players.find((x) => x.user_id === id);
    return p ? `${p.avatar} ${p.name}` : "لاعب";
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

  const canPlay = myTurn && st.phase === "play" && !busy;

  function choose(t: Tile) {
    if (!canPlay) return;
    const fit = tileFits(t, st.ends);
    if (!fit.left && !fit.right) return;
    // السلسلة فارغة، أو القطعة تطابق طرفاً واحداً، أو الطرفان متساويان: لا حاجة للسؤال
    if (!st.ends || !fit.left || !fit.right || st.ends[0] === st.ends[1]) {
      setPicked(null);
      act("domino_play", { p_a: t[0], p_b: t[1], p_side: fit.right ? "right" : "left" });
    } else {
      setPicked(t);
    }
  }

  const total = st.phase === "question" ? room.question_seconds : st.phase === "play" ? PLAY_SECONDS : REVEAL_SECONDS;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-4">
      {/* اللاعبون وعدد قطعهم */}
      <ul className="flex flex-wrap justify-center gap-2">
        {order.map((u, i) => (
          <li
            key={u}
            className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-1.5 text-sm font-bold ${
              u === turnUser ? "border-amber-300 bg-amber-400/15" : "border-transparent bg-white/5"
            } ${u === userId ? "ring-1 ring-indigo-400" : ""}`}
          >
            <Avatar emoji={players.find((p) => p.user_id === u)?.avatar ?? "🙂"} size="sm" />
            <span className="max-w-28 truncate">{players.find((p) => p.user_id === u)?.name ?? "لاعب"}</span>
            <span className="flex items-center gap-1 text-xs text-indigo-200">
              <TileBack /> {st.counts?.[i] ?? 0}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-1.5 rounded-2xl bg-white/5 px-3 py-1.5 text-sm text-indigo-200">
          🏦 البنك: <b className="text-white">{st.boneyard ?? 0}</b>
        </li>
      </ul>

      <Table chain={st.chain ?? []} ends={st.ends ?? null} />

      {/* لوحة الدور */}
      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-lg font-black text-amber-300">
          {turnUser && `دور ${nameOf(turnUser)}`}
          {myTurn && " (دورك!)"}
        </p>

        {(st.phase === "question" || st.phase === "reveal" || (st.phase === "play" && room.correct_index != null)) &&
          room.question && (
            <DominoQuestion
              room={room}
              st={st}
              canAnswer={myTurn && st.phase === "question" && !busy}
              onAnswer={(i) => act("domino_answer", { p_choice: i })}
            />
          )}

        {st.phase === "play" && (
          <p className="font-bold">
            {myTurn ? "🎯 اختر قطعة من قطعك تطابق أحد طرفي السلسلة" : `⏳ ${nameOf(turnUser)} يختار قطعة...`}
          </p>
        )}

        {picked && canPlay && (
          <div className="flex justify-center gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                act("domino_play", { p_a: picked[0], p_b: picked[1], p_side: "left" });
                setPicked(null);
              }}
            >
              ⬅️ على الطرف الأيسر ({st.ends?.[0]})
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                act("domino_play", { p_a: picked[0], p_b: picked[1], p_side: "right" });
                setPicked(null);
              }}
            >
              على الطرف الأيمن ({st.ends?.[1]}) ➡️
            </button>
          </div>
        )}

        <p className="text-sm text-indigo-100">{st.last ? describe(st.last, nameOf) : ""}</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      {/* قطعي */}
      <div className="space-y-2 rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-bold text-indigo-200">قطعك ({hand.length})</p>
        <div className="flex flex-wrap justify-center gap-2" dir="ltr">
          {hand.map((t, k) => {
            const fit = tileFits(t, st.ends);
            const playable = canPlay && (fit.left || fit.right);
            const isPicked = picked && picked[0] === t[0] && picked[1] === t[1];
            return (
              <button
                key={`${t[0]}-${t[1]}-${k}`}
                onClick={() => choose(t)}
                disabled={!playable}
                className={`rounded-lg transition ${
                  playable ? "hover:-translate-y-1 hover:scale-105" : canPlay ? "opacity-35" : ""
                } ${isPicked ? "-translate-y-1 ring-4 ring-amber-300" : playable ? "ring-2 ring-emerald-400" : ""}`}
              >
                <DominoTile tile={t} size={30} vertical />
              </button>
            );
          })}
          {hand.length === 0 && <p className="text-indigo-300">لا توجد قطع</p>}
        </div>
      </div>

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

/** يد اللاعب: تُجلب من القاعدة عند كل حدث جديد (لا يراها غيره) */
function useMyHand(roomId: string, seq: number): Tile[] {
  const [hand, setHand] = useState<Tile[]>([]);
  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .rpc("domino_my_hand", { p_room: roomId })
      .then(({ data }) => {
        if (!cancelled && data) setHand(data as Tile[]);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, seq]);
  return hand;
}

// ---------- الطاولة ----------

function Table({ chain, ends }: { chain: Tile[]; ends: Tile | null }) {
  return (
    <div className="rounded-3xl border-4 border-emerald-900 bg-gradient-to-b from-emerald-700 to-emerald-800 p-3 shadow-inner">
      {chain.length === 0 ? (
        <p className="py-8 text-center font-bold text-emerald-100">الطاولة فارغة • أول قطعة تُلعب في أي مكان</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-center gap-1" dir="ltr">
            {chain.map((t, k) => (
              <DominoTile key={k} tile={t} size={22} vertical={t[0] === t[1]} />
            ))}
          </div>
          {ends && (
            <p className="mt-2 text-center text-xs font-bold text-emerald-100" dir="ltr">
              ⬅️ {ends[0]} &nbsp;•&nbsp; {ends[1]} ➡️
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- القطعة ----------

const PIPS: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** قطعة دومينو: أفقية (الجهة الأولى يساراً) أو عمودية (الجهة الأولى أعلى) */
export function DominoTile({ tile, size, vertical = false }: { tile: Tile; size: number; vertical?: boolean }) {
  const w = vertical ? size : size * 2;
  const h = vertical ? size * 2 : size;
  const half = (v: number, ox: number, oy: number) =>
    PIPS[v].map((k) => (
      <circle
        key={`${ox}-${oy}-${k}`}
        cx={ox + size * (0.25 + (k % 3) * 0.25)}
        cy={oy + size * (0.25 + Math.floor(k / 3) * 0.25)}
        r={size * 0.085}
        fill="#1e1b4b"
      />
    ));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 drop-shadow">
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={size * 0.15} fill="#fffaf0" stroke="#1e1b4b" />
      {vertical ? (
        <line x1={size * 0.15} y1={size} x2={size * 0.85} y2={size} stroke="#1e1b4b" strokeWidth={1} />
      ) : (
        <line x1={size} y1={size * 0.15} x2={size} y2={size * 0.85} stroke="#1e1b4b" strokeWidth={1} />
      )}
      {half(tile[0], 0, 0)}
      {vertical ? half(tile[1], 0, size) : half(tile[1], size, 0)}
    </svg>
  );
}

function TileBack() {
  return <span className="inline-block h-3.5 w-2 rounded-sm border border-white/40 bg-indigo-400/60" />;
}

// ---------- السؤال ----------

function DominoQuestion({
  room,
  st,
  canAnswer,
  onAnswer,
}: {
  room: Room;
  st: DominoState;
  canAnswer: boolean;
  onAnswer: (i: number) => void;
}) {
  const q = room.question!;
  const shown = room.correct_index != null;
  const chosen = shown ? (st.last?.choice ?? null) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category}
      </p>
      <h3 className="text-xl font-black leading-relaxed">{q.text}</h3>
      <div className="grid grid-cols-2 gap-2">
        {q.options.map((opt, i) => {
          const isCorrect = shown && room.correct_index === i;
          const isWrong = shown && chosen === i && room.correct_index !== i;
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

// ---------- رسائل الأحداث ----------

export function describe(e: DominoEvent, nameOf: (id?: string | null) => string): string {
  const who = nameOf(e.by);
  const drew = e.drew ? ` وسحب ${e.drew === 1 ? "قطعة" : `${e.drew} قطع`} من البنك` : "";
  switch (e.type) {
    case "correct":
      return `✅ ${who} جاوب صح (+${e.points})${drew}`;
    case "pass":
      return `✅ ${who} جاوب صح (+${e.points})${drew}، لكن ما عندوش قطعة مناسبة والبنك فاضي فمرّر`;
    case "wrong":
      return `❌ ${who} جاوب غلط (${e.points})${drew}`;
    case "timeout":
      return `⏰ ${who} انتهى وقته (${e.points})${drew}`;
    case "play":
      return `🁫 ${who} لعب [${e.tile?.[0]}|${e.tile?.[1]}]`;
    case "finish":
      return e.reason === "domino"
        ? `🏆 ${who} خلّص قطعه!`
        : e.reason === "left"
          ? `🏆 ${who} فاز لأن باقي اللاعبين خرجوا`
          : "🔒 اللعبة اتقفلت! الفائز صاحب أقل نقط في يده";
    case "left":
      return `🚪 ${who} خرج من اللعبة ورجعت قطعه للبنك`;
  }
}

/** أصوات: صح، غلط، ولعب قطعة */
function useDominoSounds(st: DominoState) {
  const last = useRef(st.seq);
  useEffect(() => {
    if (st.seq === last.current) return;
    last.current = st.seq;
    const e = st.last;
    if (!e) return;
    if (e.type === "correct" || e.type === "pass") sounds.correct();
    else if (e.type === "wrong" || e.type === "timeout") sounds.wrong();
    else if (e.type === "play") sounds.tick();
  }, [st.seq, st.last]);
}
