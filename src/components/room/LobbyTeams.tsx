"use client";

import type { MouseEvent } from "react";
import { teamInfo, visibleTeamCount } from "@/lib/teams";
import type { Player, Room } from "@/lib/types";
import { Avatar } from "../ui";

type Run = (fn: string, args?: Record<string, unknown>) => void;

const blur = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();

/** إعداد وضع اللعب (منشئ الغرفة فقط): فردي أو فرق من 2 أو 3 أو 4 */
export function TeamSettings({ room, busy, run }: { room: Room; busy: boolean; run: Run }) {
  const options: { size: number | null; label: string }[] = [
    { size: null, label: "👤 فردي" },
    { size: 2, label: "فرق من 2" },
    { size: 3, label: "فرق من 3" },
    { size: 4, label: "فرق من 4" },
  ];
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 font-bold">وضع اللعب</h2>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = room.team_size === o.size;
          return (
            <button
              key={o.label}
              disabled={busy || active}
              onClick={(e) => {
                blur(e);
                run("set_team_size", { p_size: o.size });
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                active ? "bg-indigo-500 text-white" : "border border-white/15 bg-white/5 hover:bg-white/10"
              } disabled:cursor-default`}
            >
              {o.label}
            </button>
          );
        })}
        {room.team_size && (
          <button
            disabled={busy}
            onClick={(e) => {
              blur(e);
              run("shuffle_teams");
            }}
            className="btn-ghost ms-auto"
          >
            🎲 توزيع عشوائي
          </button>
        )}
      </div>
      {room.team_size && (
        <p className="mt-2 text-xs text-indigo-300">
          الإجابة الخاطئة تمنع الفريق كله من السؤال، والفائز هو الفريق صاحب أعلى مجموع نقاط.
        </p>
      )}
    </section>
  );
}

/** الفرق في غرفة الانتظار: كل لاعب يختار فريقه بنفسه */
export function LobbyTeams({
  room,
  players,
  userId,
  busy,
  run,
}: {
  room: Room;
  players: Player[];
  userId: string;
  busy: boolean;
  run: Run;
}) {
  const size = room.team_size!;
  const count = visibleTeamCount(players, size);
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  const unassigned = players.filter((p) => p.team == null);
  const byJoin = (a: Player, b: Player) => a.joined_at.localeCompare(b.joined_at);

  return (
    <section className="space-y-3">
      {unassigned.length > 0 && (
        <div className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-4">
          <h3 className="mb-2 text-sm font-bold text-indigo-200">
            بدون فريق ({unassigned.length}){myTeam == null && " ← اختر فريقك من الأسفل"}
          </h3>
          <ul className="flex flex-wrap gap-2">
            {unassigned.sort(byJoin).map((p) => (
              <Member key={p.user_id} p={p} room={room} userId={userId} />
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: count }, (_, i) => i + 1).map((team) => {
          const info = teamInfo(team);
          const members = players.filter((p) => p.team === team).sort(byJoin);
          const full = members.length >= size;
          const mine = myTeam === team;
          return (
            <div
              key={team}
              className={`rounded-3xl border p-4 transition ${info.card} ${mine ? "ring-2 ring-white/60" : ""}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className={`font-black ${info.text}`}>
                  {info.emoji} {info.name}
                </h3>
                <span className="text-xs text-indigo-200">
                  {members.length}/{size}
                </span>
              </div>
              <ul className="min-h-10 space-y-1.5">
                {members.map((p) => (
                  <Member key={p.user_id} p={p} room={room} userId={userId} />
                ))}
                {members.length === 0 && <li className="text-sm text-white/40">لا أحد بعد</li>}
              </ul>
              {!mine && (
                <button
                  disabled={busy || full}
                  onClick={(e) => {
                    blur(e);
                    run("join_team", { p_team: team });
                  }}
                  className="btn-ghost mt-3 w-full"
                >
                  {full ? "مكتمل" : "انضم لهذا الفريق"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Member({ p, room, userId }: { p: Player; room: Room; userId: string }) {
  const isHost = p.user_id === room.host_id;
  return (
    <li
      className={`animate-pop flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${
        p.user_id === userId ? "bg-white/15" : "bg-black/15"
      }`}
    >
      <Avatar emoji={p.avatar} size="sm" />
      <span className="flex-1 truncate text-sm">
        {p.name}
        {isHost && " 👑"}
      </span>
      {!isHost && (
        <span title={p.ready ? "جاهز" : "لم يجهز بعد"} className="text-sm">
          {p.ready ? "✅" : "⏳"}
        </span>
      )}
    </li>
  );
}
