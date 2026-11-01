"use client";

import { useState, type MouseEvent } from "react";
import { errorMessage } from "@/lib/supabase";
import type { Player } from "@/lib/types";
import { Avatar } from "../ui";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

/** لا نترك التركيز على الأزرار حتى لا تضغطها المسافة (زر الإجابة في اللعبة) */
const blur = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();

/** إهداء نقاط للاعب آخر كروح رياضية (أثناء المسابقة فقط) */
export function GiftPoints({ players, userId, call }: { players: Player[]; userId: string; call: Call }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const myScore = players.find((p) => p.user_id === userId)?.score ?? 0;
  const others = players.filter((p) => p.user_id !== userId).sort((a, b) => a.name.localeCompare(b.name));
  if (others.length === 0) return null;

  const max = Math.max(0, myScore);
  const value = Math.min(Math.max(1, amount), Math.max(1, max));
  const target = others.find((p) => p.user_id === to);

  async function gift(e: MouseEvent<HTMLButtonElement>) {
    blur(e);
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await call("gift_points", { p_to: target.user_id, p_amount: value });
      setDone(`🎁 أهديت ${value} لـ ${target.name}`);
      setOpen(false);
      setTo(null);
      setTimeout(() => setDone(""), 3000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="space-y-1">
        <button
          onClick={(e) => {
            blur(e);
            setOpen(true);
            setError("");
          }}
          disabled={max < 1}
          title={max < 1 ? "تحتاج نقاطاً لتهدي منها" : "أهدِ جزءاً من نقاطك للاعب آخر"}
          className="btn-ghost w-full"
        >
          🎁 إهداء نقاط
        </button>
        {done && <p className="animate-pop text-center text-xs text-emerald-300">{done}</p>}
      </div>
    );

  return (
    <div className="animate-pop space-y-3 rounded-2xl border border-amber-300/40 bg-amber-400/10 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">🎁 إهداء نقاط (معك {max})</h3>
        <button
          onClick={(e) => {
            blur(e);
            setOpen(false);
          }}
          className="rounded-lg px-2 text-lg text-indigo-200 hover:bg-white/10"
          title="إغلاق"
        >
          ×
        </button>
      </div>

      <div>
        <p className="mb-1 text-xs text-indigo-200">لمن؟</p>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {others.map((p) => (
            <button
              key={p.user_id}
              onClick={(e) => {
                blur(e);
                setTo(p.user_id);
              }}
              className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition ${
                to === p.user_id ? "bg-amber-400 text-black" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              <Avatar emoji={p.avatar} size="sm" />
              <span className="max-w-24 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-indigo-200">كم نقطة؟</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {[1, 5, 10].filter((n) => n <= max).map((n) => (
            <button
              key={n}
              onClick={(e) => {
                blur(e);
                setAmount(n);
              }}
              className={`rounded-lg px-3 py-1 text-sm font-bold ${
                value === n ? "bg-amber-400 text-black" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={value}
            onChange={(e) => setAmount(Number(e.target.value) || 1)}
            className="input w-20 px-2 py-1 text-center"
          />
        </div>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <button onClick={gift} disabled={busy || !target || max < 1} className="btn-primary w-full py-2">
        {busy ? "جارٍ الإهداء..." : target ? `أهدِ ${value} لـ ${target.name}` : "اختر لاعباً"}
      </button>
    </div>
  );
}
