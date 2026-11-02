"use client";

import { useEffect, useState, type RefObject } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import type { Category, Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { msLeft, TimerBar, useServerNow } from "./QuestionView";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

/** بالأدوار مع اختيار المجال: صاحب الدور يختار مجال سؤاله، والباقون ينتظرون */
export function PickCategory({
  room,
  players,
  userId,
  offset,
  call,
}: {
  room: Room;
  players: Player[];
  userId: string;
  offset: RefObject<number>;
  call: Call;
}) {
  const now = useServerNow(offset);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const myTurn = room.turn_player === userId;
  const turnPlayer = players.find((p) => p.user_id === room.turn_player);

  useEffect(() => {
    if (!myTurn) return;
    getSupabase()
      .rpc("list_categories")
      .then(({ data }) => {
        const all = (data ?? []) as Category[];
        setCategories(room.category_ids ? all.filter((c) => room.category_ids!.includes(c.id)) : all);
      });
  }, [myTurn, room.category_ids]);

  async function pick(id: number) {
    setBusy(true);
    setError("");
    try {
      await call("pick_category", { p_category: id });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const left = msLeft(room.pick_deadline, now);
  const count = (c: Category) => Number(room.difficulty ? c[`${room.difficulty}_count`] : c.question_count);

  return (
    <section className="animate-pop space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 text-center sm:p-8">
      <p className="text-sm text-indigo-200">
        السؤال {room.current_index + 1} من {room.total_questions}
      </p>
      {myTurn ? (
        <>
          <h2 className="text-2xl font-black">🗂️ دورك! اختر مجال سؤالك</h2>
          {!categories ? (
            <p className="text-indigo-200">جارٍ التحميل...</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories
                .filter((c) => count(c) > 0)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pick(c.id)}
                    disabled={busy}
                    className="rounded-2xl border border-white/15 bg-white/5 px-3 py-4 font-bold transition hover:scale-[1.03] hover:bg-indigo-500/30 disabled:opacity-50"
                  >
                    <span className="block text-3xl">{c.icon}</span>
                    {c.name}
                  </button>
                ))}
            </div>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <p className="text-xs text-indigo-300">إن انتهى الوقت يُختار مجال عشوائي</p>
        </>
      ) : (
        <h2 className="py-6 text-2xl font-black">
          ⏳ {turnPlayer ? `${turnPlayer.avatar} ${turnPlayer.name}` : "صاحب الدور"} يختار المجال...
        </h2>
      )}
      <TimerBar seconds={left} total={15} />
    </section>
  );
}
