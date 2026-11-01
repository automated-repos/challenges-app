import { rankPlayers, type Player, type Room } from "@/lib/types";
import { rankTeams, teamInfo } from "@/lib/teams";
import { Avatar } from "../ui";

export function Scoreboard({ players, userId, room }: { players: Player[]; userId: string; room: Room }) {
  if (room.team_size != null) return <TeamScoreboard players={players} userId={userId} room={room} />;

  const ranked = rankPlayers(players);
  return (
    <aside className="h-fit rounded-3xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 font-bold">الترتيب</h2>
      <ol className="space-y-1.5">
        {ranked.map((p) => (
          <PlayerRow key={p.user_id} p={p} label={String(p.rank)} userId={userId} room={room} />
        ))}
      </ol>
    </aside>
  );
}

function TeamScoreboard({ players, userId, room }: { players: Player[]; userId: string; room: Room }) {
  const teams = rankTeams(players);
  const spectators = players.filter((p) => p.team == null);
  return (
    <aside className="h-fit space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
      <h2 className="font-bold">ترتيب الفرق</h2>
      {teams.map((t) => {
        const info = teamInfo(t.team);
        return (
          <div key={t.team} className={`rounded-2xl border p-2 ${info.card}`}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <span className="w-5 text-center text-sm text-indigo-200">{t.rank}</span>
              <span className={`flex-1 truncate font-black ${info.text}`}>
                {info.emoji} {info.name}
              </span>
              <span dir="ltr" className={`text-lg font-black tabular-nums ${t.score < 0 ? "text-red-300" : ""}`}>
                {t.score}
              </span>
            </div>
            <ol className="space-y-1">
              {t.members.map((p) => (
                <PlayerRow key={p.user_id} p={p} userId={userId} room={room} compact />
              ))}
            </ol>
          </div>
        );
      })}
      {spectators.length > 0 && (
        <p className="text-xs text-indigo-300">👀 يشاهدون: {spectators.map((p) => p.name).join("، ")}</p>
      )}
    </aside>
  );
}

function PlayerRow({
  p,
  label,
  userId,
  room,
  compact = false,
}: {
  p: Player;
  label?: string;
  userId: string;
  room: Room;
  compact?: boolean;
}) {
  const locked = room.status === "question" && room.locked_out.includes(p.user_id);
  const buzzing = room.buzzed_by === p.user_id;
  return (
    <li
      className={`flex items-center gap-2 rounded-xl transition ${compact ? "px-2 py-1 text-sm" : "px-3 py-2"} ${
        buzzing
          ? "bg-amber-400/25 ring-2 ring-amber-300"
          : p.user_id === userId
            ? "bg-indigo-500/25"
            : compact
              ? "bg-black/15"
              : "bg-white/5"
      } ${locked ? "opacity-40" : ""}`}
    >
      {label && <span className="w-5 text-center text-sm text-indigo-200">{label}</span>}
      <Avatar emoji={p.avatar} size="sm" />
      <span className="flex-1 truncate">
        {buzzing && "🔔 "}
        {p.name}
      </span>
      <span dir="ltr" className={`font-bold tabular-nums ${p.score < 0 ? "text-red-300" : ""}`}>
        {p.score}
      </span>
    </li>
  );
}
