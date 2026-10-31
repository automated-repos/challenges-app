import Link from "next/link";
import { rankPlayers, type Player } from "@/lib/types";
import { Avatar } from "../ui";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Results({ players, userId }: { players: Player[]; userId: string }) {
  const ranked = rankPlayers(players);
  const me = ranked.find((p) => p.user_id === userId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="text-center">
        <div className="text-6xl">🏁</div>
        <h1 className="mt-2 text-3xl font-black">انتهت المسابقة</h1>
        {me && (
          <p className="mt-2 text-lg text-indigo-200">
            مركزك: <b className="text-white">{me.rank}</b> من {ranked.length} • نقاطك:{" "}
            <b className="text-white">{me.score}</b>
          </p>
        )}
      </section>

      {ranked.length > 1 && <Podium top={ranked.slice(0, 3)} />}

      <ol className="space-y-2">
        {ranked.map((p) => (
          <li
            key={p.user_id}
            className={`animate-pop flex items-center gap-4 rounded-2xl border px-5 py-4 ${
              p.rank === 1
                ? "border-amber-300/60 bg-amber-400/15 text-lg"
                : p.user_id === userId
                  ? "border-indigo-400/50 bg-indigo-500/20"
                  : "border-white/10 bg-white/5"
            }`}
          >
            <span className="w-10 text-center text-2xl">{MEDALS[p.rank - 1] ?? p.rank}</span>
            <Avatar emoji={p.avatar} />
            <span className="flex-1 truncate font-bold">{p.name}</span>
            <span className="text-sm text-indigo-200">
              ✅ {p.correct_count} • ❌ {p.wrong_count}
            </span>
            <span dir="ltr" className="w-14 text-left text-xl font-black tabular-nums">
              {p.score}
            </span>
          </li>
        ))}
      </ol>

      <div className="text-center">
        <Link href="/" className="btn-primary inline-block">
          مسابقة جديدة
        </Link>
      </div>
    </div>
  );
}

function Podium({ top }: { top: ReturnType<typeof rankPlayers> }) {
  // الترتيب المرئي: الثاني - الأول - الثالث
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const height = (rank: number) => (rank === 1 ? "h-28" : rank === 2 ? "h-20" : "h-14");
  return (
    <div className="flex items-end justify-center gap-3" dir="ltr">
      {order.map((p) => (
        <div key={p.user_id} className="animate-pop flex w-24 flex-col items-center gap-1">
          <Avatar emoji={p.avatar} size="lg" />
          <span className="w-full truncate text-center text-sm font-bold" dir="rtl">
            {p.name}
          </span>
          <div
            className={`flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b from-indigo-400/40 to-indigo-500/10 pt-2 text-2xl ${height(p.rank)}`}
          >
            {MEDALS[p.rank - 1]}
          </div>
        </div>
      ))}
    </div>
  );
}
