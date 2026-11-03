import type { Player } from "./types";

// أسماء وألوان الفرق. الفريق رقم 1 هو "الأحمر" وهكذا، وبعد نفاد الألوان تتكرر مع رقم.
const PALETTE = [
  { name: "الأحمر", hex: "#ef4444", emoji: "🔴", card: "border-rose-400/50 bg-rose-500/15", text: "text-rose-200" },
  { name: "الأزرق", hex: "#3b82f6", emoji: "🔵", card: "border-sky-400/50 bg-sky-500/15", text: "text-sky-200" },
  {
    name: "الأخضر",
    hex: "#22c55e",
    emoji: "🟢",
    card: "border-emerald-400/50 bg-emerald-500/15",
    text: "text-emerald-200",
  },
  { name: "الأصفر", hex: "#eab308", emoji: "🟡", card: "border-amber-300/50 bg-amber-400/15", text: "text-amber-200" },
  {
    name: "البنفسجي",
    hex: "#a855f7",
    emoji: "🟣",
    card: "border-violet-400/50 bg-violet-500/15",
    text: "text-violet-200",
  },
  {
    name: "البرتقالي",
    hex: "#f97316",
    emoji: "🟠",
    card: "border-orange-400/50 bg-orange-500/15",
    text: "text-orange-200",
  },
];

export const MAX_TEAMS = 25;

export function teamInfo(team: number) {
  const base = PALETTE[(team - 1) % PALETTE.length];
  const round = Math.floor((team - 1) / PALETTE.length);
  return { ...base, name: `الفريق ${base.name}${round ? ` ${round + 1}` : ""}` };
}

export interface TeamStanding {
  team: number;
  members: Player[];
  score: number;
  correct: number;
  wrong: number;
  rank: number;
}

/** ترتيب الفرق بمجموع نقاط أعضائها. المتساوون في النقاط يأخذون نفس المركز. */
export function rankTeams(players: Player[]): TeamStanding[] {
  const map = new Map<number, Player[]>();
  for (const p of players) {
    if (p.team == null) continue;
    map.set(p.team, [...(map.get(p.team) ?? []), p]);
  }
  const teams = [...map.entries()]
    .map(([team, members]) => ({
      team,
      members: [...members].sort((a, b) => b.score - a.score),
      score: members.reduce((s, p) => s + p.score, 0),
      correct: members.reduce((s, p) => s + p.correct_count, 0),
      wrong: members.reduce((s, p) => s + p.wrong_count, 0),
    }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.team - b.team);

  let rank = 0;
  return teams.map((t, i) => {
    if (i === 0 || t.score !== teams[i - 1].score) rank = i + 1;
    return { ...t, rank };
  });
}

/** عدد الفرق التي تظهر في غرفة الانتظار: العدد الذي اختاره منشئ الغرفة، وإلا ما يكفي الجميع */
export function visibleTeamCount(players: Player[], teamSize: number, teamCount: number | null): number {
  const used = Math.max(0, ...players.map((p) => p.team ?? 0));
  if (teamCount) return Math.min(MAX_TEAMS, Math.max(teamCount, used));
  const needed = Math.ceil(players.length / teamSize);
  return Math.min(MAX_TEAMS, Math.max(2, needed, used));
}
