import Link from "next/link";
import {
  rankPlayers,
  type BankState,
  type C4State,
  type ChessState,
  type LudoState,
  type PirateState,
  type Player,
  type Room,
} from "@/lib/types";
import { islandCount, pirateSideName } from "./PirateGame";
import { bankColor, bankStandings } from "./BankGame";
import { C4_COLORS, c4SideName } from "./Connect4Game";
import type { SnakesState } from "@/lib/snakes";
import type { DominoResult } from "@/lib/domino";
import { DominoTile } from "./DominoGame";
import { rankTeams, teamInfo, type TeamStanding } from "@/lib/teams";
import { Avatar } from "../ui";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Results({ players, userId, room }: { players: Player[]; userId: string; room: Room }) {
  const ranked = rankPlayers(players);
  const me = ranked.find((p) => p.user_id === userId);
  const teams = room.team_size != null ? rankTeams(players) : [];
  const ludo = room.game === "ludo" && room.ludo?.sides ? room.ludo : null;
  const chess = room.game === "chess" && room.chess ? room.chess : null;
  const pirate = room.game === "pirate" && room.pirate?.sides ? room.pirate : null;
  const bank = room.game === "bank" && room.bank?.players ? room.bank : null;
  const c4 = room.game === "connect4" && room.c4?.sides ? room.c4 : null;
  const snakes = room.game === "snakes" && room.snakes?.sides ? room.snakes : null;
  const domino = room.game === "domino" && room.domino?.result ? room.domino.result : null;

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

      {c4 ? (
        <C4Result c4={c4} players={players} userId={userId} />
      ) : bank ? (
        <BankResult bank={bank} players={players} userId={userId} />
      ) : pirate ? (
        <PirateResult pirate={pirate} players={players} userId={userId} />
      ) : chess ? (
        <ChessResult chess={chess} players={players} userId={userId} />
      ) : ludo ? (
        <LudoPlaces ludo={ludo} players={players} userId={userId} />
      ) : snakes ? (
        <SnakesPlaces snakes={snakes} players={players} userId={userId} />
      ) : domino ? (
        <DominoPlaces result={domino} players={players} userId={userId} />
      ) : (
        <>
          {teams.length > 0 && <TeamResults teams={teams} myTeam={me?.team ?? null} />}
          {teams.length === 0 && ranked.length > 1 && <Podium top={ranked.slice(0, 3)} />}
        </>
      )}

      {(teams.length > 0 || ludo || domino || snakes || chess || pirate || bank || c4) && (
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

/** الشطرنج: الطرف الفائز أو التعادل */
function ChessResult({ chess, players, userId }: { chess: ChessState; players: Player[]; userId: string }) {
  const winner = chess.result?.winner ?? null;
  const colorName = { w: "الأبيض", b: "الأسود" } as const;
  const sideName = (color: "w" | "b") => {
    const s = chess.sides[color];
    if (s.team != null) return teamInfo(s.team).name;
    const p = players.find((x) => x.user_id === s.captain);
    return p ? `${p.avatar} ${p.name}` : "";
  };
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  const mine = (["w", "b"] as const).find((c) =>
    chess.sides[c].team != null ? chess.sides[c].team === myTeam : chess.sides[c].captain === userId,
  );
  const reason = chess.result?.reason;
  return (
    <div className="animate-pop rounded-3xl border border-amber-300/50 bg-amber-400/15 p-5 text-center">
      <div className="text-5xl">{winner ? "♚" : "🤝"}</div>
      <p className="mt-2 text-2xl font-black">
        {winner ? `فاز ${colorName[winner]}: ${sideName(winner)}!` : reason ? "تعادل" : "أُنهيت اللعبة بدون فائز"}
      </p>
      <p className="mt-1 text-indigo-100">
        {reason === "checkmate" ? "كش مات" : reason === "stalemate" ? "لا توجد حركة (تعادل)" : reason ? "تعادل" : ""}
        {mine && winner && <> • {mine === winner ? "🎉 مبروك!" : "حظ أوفر المرة القادمة 💪"}</>}
      </p>
      <p className="mt-2 text-xs text-indigo-200">{chess.moves.length} حركة</p>
    </div>
  );
}

/** قرصان المعرفة: القرصان الأعظم وترتيب الجميع بعدد الجزر */
function PirateResult({ pirate, players, userId }: { pirate: PirateState; players: Player[]; userId: string }) {
  const sides = pirate.sides ?? [];
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  const order = sides.map((_, i) => i).sort((a, b) => islandCount(pirate, b) - islandCount(pirate, a));
  // الفائز: من سيطر على الخريطة، أو (إن أُنهيت اللعبة مبكراً) صاحب أكثر الجزر وحده
  const top = order.length > 1 && islandCount(pirate, order[0]) === islandCount(pirate, order[1]) ? null : order[0];
  const winner = pirate.result?.winner ?? top;
  return (
    <section className="space-y-3">
      <div className="animate-pop rounded-3xl border border-amber-300/50 bg-amber-400/15 p-5 text-center">
        <div className="text-5xl">🏴‍☠️</div>
        <p className="mt-2 text-2xl font-black">
          {winner != null ? `القرصان الأعظم: ${pirateSideName(sides[winner], players)}!` : "لا يوجد قرصان أعظم (تعادل)"}
        </p>
        <p className="mt-1 text-indigo-100">
          {pirate.result ? "سيطر على الخريطة كلها 🗺️" : "أُنهيت اللعبة قبل السيطرة على الخريطة كلها"}
        </p>
      </div>
      <ol className="space-y-2">
        {order.map((i, k) => {
          const s = sides[i];
          const info = teamInfo(s.color);
          const isMe = s.team != null ? s.team === myTeam : s.user === userId;
          return (
            <li
              key={i}
              className={`animate-pop flex items-center gap-3 rounded-2xl border px-4 py-3 ${info.card} ${
                isMe ? "ring-2 ring-white/60" : ""
              }`}
            >
              <span className="w-8 text-center text-2xl">{MEDALS[k] ?? k + 1}</span>
              <span className="h-4 w-4 rounded-full" style={{ background: info.hex }} />
              <span className={`flex-1 truncate font-black ${info.text}`}>{pirateSideName(s, players)}</span>
              <span className="text-sm text-indigo-200">🏝️ {islandCount(pirate, i)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** إمبراطورية المدن: الترتيب بالثروة */
function BankResult({ bank, players, userId }: { bank: BankState; players: Player[]; userId: string }) {
  const order = bank.players ?? [];
  const standings = bankStandings(bank);
  const winner = bank.result?.winner ?? null;
  const name = (i: number) => {
    const p = players.find((x) => x.user_id === order[i]);
    return p ? `${p.avatar} ${p.name}` : "لاعب غادر";
  };
  return (
    <section className="space-y-3">
      <div className="animate-pop rounded-3xl border border-amber-300/50 bg-amber-400/15 p-5 text-center">
        <div className="text-5xl">🏙️</div>
        <p className="mt-2 text-2xl font-black">
          {winner != null ? `أغنى رجل أعمال: ${name(winner)}!` : "تعادل في الثروة"}
        </p>
        <p className="mt-1 text-indigo-100">الثروة = النقود + قيمة المدن وترقياتها</p>
      </div>
      <ol className="space-y-2">
        {standings.map(({ i, worth }, k) => (
          <li
            key={i}
            className={`animate-pop flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 ${
              order[i] === userId ? "bg-indigo-500/20 ring-2 ring-white/40" : "bg-white/5"
            }`}
          >
            <span className="w-8 text-center text-2xl">{MEDALS[k] ?? k + 1}</span>
            <span className="h-4 w-4 rounded-full" style={{ background: bankColor(i) }} />
            <span className="flex-1 truncate font-black">{name(i)}</span>
            <span className="text-sm text-indigo-200" dir="ltr">
              {bank.out?.[i] ? "💸 أفلس" : `${worth.toLocaleString("en-US")} 💵`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** سلم وثعبان: ترتيب الوصول للمربع الأخير */
function SnakesPlaces({ snakes, players, userId }: { snakes: SnakesState; players: Player[]; userId: string }) {
  const sides = snakes.sides ?? [];
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  // من لم يصل (اللعبة أُنهيت مبكراً) يُرتب بعد الواصلين حسب مربعه
  const order = [
    ...snakes.places,
    ...sides
      .map((_, i) => i)
      .filter((i) => !snakes.places.includes(i))
      .sort((a, b) => snakes.pos[b] - snakes.pos[a]),
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-center font-bold text-indigo-200">🐍 ترتيب الوصول</h2>
      <ol className="space-y-2">
        {order.map((i, k) => {
          const s = sides[i];
          const finished = snakes.places.includes(i);
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
                {finished ? "🏁 وصل" : `المربع ${snakes.pos[i]}/${snakes.steps}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** أربعة على التوالي: الفائز أو التعادل */
function C4Result({ c4, players, userId }: { c4: C4State; players: Player[]; userId: string }) {
  const winner = c4.winner ?? null;
  const myTeam = players.find((p) => p.user_id === userId)?.team ?? null;
  const mine = (c4.sides ?? []).findIndex((s) => (s.team != null ? s.team === myTeam : s.user === userId));
  const draw = !c4.grid?.includes("0") && winner == null;
  return (
    <div className="animate-pop rounded-3xl border border-amber-300/50 bg-amber-400/15 p-5 text-center">
      <div className="flex justify-center gap-1 text-5xl">
        {winner != null ? (
          <span className="inline-block h-12 w-12 rounded-full" style={{ background: C4_COLORS[winner] }} />
        ) : (
          "🤝"
        )}
      </div>
      <p className="mt-2 text-2xl font-black">
        {winner != null
          ? `فاز ${c4SideName(c4, winner, players)} بأربعة على التوالي!`
          : draw
            ? "تعادل: امتلأت اللوحة"
            : "أُنهيت اللعبة بدون فائز"}
      </p>
      {mine >= 0 && winner != null && (
        <p className="mt-1 text-indigo-100">{mine === winner ? "🎉 مبروك!" : "حظ أوفر المرة القادمة 💪"}</p>
      )}
    </div>
  );
}

/** الدومينو: الترتيب (من أنهى قطعه، ثم الأقل نقطاً) مع كشف القطع المتبقية */
function DominoPlaces({ result, players, userId }: { result: DominoResult; players: Player[]; userId: string }) {
  const hands = new Map(result.hands.map((h) => [h.user, h]));
  return (
    <section className="space-y-2">
      <h2 className="text-center font-bold text-indigo-200">
        🁫 {result.reason === "domino" ? "انتهت بإنهاء القطع" : "🔒 اللعبة اتقفلت: الأقل نقطاً يفوز"}
      </h2>
      <ol className="space-y-2">
        {result.rank.map((u, k) => {
          const h = hands.get(u);
          const p = players.find((x) => x.user_id === u);
          return (
            <li
              key={u}
              className={`animate-pop space-y-2 rounded-2xl border px-4 py-3 ${
                k === 0 ? "border-amber-300/60 bg-amber-400/15 text-lg" : "border-white/10 bg-white/5"
              } ${u === userId ? "ring-2 ring-white/60" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-8 text-center text-2xl">{MEDALS[k] ?? k + 1}</span>
                <span className="flex-1 truncate font-black">{p ? `${p.avatar} ${p.name}` : "لاعب غادر"}</span>
                <span className="text-sm text-indigo-200">
                  {h && h.tiles.length === 0 ? "🏁 خلّص قطعه" : `${h?.tiles.length ?? 0} قطع • ${h?.pips ?? 0} نقطة`}
                </span>
              </div>
              {h && h.tiles.length > 0 && (
                <div className="flex flex-wrap gap-1 ps-11" dir="ltr">
                  {h.tiles.map((t, i) => (
                    <DominoTile key={i} tile={t} size={16} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
