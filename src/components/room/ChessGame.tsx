"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Chess, type Square } from "chess.js";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { teamInfo } from "@/lib/teams";
import type { ChessColor, ChessEvent, ChessState, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Suggestion {
  user_id: string;
  from_sq: string;
  to_sq: string;
}

const FILES = "abcdefgh";
const PIECE_NAME: Record<string, string> = {
  k: "الملك",
  q: "الوزير",
  r: "القلعة",
  b: "الفيل",
  n: "الحصان",
  p: "العسكري",
};
const COLOR_NAME: Record<ChessColor, string> = { w: "الأبيض", b: "الأسود" };
const RESULT_REASON: Record<string, string> = { checkmate: "كش مات", stalemate: "تعادل (لا حركة)", draw: "تعادل" };
const REVEAL_SECONDS = 4;

/** اسم الطرف: الفريق، أو اسم اللاعب */
function sideName(c: ChessState, color: ChessColor, players: Player[]) {
  const s = c.sides[color];
  if (s.team != null) return teamInfo(s.team).name;
  const p = players.find((x) => x.user_id === s.captain);
  return p ? `${p.avatar} ${p.name}` : "لاعب";
}

/** لون اللاعب في اللعبة، أو null لمن يشاهد */
function colorOf(c: ChessState, userId: string, players: Player[]): ChessColor | null {
  const team = players.find((p) => p.user_id === userId)?.team ?? null;
  for (const color of ["w", "b"] as const) {
    const s = c.sides[color];
    if (s.team != null ? s.team === team : s.captain === userId) return color;
  }
  return null;
}

export function ChessGame({
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
  const c = room.chess!;
  // حركة القائد تظهر فوراً على شاشته (قبل رد الخادم)، وتُلغى تلقائياً عند وصول وضع جديد أو عند الخطأ
  const [optimistic, setOptimistic] = useState<{ base: string; fen: string } | null>(null);
  const fen = optimistic && optimistic.base === c.fen ? optimistic.fen : c.fen;
  const game = useMemo(() => new Chess(fen), [fen]);
  const turn = game.turn() as ChessColor;
  const mine = colorOf(c, userId, players);
  const isCaptain = mine != null && c.sides[mine].captain === userId;
  const canAct = c.phase === "move" && mine === turn;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestions = useSuggestions(room.id, c.phase === "move" && mine === turn, c.seq);
  useChessSounds(c);

  const name = (uid: string) => {
    const p = players.find((x) => x.user_id === uid);
    return p ? `${p.avatar} ${p.name}` : "";
  };

  async function play(from: string, to: string, promotion?: string) {
    setBusy(true);
    setError("");
    try {
      if (isCaptain) {
        // الأكل الذي يحتاج سؤالاً لا يُعرض مسبقاً (قد يُلغى)
        try {
          const g = new Chess(c.fen);
          const m = g.move({ from, to, promotion });
          if (!m.captured || m.captured === "p") setOptimistic({ base: c.fen, fen: g.fen() });
        } catch {}
        const { error } = await getSupabase().functions.invoke("chess-move", {
          body: { roomId: room.id, from, to, promotion },
        });
        if (error) throw new Error(await functionError(error));
      } else {
        await call("chess_suggest", { p_from: from, p_to: to });
      }
    } catch (e) {
      setOptimistic(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: string, args: Record<string, unknown> = {}) {
    setError("");
    try {
      await call(fn, args);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const status =
    c.phase === "move"
      ? canAct
        ? isCaptain
          ? "♟️ دورك! حرّك قطعة"
          : "💡 دور فريقك: اقترح حركة على قائدك"
        : `⏳ دور ${COLOR_NAME[turn]} (${sideName(c, turn, players)})`
      : c.phase === "done"
        ? "🏁 انتهت اللعبة"
        : "❓ سؤال الأكل";

  return (
    <section className="mx-auto w-full max-w-2xl space-y-3">
      <SideBar c={c} color={mine === "w" ? "b" : "w"} turn={turn} players={players} name={name} />

      <div className="relative">
        <Board
          game={game}
          fen={fen}
          c={c}
          flipped={mine === "b"}
          interactive={canAct && !busy}
          suggestions={c.phase === "move" && mine === turn ? suggestions : []}
          name={name}
          onMove={play}
        />
        <CaptureShow c={c} />
      </div>

      <SideBar c={c} color={mine === "b" ? "b" : "w"} turn={turn} players={players} name={name} />

      <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-lg font-black">{status}</p>
        {(c.phase === "question" || c.phase === "reveal") && (
          <CaptureQuestion room={room} c={c} mine={mine} isCaptain={isCaptain} players={players} onAnswer={act} />
        )}
        {c.phase === "move" && <p className="text-sm text-indigo-200">{lastText(c, players)}</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        {(c.phase === "question" || c.phase === "reveal") && (
          <TimerBar
            seconds={msLeft(room.question_deadline, now)}
            total={c.phase === "question" ? room.question_seconds : REVEAL_SECONDS}
          />
        )}
      </div>

      {/* اقتراحات الفريق */}
      {c.phase === "move" && mine === turn && suggestions.length > 0 && (
        <div className="space-y-2 rounded-3xl border border-amber-300/30 bg-amber-400/10 p-3">
          <h3 className="font-bold text-amber-200">💡 اقتراحات الفريق</h3>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.user_id} className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-1.5 text-sm">
                <span className="flex-1 truncate">{name(s.user_id)}</span>
                <span dir="ltr" className="font-mono font-bold">
                  {s.from_sq} → {s.to_sq}
                </span>
                {isCaptain && (
                  <button
                    onClick={() => play(s.from_sq, s.to_sq, "q")}
                    disabled={busy}
                    className="rounded-lg bg-amber-500 px-2 py-1 text-xs font-bold text-black disabled:opacity-50"
                  >
                    العب
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <MoveList c={c} players={players} />

      {isHost && <HostControls c={c} players={players} act={act} />}
    </section>
  );
}

/** شريط الطرف: اسمه وقائده والقطع التي أكلها */
function SideBar({
  c,
  color,
  turn,
  players,
  name,
}: {
  c: ChessState;
  color: ChessColor;
  turn: ChessColor;
  players: Player[];
  name: (uid: string) => string;
}) {
  const active = turn === color && c.phase !== "done";
  const taken = capturedBy(c.fen, color);
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-sm ${
        active ? "bg-amber-400/20 ring-2 ring-amber-300" : "bg-white/5"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full border ${color === "w" ? "border-slate-400 bg-white" : "border-white/40 bg-slate-900"}`}
      />
      <b>{COLOR_NAME[color]}</b>
      <span className="truncate">{sideName(c, color, players)}</span>
      {c.sides[color].team != null && (
        <span className="text-xs text-indigo-200">القائد: {name(c.sides[color].captain)}</span>
      )}
      <span className="ms-auto text-lg leading-none tracking-tight" dir="ltr">
        {taken.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={chessImg(`pieces/${color === "w" ? "b" : "w"}${p}.png`)}
            alt={PIECE_NAME[p]}
            className="-mx-1 inline-block h-6 w-6"
          />
        ))}
      </span>
    </div>
  );
}

/** القطع التي أكلها اللون (القطع الناقصة من الخصم مقارنة بالبداية) */
function capturedBy(fen: string, color: ChessColor): string[] {
  const board = fen.split(" ")[0];
  const start: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
  const out: string[] = [];
  for (const p of ["q", "r", "b", "n", "p"]) {
    const ch = color === "w" ? p : p.toUpperCase(); // أكل الأبيض = قطع الأسود الناقصة
    const left = board.split("").filter((x) => x === ch).length;
    for (let i = left; i < start[p]; i++) out.push(p);
  }
  return out;
}

// ---------- اللوحة ----------

function Board({
  game,
  fen: boardFen,
  c,
  flipped,
  interactive,
  suggestions,
  name,
  onMove,
}: {
  game: Chess;
  fen: string;
  c: ChessState;
  flipped: boolean;
  interactive: boolean;
  suggestions: Suggestion[];
  name: (uid: string) => string;
  onMove: (from: string, to: string, promotion?: string) => void;
}) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  // اللوحة تغيّرت: إلغاء الاختيار
  const [fen, setFen] = useState(boardFen);
  if (fen !== boardFen) {
    setFen(boardFen);
    setSelected(null);
    setPromo(null);
  }
  const pieces = useTrackedPieces(boardFen);

  const turn = game.turn();
  const targets = selected ? game.moves({ square: selected, verbose: true }) : [];
  const targetSet = new Set(targets.map((m) => m.to));
  const checkSquare = game.inCheck()
    ? game
        .board()
        .flat()
        .find((p) => p && p.type === "k" && p.color === turn)?.square
    : undefined;
  const pendingTo = c.phase === "question" || c.phase === "reveal" ? c.pending : null;

  const rows = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const cols = flipped ? [...FILES].reverse() : [...FILES];

  function click(sq: Square) {
    if (!interactive) return;
    const piece = game.get(sq);
    if (selected && targetSet.has(sq)) {
      const move = targets.find((m) => m.to === sq)!;
      if (move.promotion) setPromo({ from: selected, to: sq });
      else onMove(selected, sq);
      setSelected(null);
      return;
    }
    setSelected(piece && piece.color === turn && sq !== selected ? sq : null);
  }

  // مركز المربع (بوحدات المربعات) للأسهم
  const center = (sq: string): [number, number] => {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]);
    return [(flipped ? 7 - f : f) + 0.5, (flipped ? r - 1 : 8 - r) + 0.5];
  };

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[480px] select-none overflow-hidden rounded-lg bg-cover shadow-2xl"
      style={{ backgroundImage: `url(${chessImg("board.jpeg")})` }}
      dir="ltr"
    >
      {/* حروف وأرقام الإطار مرسومة للأبيض؛ للأسود نغطيها بترتيبه */}
      {flipped && <FlippedLabels />}

      {/* منطقة اللعب فوق مربعات الصورة تماماً */}
      <div className="absolute" style={BOARD_AREA}>
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {rows.map((r) =>
            cols.map((f) => {
              const sq = `${f}${r}` as Square;
              const piece = game.get(sq);
              const last = c.last_move && (c.last_move.from === sq || c.last_move.to === sq);
              const attacking = pendingTo && (pendingTo.from === sq || pendingTo.to === sq);
              return (
                <button
                  key={sq}
                  onClick={() => click(sq)}
                  className={`relative ${interactive ? "cursor-pointer" : "cursor-default"}`}
                  aria-label={sq}
                >
                  {last && <span className="absolute inset-0 bg-amber-400/35" />}
                  {attacking && <span className="absolute inset-0 animate-pulse bg-rose-500/45" />}
                  {checkSquare === sq && <span className="absolute inset-0 bg-red-600/55" />}
                  {selected === sq && <span className="absolute inset-0 bg-emerald-400/45" />}
                  {targetSet.has(sq) && (
                    <span
                      className={`absolute rounded-full ${
                        piece
                          ? "inset-[6%] border-4 border-emerald-500/80"
                          : "left-[37%] top-[37%] h-[26%] w-[26%] bg-emerald-500/60"
                      }`}
                    />
                  )}
                </button>
              );
            }),
          )}
        </div>

        {/* القطع: طبقة فوق المربعات، كل قطعة تنزلق لمكانها الجديد بسلاسة */}
        <div className="pointer-events-none absolute inset-0">
          {pieces.map((pc) => {
            const f = FILES.indexOf(pc.sq[0]);
            const r = Number(pc.sq[1]);
            const x = flipped ? 7 - f : f;
            const y = flipped ? r - 1 : 8 - r;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={pc.id}
                src={chessImg(`pieces/${pc.color}${pc.type}.png`)}
                alt=""
                draggable={false}
                className="absolute left-0 top-0 h-[12.5%] w-[12.5%] drop-shadow-[0_3px_3px_rgba(0,0,0,0.55)]"
                style={{
                  transform: `translate(${x * 100}%, ${y * 100}%) scale(${pc.gone ? 0.3 : 1})`,
                  opacity: pc.gone ? 0 : 1,
                  transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out",
                  zIndex: pc.gone ? 0 : 1,
                }}
              />
            );
          })}
        </div>

        {/* أسهم اقتراحات الفريق بأسماء أصحابها */}
        {suggestions.length > 0 && (
          <svg viewBox="0 0 8 8" className="pointer-events-none absolute inset-0 z-10">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#f59e0b" />
              </marker>
            </defs>
            {suggestions.map((s) => {
              const [x1, y1] = center(s.from_sq);
              const [x2, y2] = center(s.to_sq);
              return (
                <g key={s.user_id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#f59e0b"
                    strokeWidth={0.13}
                    strokeOpacity={0.85}
                    markerEnd="url(#arrow)"
                  />
                  <text
                    x={x2}
                    y={y2 - 0.38}
                    fontSize={0.26}
                    textAnchor="middle"
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={0.05}
                    paintOrder="stroke"
                    fontWeight="bold"
                  >
                    {name(s.user_id)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* اختيار الترقية */}
      {promo && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="flex gap-2 rounded-2xl border border-amber-400/60 bg-slate-950/90 p-3">
            {(["q", "r", "b", "n"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  onMove(promo.from, promo.to, p);
                  setPromo(null);
                }}
                className="rounded-xl bg-white/10 p-1 hover:bg-amber-400/40"
                title={PIECE_NAME[p]}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chessImg(`pieces/${turn}${p}.png`)} alt={PIECE_NAME[p]} className="h-14 w-14" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- سؤال الأكل ----------

function CaptureQuestion({
  room,
  c,
  mine,
  isCaptain,
  players,
  onAnswer,
}: {
  room: Room;
  c: ChessState;
  mine: ChessColor | null;
  isCaptain: boolean;
  players: Player[];
  onAnswer: (fn: string, args: Record<string, unknown>) => void;
}) {
  const q = room.question;
  const p = c.pending;
  if (!q || !p) return null;
  const reveal = c.phase === "reveal" ? c.reveal : null;
  const canAnswer = c.phase === "question" && isCaptain && mine != null && !c.answered[mine];
  const myChoice = reveal && mine ? reveal[mine] : null;

  return (
    <div className="space-y-3">
      <p className="rounded-2xl bg-rose-500/15 px-3 py-2 text-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={chessImg(`pieces/${p.by}${p.piece}.png`)} alt="" className="inline-block h-6 w-6 align-middle" />{" "}
        {COLOR_NAME[p.by]} ({sideName(c, p.by, players)}) يهاجم {PIECE_NAME[p.captured]}{" "}
        <span dir="ltr">({p.san})</span>
        {p.need > 1 && (
          <b>
            {" "}
            • سؤال {p.k} من {p.need}
          </b>
        )}
        <br />
        <span className="text-xs text-indigo-200">
          إجابة المهاجم الصحيحة = تُؤكل القطعة، والخاطئة = تُلغى الحركة. وإن أجاب الاثنان صح، الأسرع يفوز.
        </span>
      </p>
      <p className="text-xs text-indigo-200">
        {q.icon} {q.category}
      </p>
      <h3 className="text-xl font-black leading-relaxed">{q.text}</h3>
      <div className="grid grid-cols-2 gap-2">
        {q.options.map((opt, i) => {
          const correct = reveal && reveal.correct === i;
          const wrongMine = reveal && myChoice === i && !correct;
          return (
            <button
              key={i}
              onClick={() => onAnswer("chess_answer", { p_choice: i })}
              disabled={!canAnswer}
              className={`rounded-2xl px-3 py-3 font-bold transition ${
                correct
                  ? "bg-emerald-500 text-white"
                  : wrongMine
                    ? "bg-rose-500 text-white"
                    : canAnswer
                      ? "bg-white/10 hover:bg-indigo-500/40"
                      : "bg-white/10 opacity-70"
              }`}
            >
              {opt}
              {reveal && (["w", "b"] as const).some((col) => reveal[col] === i) && (
                <span className="block text-xs font-normal opacity-90">
                  {(["w", "b"] as const)
                    .filter((col) => reveal[col] === i)
                    .map((col) => COLOR_NAME[col])
                    .join(" و")}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {c.phase === "question" ? (
        <p className="text-sm text-indigo-200">
          {(["w", "b"] as const).map((col) => `${COLOR_NAME[col]}: ${c.answered[col] ? "✅ أجاب" : "⏳"}`).join(" • ")}
        </p>
      ) : (
        reveal && (
          <p className={`text-lg font-black ${reveal.ok ? "text-emerald-300" : "text-rose-300"}`}>
            {reveal.ok
              ? p.k < p.need
                ? `✅ صح! السؤال التالي (${p.k + 1} من ${p.need})`
                : `✅ صح! ${PIECE_NAME[p.captured]} تُؤكل`
              : reveal[p.by === "w" ? "w_ok" : "b_ok"]
                ? `🛡️ ${COLOR_NAME[p.by === "w" ? "b" : "w"]} أجاب صح أسرع! الحركة أُلغيت`
                : "❌ خطأ! الحركة أُلغيت"}
          </p>
        )
      )}
    </div>
  );
}

// ---------- الحركات والأحداث ----------

function describe(e: ChessEvent, c: ChessState, players: Player[]): string {
  const who = `${COLOR_NAME[e.by]} (${sideName(c, e.by, players)})`;
  const san = `‎${e.san}‎`;
  switch (e.type) {
    case "move":
      return `${who}: ${san}${e.captured ? ` أكل ${PIECE_NAME[e.captured]}` : ""}${e.end ? ` • ${RESULT_REASON[e.end] ?? ""}` : ""}`;
    case "attack":
      return `${who} يهاجم ${PIECE_NAME[e.captured ?? ""]} (${san})`;
    case "captured":
      return `✅ ${who} أكل ${PIECE_NAME[e.captured ?? ""]} (${san})${e.end ? ` • ${RESULT_REASON[e.end] ?? ""}` : ""}`;
    case "cancelled":
      return `❌ ${who} أخطأ فأُلغيت ${san}`;
  }
}

function lastText(c: ChessState, players: Player[]) {
  const game = new Chess(c.fen);
  const check = game.inCheck() ? " • ⚠️ كش!" : "";
  return c.last
    ? describe(c.last, c, players) + check
    : "الأبيض يبدأ. أكل القلعة أو الفيل أو الحصان بسؤال، والوزير بثلاثة.";
}

function MoveList({ c, players }: { c: ChessState; players: Player[] }) {
  return (
    <div className="space-y-2 rounded-3xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-black text-amber-300">سجل اللعبة</h3>
      {c.moves.length > 0 && (
        <p dir="ltr" className="font-mono text-sm leading-relaxed text-indigo-100">
          {c.moves.map((m, i) => (
            <span key={i}>
              {i % 2 === 0 && <span className="text-indigo-300">{i / 2 + 1}. </span>}
              {m}{" "}
            </span>
          ))}
        </p>
      )}
      <ul className="space-y-1">
        {c.log.map((e, i) => (
          <li key={`${c.seq}-${i}`} className="rounded-xl bg-white/5 px-3 py-1.5 text-sm">
            {describe(e, c, players)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HostControls({
  c,
  players,
  act,
}: {
  c: ChessState;
  players: Player[];
  act: (fn: string, args?: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2 rounded-3xl border border-white/10 bg-white/5 p-3 text-sm">
      {(["w", "b"] as const).map((col) => {
        const s = c.sides[col];
        if (s.team == null) return null;
        const members = players.filter((p) => p.team === s.team);
        return (
          <label key={col} className="flex items-center gap-2">
            <span className="w-28">قائد {COLOR_NAME[col]}:</span>
            <select
              value={s.captain}
              onChange={(e) => act("chess_set_captain", { p_user: e.target.value })}
              className="flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1"
            >
              {members.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.avatar} {p.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <div className="flex flex-wrap justify-center gap-2">
        {(c.phase === "question" || c.phase === "reveal") && (
          <button onClick={() => act("skip_question")} className="btn-ghost">
            ⏭️ تخطي السؤال
          </button>
        )}
        <button
          onClick={() => {
            if (confirm("إنهاء اللعبة الآن؟")) act("end_game");
          }}
          className="btn-ghost"
        >
          🏁 إنهاء اللعبة
        </button>
      </div>
    </div>
  );
}

// ---------- أدوات ----------

/** رابط صورة من public/chess (مع مسار النشر على GitHub Pages) */
export const chessImg = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chess/${file}`;

// مكان المربعات الـ 64 داخل صورة اللوحة (board.jpeg مقاسها 1254×1254)
const BOARD_AREA = {
  left: `${(105 / 1254) * 100}%`,
  top: `${(84 / 1254) * 100}%`,
  width: `${(1045 / 1254) * 100}%`,
  height: `${(1058 / 1254) * 100}%`,
};

/** للاعب الأسود اللوحة مقلوبة: نغطي حروف وأرقام الإطار ونكتبها بترتيبه */
function FlippedLabels() {
  const cell = (i: number, size: number, start: number) => `${((start + size * (i + 0.5)) / 1254) * 100}%`;
  const label =
    "absolute -translate-x-1/2 -translate-y-1/2 rounded bg-[#151515] px-1.5 font-serif text-[min(4vw,20px)] text-[#d4a84b]";
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={`r${i}`} className={label} style={{ left: "5.1%", top: cell(i, 132.25, 84) }}>
          {i + 1}
        </span>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <span key={`f${i}`} className={label} style={{ left: cell(i, 130.6, 105), top: "94.1%" }}>
          {"HGFEDCBA"[i]}
        </span>
      ))}
    </div>
  );
}

interface TrackedPiece {
  id: number;
  type: string;
  color: "w" | "b";
  sq: string;
  /** أُكلت: تختفي تدريجياً في مكانها */
  gone?: boolean;
}

const squareDistance = (a: string, b: string) =>
  Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));

/**
 * يعطي كل قطعة رقماً ثابتاً بين الأوضاع، حتى تنزلق من مربعها القديم للجديد بدل أن تختفي وتظهر.
 * المطابقة: نفس النوع واللون، والأقرب مسافة (يغطي التبييت). العسكري المرقّى يصبح القطعة الجديدة.
 */
function trackPieces(prev: TrackedPiece[], fen: string, nextId: { current: number }): TrackedPiece[] {
  const next = new Map<string, { type: string; color: "w" | "b" }>();
  for (const row of new Chess(fen).board())
    for (const p of row) if (p) next.set(p.square, { type: p.type, color: p.color });

  const out: TrackedPiece[] = [];
  const taken = new Set<string>();
  let loose: TrackedPiece[] = [];
  for (const p of prev) {
    if (p.gone) continue;
    const n = next.get(p.sq);
    if (n && n.type === p.type && n.color === p.color && !taken.has(p.sq)) {
      out.push(p);
      taken.add(p.sq);
    } else loose.push(p);
  }

  const unplaced: [string, { type: string; color: "w" | "b" }][] = [];
  for (const [sq, n] of next) {
    if (taken.has(sq)) continue;
    const match = loose
      .filter((p) => p.type === n.type && p.color === n.color)
      .sort((a, b) => squareDistance(a.sq, sq) - squareDistance(b.sq, sq))[0];
    if (match) {
      out.push({ ...match, sq });
      loose = loose.filter((p) => p !== match);
    } else unplaced.push([sq, n]);
  }
  for (const [sq, n] of unplaced) {
    // ترقية: العسكري نفسه يتحول للقطعة الجديدة
    const pawn = loose.find((p) => p.type === "p" && p.color === n.color);
    if (pawn) {
      out.push({ ...pawn, sq, type: n.type });
      loose = loose.filter((p) => p !== pawn);
    } else out.push({ id: nextId.current++, sq, ...n });
  }
  for (const p of loose) out.push({ ...p, gone: true });
  return out;
}

/** القطع بأرقام ثابتة؛ تُحدَّث عند تغيّر الوضع */
function useTrackedPieces(fen: string): TrackedPiece[] {
  const [nextId] = useState(() => ({ current: 1 }));
  const [state, setState] = useState(() => ({ fen, pieces: trackPieces([], fen, nextId) }));
  if (state.fen !== fen) {
    const pieces = trackPieces(state.pieces, fen, nextId);
    setState({ fen, pieces });
    return pieces;
  }
  return state.pieces;
}

/** اقتراحات الفريق: تُحدّث كل ثانية ونصف أثناء دور الفريق */
function useSuggestions(roomId: string, active: boolean, seq: number): Suggestion[] {
  const [list, setList] = useState<Suggestion[]>([]);
  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from("chess_suggestions")
      .select("user_id, from_sq, to_sq")
      .eq("room_id", roomId)
      .order("created_at");
    setList((data ?? []) as Suggestion[]);
  }, [roomId]);

  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- مزامنة مع القاعدة
    load();
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, [active, load, seq]);

  return active ? list : [];
}

function useChessSounds(c: ChessState) {
  const last = useRef(c.seq);
  useEffect(() => {
    if (c.seq === last.current) return;
    last.current = c.seq;
    const e = c.last;
    if (!e) return;
    if (e.type === "captured") sounds.correct();
    else if (e.type === "cancelled") sounds.wrong();
    else if (e.type === "attack") sounds.buzz();
    else sounds.tick();
  }, [c.seq, c.last]);
}

// ---------- عرض الأكل ----------

const SHOW_MS = 2800;
const SPARKS = Array.from({ length: 12 }, (_, i) => i * 30);

/** القطعة المهاجمة من رمز الحركة (Nxe5 ← n، exd5 ← p) */
function attackerOf(san: string): string {
  const ch = san[0];
  return "KQRBN".includes(ch) ? ch.toLowerCase() : "p";
}

/** بعد نجاح الأكل: المهاجم يقفز على القطعة المأكولة فتتحطم، فوق اللوحة لثوانٍ */
function CaptureShow({ c }: { c: ChessState }) {
  const [show, setShow] = useState<{ key: number; attacker: string; victim: string; by: ChessColor } | null>(null);
  // حدث جديد: نبدأ العرض (لا عرض لأكل حدث قبل فتح الصفحة)
  const [seq, setSeq] = useState(c.seq);
  if (seq !== c.seq) {
    setSeq(c.seq);
    const e = c.last;
    if (e?.type === "captured" && e.captured) {
      setShow({ key: c.seq, attacker: attackerOf(e.san), victim: e.captured, by: e.by });
    }
  }

  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [show]);

  if (!show) return null;
  const foe: ChessColor = show.by === "w" ? "b" : "w";
  const size = "h-[min(26vw,130px)] w-[min(26vw,130px)]";
  const img = (color: ChessColor, piece: string) => chessImg(`pieces/${color}${piece}.png`);

  return (
    <div
      key={show.key}
      onClick={() => setShow(null)}
      className="capture-backdrop absolute inset-0 z-20 mx-auto flex max-w-[480px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl bg-black/65 backdrop-blur-[2px]"
    >
      <div className="relative flex h-1/2 w-1/2 items-center justify-center" dir="ltr">
        <span className="capture-flash absolute h-full w-full rounded-full bg-[radial-gradient(circle,#fde68a_0%,#f59e0b80_40%,transparent_70%)]" />
        {SPARKS.map((a) => (
          <span
            key={a}
            style={{ "--a": `${a}deg` } as CSSProperties}
            className="capture-spark absolute h-[12%] w-[3%] rounded-full bg-amber-300"
          />
        ))}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(foe, show.victim)} alt="" className={`capture-victim absolute ${size}`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(foe, show.victim)} alt="" className={`capture-half-left absolute ${size}`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(foe, show.victim)} alt="" className={`capture-half-right absolute ${size}`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(show.by, show.attacker)} alt="" className={`capture-attacker absolute ${size}`} />
      </div>
      <p className="capture-caption mt-2 rounded-2xl bg-amber-400 px-4 py-1.5 text-lg font-black text-black shadow-lg">
        {PIECE_NAME[show.attacker]} {show.by === "w" ? "الأبيض" : "الأسود"} أكل {PIECE_NAME[show.victim]}! 💥
      </p>
    </div>
  );
}

/** رسالة الخطأ التي أرسلتها الدالة بدل الرسالة العامة */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {}
  }
  return "تعذّر إرسال الحركة (تأكد من نشر دالة chess-move)";
}
