"use client";

import Link from "next/link";
import { useState } from "react";
import { errorMessage } from "@/lib/supabase";
import { copyText, roomLink } from "@/lib/roomCode";
import { DIFFICULTIES, type Player, type Room } from "@/lib/types";
import { Avatar, ErrorBox } from "../ui";
import { KickButton, OnlineDot } from "./RoomPeople";
import { LobbyTeams, TeamSettings } from "./LobbyTeams";
import { CarPicker } from "./CarPicker";

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
        await navigator.share({
          title: "تحدي الأسئلة",
          text: `انضم لمسابقتي! رمز الغرفة: ${room.code}`,
          url,
        });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // المستخدم أغلق القائمة
      }
    }
    flash((await copyText(url)) ? "✓ تم نسخ رابط الغرفة" : "تعذّر النسخ");
  }

  function toggleReady(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur();
    run("set_ready", { p_ready: !meReady });
  }

  /** استدعاء دالة من القاعدة مع إظهار الخطأ إن وُجد */
  async function run(fn: string, args: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      await call(fn, args);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...players].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  // منشئ الغرفة لا يحتاج للضغط على "جاهز"، هو من يبدأ
  const contestants = players.filter((p) => p.user_id !== room.host_id);
  const readyCount = contestants.filter((p) => p.ready).length;
  const allReady = readyCount === contestants.length;
  const meReady = players.find((p) => p.user_id === userId)?.ready ?? false;
  const teamMode = room.team_size != null;
  const unassigned = players.filter((p) => p.team == null).length;
  const teamCount = new Set(players.map((p) => p.team).filter((t) => t != null)).size;
  // سبب منع البدء في وضع الفرق (نفس شروط القاعدة)
  const teamBlock = !teamMode
    ? ""
    : unassigned > 0
      ? `${unassigned} بدون فريق`
      : teamCount < 2
        ? "يجب أن يكون هناك فريقان على الأقل"
        : "";
  // اللعب منفرداً لا يُحتسب، فلا تبدأ المسابقة إلا بلاعبين على الأقل (نفس شرط القاعدة)
  const alone = players.length < 2;
  // لودو الفردي: 6 لاعبين على الأكثر (نفس شرط القاعدة)، وأكثر من ذلك بالفرق
  const tooMany =
    (room.game === "ludo" || room.game === "snakes" || room.game === "pirate" || room.game === "bank") &&
    !teamMode &&
    players.length > 6;
  // الشطرنج الفردي للاعبين اثنين بالضبط، وفي الفرق فريقان بالضبط
  const chessBlock =
    room.game !== "chess"
      ? ""
      : !teamMode && players.length > 2
        ? `الشطرنج الفردي للاعبين اثنين فقط، وفي الغرفة ${players.length}. اختر "فريقان".`
        : teamMode && teamCount !== 2 && !teamBlock
          ? "الشطرنج بين فريقين بالضبط"
          : "";
  // الجاسوس من 3 لاعبين
  const spyBlock = room.game === "spy" && players.length < 3 ? "الجاسوس تحتاج 3 لاعبين على الأقل" : "";
  // أربعة على التوالي: لاعبان أو فريقان بالضبط
  const c4Block =
    room.game !== "connect4"
      ? ""
      : !teamMode && players.length > 2
        ? `أربعة على التوالي للاعبين اثنين فقط، وفي الغرفة ${players.length}. اختر "فريقان".`
        : teamMode && teamCount !== 2 && !teamBlock
          ? "أربعة على التوالي بين فريقين بالضبط"
          : "";
  // الدومينو من 2 إلى 4 لاعبين (نفس شرط القاعدة)
  const dominoBlock =
    room.game === "domino" && players.length > 4 ? `الدومينو حتى 4 لاعبين، وفي الغرفة ${players.length}` : "";
  // قرية روبن هود حتى 8 لاعبين (نفس شرط القاعدة)
  const raidBlock =
    room.game === "raid" && players.length > 8 ? `قرية روبن هود حتى 8 لاعبين، وفي الغرفة ${players.length}` : "";
  const canStart =
    !alone && !tooMany && !chessBlock && !c4Block && !spyBlock && !dominoBlock && !raidBlock && allReady && !teamBlock;

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
        {isHost && (
          <Link href={`/?from=${room.code}`} className="btn-ghost mt-1 inline-block">
            🎮 تغيير اللعبة (والكل ينتقل معك)
          </Link>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-indigo-200">
          {room.game === "raid" ? (
            <>
              <span>🏹 قرية روبن هود</span>
              <span>{room.raid?.minutes ?? 3} دقائق</span>
              <span>2 إلى 8 لاعبين • فريقان يُوزَّعان عشوائياً</span>
              <span>🖥️ أبقِ الصفحة مفتوحة يا منشئ الغرفة: جهازك هو الحَكَم</span>
            </>
          ) : room.game === "domino" ? (
            <>
              <span>🁫 دومينو كلاسيكي</span>
              <span>2 إلى 4 لاعبين • 7 قطع لكل لاعب</span>
              <span>30 ث لكل دور</span>
            </>
          ) : room.game === "connect4" ? (
            <>
              <span>🔴🟡 أربعة على التوالي</span>
              <span>{room.c4?.mode === "classic" ? "🎯 كلاسيكي" : "❓ بالأسئلة"}</span>
              {room.c4?.mode !== "classic" && (
                <>
                  <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
                  <span>{room.question_seconds} ث لكل سؤال</span>
                </>
              )}
            </>
          ) : room.game === "bank" ? (
            <>
              <span>🏙️ إمبراطورية المدن</span>
              <span>{room.bank?.rounds ? `${room.bank.rounds} جولة` : "♾️ لا نهائي"}</span>
              <span>💵 {room.bank?.start_cash ?? 1500} رصيد البداية</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>❓ الأسئلة بلا وقت</span>
            </>
          ) : room.game === "spy" ? (
            <>
              <span>🕵️ الجاسوس</span>
              <span>{room.total_questions} جولات</span>
              <span>{room.spy?.spies === 2 ? "جاسوسان (من 6 لاعبين)" : "جاسوس واحد"}</span>
              <span>
                {room.spy?.custom
                  ? `كلمات خاصة (${room.spy.custom.length})`
                  : room.spy?.categories?.join("، ") || "كل المجالات"}
              </span>
              <span>🎤 الأسئلة في الغرفة الصوتية بلا وقت</span>
            </>
          ) : room.game === "pirate" ? (
            <>
              <span>🏴‍☠️ قرصان المعرفة</span>
              <span>{room.pirate?.count ?? 10} جزر</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>+{room.points_correct} للصحيحة</span>
              <span>−{room.points_wrong} للخاطئة</span>
              <span>{room.question_seconds} ث لكل سؤال</span>
            </>
          ) : room.game === "chess" ? (
            <>
              <span>♟️ شطرنج الأسئلة</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>+{room.points_correct} للصحيحة</span>
              <span>−{room.points_wrong} للخاطئة</span>
              <span>{room.question_seconds} ث لكل سؤال</span>
            </>
          ) : room.game === "snakes" ? (
            <>
              <span>🐍 سلم وثعبان الأسئلة</span>
              <span>لوحة {room.snakes?.steps ?? 50} مربع</span>
              <span>{room.turn_pick === "choose" ? "🗂️ صاحب الدور يختار المجال" : "🎲 سؤال عشوائي"}</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>+{room.points_correct} للصحيحة</span>
              <span>−{room.points_wrong} للخاطئة</span>
              <span>{room.question_seconds} ث للإجابة</span>
            </>
          ) : room.game === "ludo" ? (
            <>
              <span>🎲 لودو الأسئلة</span>
              <span>{room.ludo?.steps ?? 10} خطوات للفوز</span>
              <span>{room.turn_pick === "choose" ? "🗂️ صاحب الدور يختار المجال" : "🎲 سؤال عشوائي"}</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>+{room.points_correct} للصحيحة</span>
              <span>−{room.points_wrong} للخاطئة</span>
              <span>{room.question_seconds} ث للإجابة</span>
            </>
          ) : room.game === "stop" ? (
            <>
              <span>🚌 أتوبيس كومبليت</span>
              <span>{room.total_questions} جولات</span>
              <span>{room.question_seconds} ث لكل جولة</span>
              <span>الخانات: {(room.stop_categories ?? []).join("، ")}</span>
            </>
          ) : (
            <>
              <span>{room.total_questions} سؤال</span>
              <span>{DIFFICULTIES.find((d) => d.value === (room.difficulty ?? null))?.label}</span>
              <span>
                {room.play_mode === "turns"
                  ? room.turn_pick === "choose"
                    ? "🔄 بالأدوار • صاحب الدور يختار المجال"
                    : room.turn_pick === "same"
                      ? "🔄 بالأدوار • 🎯 نفس المجال للجميع في كل جولة"
                      : "🔄 بالأدوار • سؤال عشوائي"
                  : "🔔 بالضغط"}
              </span>
              <span>+{room.points_correct} للصحيحة</span>
              <span>−{room.points_wrong} للخاطئة</span>
              {room.play_mode === "turns" ? (
                <span>{room.question_seconds} ث لكل دور</span>
              ) : (
                <>
                  <span>{room.question_seconds} ث للضغط</span>
                  <span>{room.answer_seconds} ث للإجابة</span>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {room.game === "bank" && <CarPicker room={room} players={players} userId={userId} call={call} />}

      {isHost &&
        room.game !== "stop" &&
        room.game !== "spy" &&
        room.game !== "bank" &&
        room.game !== "domino" &&
        room.game !== "raid" && <TeamSettings room={room} busy={busy} run={run} />}

      {teamMode ? (
        <LobbyTeams room={room} players={players} userId={userId} busy={busy} run={run} />
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-bold">المتسابقون ({players.length})</h2>
            {contestants.length > 0 && (
              <span className={`text-sm ${allReady ? "text-emerald-300" : "text-indigo-200"}`}>
                جاهز {readyCount} من {contestants.length}
              </span>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sorted.map((p) => (
              <li
                key={p.user_id}
                className={`animate-pop flex items-center gap-2 rounded-xl px-3 py-2 ${
                  p.user_id === userId
                    ? "bg-indigo-500/30 ring-1 ring-indigo-400"
                    : p.ready && p.user_id !== room.host_id
                      ? "bg-emerald-500/15"
                      : "bg-white/5"
                }`}
              >
                <OnlineDot userId={p.user_id} />
                <Avatar emoji={p.avatar} size="sm" />
                <span className="flex-1 truncate">
                  {p.name}
                  {p.user_id === room.host_id && " 👑"}
                </span>
                <KickButton userId={p.user_id} name={p.name} />
                {p.user_id !== room.host_id && (
                  <span title={p.ready ? "جاهز" : "لم يجهز بعد"} className="text-sm">
                    {p.ready ? "✅" : "⏳"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      {isHost ? (
        <div className="space-y-2">
          <button onClick={start} disabled={busy || !canStart} className="btn-primary w-full py-4 text-xl">
            {busy ? "جارٍ..." : "🚀 ابدأ المسابقة"}
          </button>
          {tooMany && (
            <p className="text-center text-sm text-amber-200">
              {room.game === "bank"
                ? `🏙️ إمبراطورية المدن حتى 6 لاعبين، وفي الغرفة ${players.length}.`
                : `${room.game === "pirate" ? "🏴‍☠️ قرصان المعرفة" : "🎲 لودو"} الفردي حتى 6 لاعبين، وفي الغرفة ${players.length}. العبوا بالفرق.`}
            </p>
          )}
          {alone && (
            <p className="text-center text-sm text-amber-200">
              👥 تحتاج لاعباً آخر على الأقل للبدء. شارك رمز الغرفة مع أصدقائك.
            </p>
          )}
          {!allReady && (
            <p className="text-center text-sm text-indigo-200">
              ⏳ بانتظار جاهزية الجميع ({readyCount} من {contestants.length})
            </p>
          )}
          {teamBlock && <p className="text-center text-sm text-amber-200">👥 {teamBlock}</p>}
          {chessBlock && <p className="text-center text-sm text-amber-200">♟️ {chessBlock}</p>}
          {c4Block && <p className="text-center text-sm text-amber-200">🔴 {c4Block}</p>}
          {raidBlock && <p className="text-center text-sm text-amber-200">🏹 {raidBlock}</p>}
          {dominoBlock && <p className="text-center text-sm text-amber-200">🁫 {dominoBlock}</p>}
          {spyBlock && !alone && <p className="text-center text-sm text-amber-200">🕵️ {spyBlock}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={toggleReady}
            disabled={busy}
            className={`w-full py-4 text-xl ${
              meReady
                ? "rounded-xl border border-emerald-400/40 bg-emerald-500/20 font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                : "btn-primary"
            }`}
          >
            {meReady ? "✅ أنت جاهز (اضغط للإلغاء)" : "✋ أنا جاهز"}
          </button>
          <p className="text-center text-sm text-indigo-200">
            {meReady ? "⏳ بانتظار منشئ الغرفة لبدء المسابقة..." : "اضغط «أنا جاهز» عندما تكون مستعداً"}
          </p>
        </div>
      )}
    </div>
  );
}
