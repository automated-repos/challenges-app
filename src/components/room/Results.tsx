import Link from "next/link";
import { rankPlayers, type LudoState, type Player, type Room } from "@/lib/types";
import { rankTeams, teamInfo, type TeamStanding } from "@/lib/teams";
import { Avatar } from "../ui";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Results({ players, userId, room }: { players: Player[]; userId: string; room: Room }) {
  const ranked = rankPlayers(players);
  const me = ranked.find((p) => p.user_id === userId);
  const teams = room.team_size != null ? rankTeams(players) : [];
  const ludo = room.game === "ludo" && room.ludo?.sides ? room.ludo : null;

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

      {ludo ? (
        <LudoPlaces ludo={ludo} players={players} userId={userId} />
      ) : (
        <>
          {teams.length > 0 && <TeamResults teams={teams} myTeam={me?.team ?? null} />}
          {teams.length === 0 && ranked.length > 1 && <Podium top={ranked.slice(0, 3)} />}
        </>
      )}

      {(teams.length > 0 || ludo) && (
        <h2 className="pt-2 text-center font-bold text-indigo-200">ترتيب اللاعبين بالنقاط</h2>
      )}

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

      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary inline-block">
          مسابقة جديدة
        </Link>
        <Link href="/history" className="btn-ghost inline-flex items-center px-5">
          🏆 لوحة الشرف
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

function TeamResults({ teams, myTeam }: { teams: TeamStanding[]; myTeam: number | null }) {
  const winners = teams.filter((t) => t.rank === 1);
  const tie = winners.length > 1;
  const iWon = myTeam != null && winners.some((t) => t.team === myTeam);
  return (
    <section className="space-y-3">
      <div className="animate-pop rounded-3xl border border-amber-300/50 bg-amber-400/15 p-5 text-center">
        <div className="text-5xl">{tie ? "🤝" : "🏆"}</div>
        <p className="mt-2 text-2xl font-black">
          {tie
            ? `تعادل بين ${winners.map((t) => teamInfo(t.team).name).join(" و")}`
            : `فاز ${teamInfo(winners[0].team).emoji} ${teamInfo(winners[0].team).name}!`}
        </p>
        {myTeam != null && (
          <p className="mt-1 text-indigo-100">{iWon ? "🎉 مبروك لفريقك!" : "حظ أوفر المرة القادمة 💪"}</p>
        )}
      </div>

      <ol className="space-y-2">
        {teams.map((t) => {
          const info = teamInfo(t.team);
          return (
            <li
              key={t.team}
              className={`animate-pop rounded-2xl border px-4 py-3 ${info.card} ${
                t.team === myTeam ? "ring-2 ring-white/60" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-8 text-center text-2xl">{MEDALS[t.rank - 1] ?? t.rank}</span>
                <span className={`flex-1 truncate text-lg font-black ${info.text}`}>
                  {info.emoji} {info.name}
                </span>
                <span className="text-sm text-indigo-200">
                  ✅ {t.correct} • ❌ {t.wrong}
                </span>
                <span dir="ltr" className="w-14 text-left text-2xl font-black tabular-nums">
                  {t.score}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 ps-11">
                {t.members.map((p) => (
                  <span
                    key={p.user_id}
                    className="flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-sm"
                  >
                    {p.avatar} {p.name}
                    <span dir="ltr" className="text-xs text-indigo-200 tabular-nums">
                      {p.score}
                    </span>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** لودو: ترتيب الوصول للنهاية */
function LudoPlaces({ ludo, players, userId }: { ludo: LudoState; players: Player[]; userId: string }) {
  const sides = ludo.sides ?? [];
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  // من لم يصل (اللعبة أُنهيت مبكراً) يُرتب بعد الواصلين حسب تقدمه
  const order = [
    ...ludo.places,
    ...sides
      .map((_, i) => i)
      .filter((i) => !ludo.places.includes(i))
      .sort((a, b) => ludo.pos[b] - ludo.pos[a]),
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-center font-bold text-indigo-200">🎲 ترتيب الوصول</h2>
      <ol className="space-y-2">
        {order.map((i, k) => {
          const s = sides[i];
          const finished = ludo.places.includes(i);
          const info = teamInfo(s.color);
          const p = s.user ? players.find((x) => x.user_id === s.user) : null;
          const name = s.team != null ? info.name : p ? `${p.avatar} ${p.name}` : "لاعب غادر";
          const isMe = s.team != null ? s.team === myTeam : s.user === userId;
          return (
            <li
              key={i}
              className={`animate-pop flex items-center gap-3 rounded-2xl border px-4 py-3 ${info.card} ${
                k === 0 ? "text-lg" : ""
              } ${isMe ? "ring-2 ring-white/60" : ""}`}
            >
              <span className="w-8 text-center text-2xl">{finished ? (MEDALS[k] ?? k + 1) : "—"}</span>
              <span className="h-4 w-4 rounded-full" style={{ background: info.hex }} />
              <span className={`flex-1 truncate font-black ${info.text}`}>{name}</span>
              <span className="text-sm text-indigo-200">
                {finished ? "🏁 وصل" : `${Math.max(ludo.pos[i], 0)}/${ludo.steps}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
