import { rankPlayers, type Player, type Room } from "@/lib/types";
import { Avatar } from "../ui";

export function Scoreboard({ players, userId, room }: { players: Player[]; userId: string; room: Room }) {
  const ranked = rankPlayers(players);
  return (
    <aside className="h-fit rounded-3xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 font-bold">الترتيب</h2>
      <ol className="space-y-1.5">
        {ranked.map((p) => {
          const locked = room.status === "question" && room.locked_out.includes(p.user_id);
          const buzzing = room.buzzed_by === p.user_id;
          return (
            <li
              key={p.user_id}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 transition ${
                buzzing
                  ? "bg-amber-400/25 ring-2 ring-amber-300"
                  : p.user_id === userId
                    ? "bg-indigo-500/25"
                    : "bg-white/5"
              } ${locked ? "opacity-40" : ""}`}
            >
              <span className="w-5 text-center text-sm text-indigo-200">{p.rank}</span>
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
        })}
      </ol>
    </aside>
  );
}
