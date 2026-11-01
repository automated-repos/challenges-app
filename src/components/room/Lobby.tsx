"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/supabase";
import { copyText, roomLink } from "@/lib/roomCode";
import type { Player, Room } from "@/lib/types";
import { Avatar, ErrorBox } from "../ui";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export function Lobby({
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      await call("start_game");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2000);
  }

  async function copyCode() {
    flash((await copyText(room.code)) ? "✓ تم نسخ الرمز" : "تعذّر النسخ");
  }

  async function shareLink() {
    const url = roomLink(room.code);
    // على الهاتف: قائمة المشاركة (واتساب وغيره). على الكمبيوتر: نسخ الرابط
    if (navigator.share) {
      try {
        await navigator.share({ title: "تحدي الأسئلة", text: `انضم لمسابقتي! رمز الغرفة: ${room.code}`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // المستخدم أغلق القائمة
      }
    }
    flash((await copyText(url)) ? "✓ تم نسخ رابط الغرفة" : "تعذّر النسخ");
  }

  const sorted = [...players].sort((a, b) => a.joined_at.localeCompare(b.joined_at));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-indigo-200">شارك هذا الرمز أو الرابط مع المتسابقين</p>
        <p dir="ltr" className="my-3 font-mono text-6xl font-black tracking-[0.3em]">
          {room.code}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={copyCode} className="btn-ghost">
            📋 نسخ الرمز
          </button>
          <button onClick={shareLink} className="btn-ghost">
            🔗 مشاركة رابط الغرفة
          </button>
        </div>
        <p className="mt-2 h-5 text-sm text-emerald-300">{notice}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-indigo-200">
          <span>{room.total_questions} سؤال</span>
          <span>+{room.points_correct} للصحيحة</span>
          <span>−{room.points_wrong} للخاطئة</span>
          <span>{room.question_seconds} ث للضغط</span>
          <span>{room.answer_seconds} ث للإجابة</span>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 font-bold">المتسابقون ({players.length})</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sorted.map((p) => (
            <li
              key={p.user_id}
              className={`animate-pop flex items-center gap-2 rounded-xl px-3 py-2 ${
                p.user_id === userId ? "bg-indigo-500/30 ring-1 ring-indigo-400" : "bg-white/5"
              }`}
            >
              <Avatar emoji={p.avatar} size="sm" />
              <span className="truncate">
                {p.name}
                {p.user_id === room.host_id && " 👑"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {error && <ErrorBox>{error}</ErrorBox>}

      {isHost ? (
        <button onClick={start} disabled={busy} className="btn-primary w-full py-4 text-xl">
          {busy ? "جارٍ البدء..." : "🚀 ابدأ المسابقة"}
        </button>
      ) : (
        <p className="text-center text-indigo-200">⏳ بانتظار منشئ الغرفة لبدء المسابقة...</p>
      )}
    </div>
  );
}
