"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";
import { tileFits, type DominoEvent, type DominoState, type Tile } from "@/lib/domino";
import { Avatar, ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

// مدة كل مرحلة بالثواني (يجب أن تطابق 0032_domino_no_questions.sql)
const PLAY_SECONDS = 30;
const PASS_SECONDS = 2;

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

  async function play(t: Tile, side: "left" | "right") {
    setBusy(true);
    setError("");
    setPicked(null);
    try {
      await call("domino_play", { p_a: t[0], p_b: t[1], p_side: side });
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
    // السلسلة فارغة، أو القطعة تطابق طرفاً واحداً، أو الطرفان متساويان: نلعب مباشرة
    if (!st.ends || !fit.left || !fit.right || st.ends[0] === st.ends[1]) {
      play(t, fit.right ? "right" : "left");
    } else {
      setPicked(t);
    }
  }

  const total = st.phase === "play" ? PLAY_SECONDS : PASS_SECONDS;

  return (
    <section className="mx-auto w-full max-w-4xl space-y-3">
      {/* اللاعبون وعدد قطعهم */}
      <ul className="flex flex-wrap justify-center gap-2">
        {order.map((u, i) => {
          const p = players.find((x) => x.user_id === u);
          return (
            <li
              key={u}
              className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-1.5 text-sm font-bold transition ${
                u === turnUser ? "scale-105 border-amber-300 bg-amber-400/20" : "border-transparent bg-white/5"
              } ${u === userId ? "ring-1 ring-indigo-400" : ""}`}
            >
              <Avatar emoji={p?.avatar ?? "🙂"} size="sm" />
              <span className="max-w-28 truncate">{p?.name ?? "لاعب"}</span>
              <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-xs text-indigo-100">
                <TileBack /> {st.counts?.[i] ?? 0}
              </span>
            </li>
          );
        })}
        <li className="flex items-center gap-1.5 rounded-2xl bg-white/5 px-3 py-1.5 text-sm text-indigo-200">
          🏦 البنك: <b className="text-white">{st.boneyard ?? 0}</b>
        </li>
      </ul>

      {/* الطاولة: كبيرة في منتصف الشاشة */}
      <Table
        chain={st.chain ?? []}
        ends={st.ends ?? null}
        picked={picked}
        onSide={(side) => picked && play(picked, side)}
        onCancel={() => setPicked(null)}
      />

      {/* حالة الدور */}
      <div className="space-y-2 rounded-2xl bg-white/5 px-4 py-3 text-center">
        <p className="text-lg font-black text-amber-300">
          {myTurn
            ? st.phase === "play"
              ? picked
                ? "👆 اختر الطرف (الرقم) الذي تضعها عنده"
                : "🎯 دورك! اختر قطعة تطابق أحد الطرفين"
              : "دورك"
            : turnUser && `⏳ دور ${nameOf(turnUser)}`}
        </p>
        {st.last && <p className="text-sm text-indigo-100">{describe(st.last, nameOf)}</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <TimerBar seconds={msLeft(room.question_deadline, now)} total={total} />
      </div>

      {/* قطعي */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-3">
        <p className="mb-2 text-center text-sm font-bold text-indigo-200">قطعك ({hand.length})</p>
        <div className="flex flex-wrap justify-center gap-2.5" dir="ltr">
          {hand.map((t, k) => {
            const fit = tileFits(t, st.ends);
            const playable = canPlay && (fit.left || fit.right);
            const isPicked = picked && picked[0] === t[0] && picked[1] === t[1];
            return (
              <button
                key={`${t[0]}-${t[1]}-${k}`}
                onClick={() => choose(t)}
                disabled={!playable}
                className={`rounded-xl transition ${
                  isPicked
                    ? "-translate-y-2 ring-4 ring-amber-300"
                    : playable
                      ? "ring-2 ring-emerald-400 hover:-translate-y-1.5"
                      : canPlay
                        ? "opacity-35"
                        : ""
                }`}
              >
                <DominoTile tile={t} size={38} vertical />
              </button>
            );
          })}
          {hand.length === 0 && <p className="text-indigo-300">لا توجد قطع</p>}
        </div>
      </div>

      {isHost && (
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => call("skip_question")} className="btn-ghost" title="لصاحب دور غائب مثلاً">
            ⏭️ تخطي الدور (تُلعب قطعة تلقائياً)
          </button>
          <button
            onClick={() => {
              if (confirm("إنهاء اللعبة الآن؟")) call("end_game");
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

/** حجم القطع على الطاولة حسب طول السلسلة: كلما قلّت القطع كبرت */
function tableTileSize(n: number) {
  if (n <= 6) return 40;
  if (n <= 12) return 34;
  if (n <= 20) return 28;
  return 24;
}

const TILE_GAP = 2; // المسافة بين القطع المتجاورة
const END_A = "#f59e0b"; // لون الطرف الأول
const END_B = "#38bdf8"; // لون الطرف الآخر

/** عرض العنصر (يتحدث عند تغيّر حجم الشاشة) */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * السلسلة كثعبان: الصف الأول من اليسار لليمين، والتالي يرجع من اليمين لليسار (والقطع مقلوبة)،
 * فتبقى الأرقام المتطابقة متجاورة دائماً حتى عند الانتقال لصف جديد.
 */
function snakeRows(chain: Tile[], perRow: number): { tile: Tile; index: number }[][] {
  const rows: { tile: Tile; index: number }[][] = [];
  for (let i = 0; i < chain.length; i += perRow) {
    const row = chain.slice(i, i + perRow).map((tile, k) => ({ tile, index: i + k }));
    const reversed = rows.length % 2 === 1;
    rows.push(reversed ? row.reverse().map(({ tile, index }) => ({ tile: [tile[1], tile[0]] as Tile, index })) : row);
  }
  return rows;
}

function Table({
  chain,
  ends,
  picked,
  onSide,
  onCancel,
}: {
  chain: Tile[];
  ends: Tile | null;
  picked: Tile | null;
  onSide: (side: "left" | "right") => void;
  onCancel: () => void;
}) {
  const size = tableTileSize(chain.length);
  const [ref, width] = useWidth<HTMLDivElement>();
  // كل القطع أفقية وبنفس العرض (حتى الدبل)، فكل الصفوف بنفس الطول بالضبط والقطع متلاصقة:
  // نهاية كل صف تقع تحت/فوق بداية الصف التالي مباشرة، فتبقى السلسلة متصلة
  const slot = size * 2;
  const perRow = Math.max(2, Math.floor((width + TILE_GAP) / (slot + TILE_GAP)));
  const rowWidth = perRow * slot + (perRow - 1) * TILE_GAP;
  const rows = snakeRows(chain, perRow);
  const last = chain.length - 1;
  return (
    <div className="relative flex min-h-[42vh] flex-col items-center justify-center gap-3 rounded-[2rem] border-8 border-amber-900/80 bg-[radial-gradient(ellipse_at_center,#15803d_0%,#166534_55%,#14532d_100%)] p-4 shadow-[inset_0_0_40px_rgba(0,0,0,0.45)]">
      {chain.length === 0 ? (
        <p className="text-center text-xl font-black text-emerald-100/90">
          الطاولة فارغة
          <span className="block text-sm font-normal">أول قطعة تُلعب في أي مكان</span>
        </p>
      ) : (
        <>
          <div ref={ref} className="w-full" dir="ltr">
            <div className="mx-auto" style={{ width: rowWidth }}>
              {rows.map((row, r) => (
                <div key={r}>
                  {/* وصلة الانعطاف: من نهاية الصف السابق إلى بداية هذا الصف (يمين ثم يسار بالتناوب) */}
                  {r > 0 && (
                    <div className={`flex ${r % 2 === 1 ? "justify-end" : "justify-start"}`}>
                      <div className="flex justify-center" style={{ width: slot }}>
                        <span className="block h-2.5 w-1 rounded-full bg-amber-200/80" />
                      </div>
                    </div>
                  )}
                  <div
                    className={`flex items-center ${r % 2 === 1 ? "justify-end" : "justify-start"}`}
                    style={{ gap: TILE_GAP }}
                  >
                    {row.map(({ tile, index }) => (
                      <span key={index} className="flex shrink-0 justify-center" style={{ width: slot }}>
                        <span
                          className="rounded-md"
                          style={
                            index === 0 || index === last
                              ? { boxShadow: `0 0 0 3px ${index === 0 ? END_A : END_B}` }
                              : undefined
                          }
                        >
                          <DominoTile tile={tile} size={size} />
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3" dir="ltr">
            <EndBadge value={ends?.[0]} color={END_A} active={!!picked} onClick={() => onSide("left")} />
            <span className="text-xs text-emerald-100/80">الطرفان</span>
            <EndBadge value={ends?.[1]} color={END_B} active={!!picked} onClick={() => onSide("right")} />
          </div>
        </>
      )}
      {picked && (
        <button onClick={onCancel} className="text-xs text-emerald-100 underline">
          إلغاء
        </button>
      )}
    </div>
  );
}

/** طرف السلسلة بلونه، ويتحول لزر "ضعها هنا" عند اختيار قطعة تطابق الطرفين */
function EndBadge({
  value,
  color,
  active,
  onClick,
}: {
  value: number | undefined;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  if (active)
    return (
      <button
        onClick={onClick}
        className="flex animate-pulse flex-col items-center rounded-2xl border-4 bg-black/30 px-4 py-1.5 font-black text-white"
        style={{ borderColor: color }}
      >
        <span className="text-2xl">{value}</span>
        <span className="text-[10px]">ضعها هنا</span>
      </button>
    );
  return (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-full border-4 bg-black/25 text-xl font-black text-white"
      style={{ borderColor: color }}
    >
      {value}
    </span>
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
        r={size * 0.09}
        fill="#1e1b4b"
      />
    ));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 drop-shadow-md">
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={size * 0.15} fill="#fffaf0" stroke="#1e1b4b" />
      {vertical ? (
        <line x1={size * 0.15} y1={size} x2={size * 0.85} y2={size} stroke="#1e1b4b" strokeWidth={1.2} />
      ) : (
        <line x1={size} y1={size * 0.15} x2={size} y2={size * 0.85} stroke="#1e1b4b" strokeWidth={1.2} />
      )}
      {half(tile[0], 0, 0)}
      {vertical ? half(tile[1], 0, size) : half(tile[1], size, 0)}
    </svg>
  );
}

function TileBack() {
  return <span className="inline-block h-3.5 w-2 rounded-sm border border-white/40 bg-indigo-400/60" />;
}

// ---------- رسائل الأحداث ----------

export function describe(e: DominoEvent, nameOf: (id?: string | null) => string): string {
  const who = nameOf(e.by);
  const drew = e.drew ? `سحب ${e.drew === 1 ? "قطعة" : `${e.drew} قطع`} من البنك` : "";
  switch (e.type) {
    case "draw":
      return `🏦 ${who} ${drew}`;
    case "pass":
      return `⏭️ ${who} ${drew ? `${drew} و` : ""}ما عندوش قطعة مناسبة والبنك فاضي، فمرّر`;
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
    // أحداث من النسخة القديمة (بأسئلة)
    case "correct":
      return `✅ ${who} جاوب صح`;
    case "wrong":
    case "timeout":
      return `❌ ${who} ${drew}`;
  }
}

/** أصوات: لعب قطعة، وسحب من البنك */
function useDominoSounds(st: DominoState) {
  const last = useRef(st.seq);
  useEffect(() => {
    if (st.seq === last.current) return;
    last.current = st.seq;
    const e = st.last;
    if (!e) return;
    if (e.type === "finish") sounds.correct();
    else if (e.type === "pass") sounds.wrong();
    else sounds.tick();
  }, [st.seq, st.last]);
}
