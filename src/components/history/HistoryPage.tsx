"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, getSupabase, isConfigured } from "@/lib/supabase";
import { SetupNotice } from "../SetupNotice";
import { Avatar, Center, ErrorBox } from "../ui";
import { useAuth } from "../auth/useAuth";
import { AuthForm } from "../auth/AuthForm";

interface LeaderRow {
  user_id: string;
  name: string;
  avatar: string;
  total_points: number;
  games: number;
  wins: number;
  correct: number;
  place: number;
}

interface MatchPlayer {
  user_id: string;
  name: string;
  avatar: string;
  score: number;
  correct: number;
  wrong: number;
  place: number;
}

interface Match {
  room_id: string;
  finished_at: string | null;
  questions: number;
  categories: string[] | null;
  players: MatchPlayer[];
}

const MEDALS = ["🥇", "🥈", "🥉"];
const PAGE = 20;

const dateFmt = new Intl.DateTimeFormat("ar-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function HistoryPage() {
  if (!isConfigured) return <SetupNotice />;
  return <HistoryInner />;
}

function HistoryInner() {
  const auth = useAuth();
  const [tab, setTab] = useState<"leaders" | "matches">("leaders");

  if (auth.loading) return <Center>جارٍ التحميل...</Center>;
  if (!auth.userId)
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <p className="mb-4 text-center text-indigo-200">سجّل الدخول لعرض لوحة الشرف وسجل المسابقات</p>
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <AuthForm />
        </section>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="text-xl font-black">
          🏆 تحدي الأسئلة
        </Link>
        <Link href="/" className="btn-ghost">
          الرئيسية
        </Link>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
        {(
          [
            ["leaders", "🏆 لوحة الشرف"],
            ["matches", "📜 سجل المسابقات"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl py-2.5 font-bold transition ${
              tab === t ? "bg-indigo-500 text-white shadow" : "text-indigo-200 hover:bg-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "leaders" ? <Leaderboard userId={auth.userId} /> : <Matches userId={auth.userId} />}
    </main>
  );
}

function Leaderboard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSupabase()
      .rpc("leaderboard", { p_limit: 100 })
      .then(({ data, error }) => {
        if (error) setError(errorMessage(error));
        else setRows(data as LeaderRow[]);
      });
  }, []);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!rows) return <p className="text-center text-indigo-200">جارٍ التحميل...</p>;
  if (rows.length === 0) return <Empty text="لا توجد نتائج بعد. العب أول مسابقة!" />;

  const me = rows.find((r) => r.user_id === userId);

  return (
    <div className="space-y-4">
      {me && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="مركزك" value={`#${me.place}`} />
          <Stat label="مجموع نقاطك" value={me.total_points} />
          <Stat label="انتصاراتك" value={me.wins} />
          <Stat label="مسابقاتك" value={me.games} />
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        <div className="grid grid-cols-[3rem_1fr_4.5rem_3.5rem_3.5rem] gap-2 border-b border-white/10 px-4 py-2 text-xs text-indigo-300">
          <span>المركز</span>
          <span>اللاعب</span>
          <span className="text-center">النقاط</span>
          <span className="text-center">فوز</span>
          <span className="text-center">مسابقات</span>
        </div>
        <ol>
          {rows.map((r) => (
            <li
              key={r.user_id}
              className={`grid grid-cols-[3rem_1fr_4.5rem_3.5rem_3.5rem] items-center gap-2 px-4 py-2.5 ${
                r.user_id === userId ? "bg-indigo-500/20" : "odd:bg-white/[0.02]"
              }`}
            >
              <span className="text-xl">{MEDALS[r.place - 1] ?? <span className="text-sm text-indigo-200">{r.place}</span>}</span>
              <span className="flex min-w-0 items-center gap-2">
                <Avatar emoji={r.avatar} size="sm" />
                <span className="truncate font-semibold">{r.name}</span>
              </span>
              <span dir="ltr" className={`text-center font-black tabular-nums ${r.total_points < 0 ? "text-red-300" : ""}`}>
                {r.total_points}
              </span>
              <span className="text-center tabular-nums">{r.wins}</span>
              <span className="text-center tabular-nums text-indigo-200">{r.games}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-center text-xs text-indigo-300">
        الفوز = المركز الأول بنقاط أكثر من صفر في مسابقة فيها لاعبان على الأقل
      </p>
    </div>
  );
}

function Matches({ userId }: { userId: string }) {
  const [mine, setMine] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    async (offset: number) => {
      const { data, error } = await getSupabase().rpc("match_history", {
        p_mine: mine,
        p_limit: PAGE,
        p_offset: offset,
      });
      if (error) throw error;
      return data as Match[];
    },
    [mine],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage(0)
      .then((page) => {
        if (cancelled) return;
        setMatches(page);
        setHasMore(page.length === PAGE);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!matches) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(matches.length);
      setMatches([...matches, ...page]);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function switchFilter(value: boolean) {
    if (value === mine) return;
    setMatches(null);
    setError("");
    setMine(value);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2">
        <button className={mine ? "btn-ghost" : "btn-primary py-2 text-sm"} onClick={() => switchFilter(false)}>
          كل المسابقات
        </button>
        <button className={mine ? "btn-primary py-2 text-sm" : "btn-ghost"} onClick={() => switchFilter(true)}>
          مسابقاتي فقط
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {!matches && !error && <p className="text-center text-indigo-200">جارٍ التحميل...</p>}
      {matches && matches.length === 0 && <Empty text="لا توجد مسابقات منتهية بعد" />}

      {matches?.map((m) => (
        <MatchCard key={m.room_id} match={m} userId={userId} />
      ))}

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-ghost w-full">
          {loadingMore ? "جارٍ التحميل..." : "عرض المزيد"}
        </button>
      )}
    </div>
  );
}

function MatchCard({ match, userId }: { match: Match; userId: string }) {
  const [open, setOpen] = useState(false);
  const players = match.players ?? [];
  const winners = players.filter((p) => p.place === 1 && p.score > 0);
  const me = players.find((p) => p.user_id === userId);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-right">
        <span className="text-3xl">{winners.length ? "🏆" : "🤝"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {winners.length ? (
              <>
                الفائز: {winners.map((w) => `${w.avatar} ${w.name}`).join("، ")}{" "}
                <span className="text-amber-300">({winners[0].score} نقطة)</span>
              </>
            ) : (
              "لا يوجد فائز"
            )}
          </p>
          <p className="text-xs text-indigo-300">
            {match.finished_at ? dateFmt.format(new Date(match.finished_at)) : "—"} • {players.length} لاعبين •{" "}
            {match.questions} أسئلة
            {me && <> • مركزك: {me.place}</>}
          </p>
        </div>
        <span className="text-indigo-300">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
          <p className="text-xs text-indigo-300">
            المجالات: {match.categories?.length ? match.categories.join("، ") : "كل المجالات"}
          </p>
          {players.map((p) => (
            <div
              key={p.user_id}
              className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ${p.user_id === userId ? "bg-indigo-500/20" : "bg-white/5"}`}
            >
              <span className="w-7 text-center">{MEDALS[p.place - 1] ?? p.place}</span>
              <Avatar emoji={p.avatar} size="sm" />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-indigo-300">
                ✅ {p.correct} • ❌ {p.wrong}
              </span>
              <span dir="ltr" className="w-10 text-left font-bold tabular-nums">
                {p.score}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3">
      <p dir="ltr" className="text-2xl font-black tabular-nums">
        {value}
      </p>
      <p className="text-xs text-indigo-300">{label}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-indigo-200">
      <div className="mb-2 text-4xl">📭</div>
      {text}
    </div>
  );
}
