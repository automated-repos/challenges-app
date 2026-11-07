"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessage, isConfigured } from "@/lib/supabase";
import { parseRoomCode } from "@/lib/roomCode";
import type { Player, Profile, Room } from "@/lib/types";
import { SetupNotice } from "../SetupNotice";
import { Avatar, Center, ErrorBox } from "../ui";
import { useAuth } from "../auth/useAuth";
import { AuthForm } from "../auth/AuthForm";
import { useRoom } from "./useRoom";
import { RoomPeopleContext } from "./RoomPeople";
import { Lobby } from "./Lobby";
import { QuestionView } from "./QuestionView";
import { PickCategory } from "./PickCategory";
import { StopGame } from "./StopGame";
import { LudoGame } from "./LudoGame";
import { SnakesGame } from "./SnakesGame";
import { DominoGame } from "./DominoGame";
import { ChessGame } from "./ChessGame";
import { PirateGame } from "./PirateGame";
import { SpyGame } from "./SpyGame";
import { BankGame } from "./BankGame";
import { Connect4Game } from "./Connect4Game";
import { Results } from "./Results";
import { Scoreboard } from "./Scoreboard";
import { VoiceChat } from "./VoiceChat";
import { teamInfo } from "@/lib/teams";
import { RoomChat } from "./RoomChat";

export function RoomPage() {
  const code = parseRoomCode(useSearchParams().get("code") ?? "");
  if (!isConfigured) return <SetupNotice />;
  if (code.length !== 6)
    return (
      <Center>
        <ErrorBox>رابط الغرفة غير صحيح</ErrorBox>
        <Link href="/" className="btn-ghost mt-4 inline-block">
          العودة للرئيسية
        </Link>
      </Center>
    );
  return <AuthGate key={code} code={code} />;
}

function AuthGate({ code }: { code: string }) {
  const auth = useAuth();
  if (auth.loading) return <Center>جارٍ التحميل...</Center>;
  if (!auth.profile || !auth.userId)
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <p className="mb-4 text-center text-indigo-200">
          سجّل الدخول للانضمام إلى الغرفة{" "}
          <span dir="ltr" className="font-mono font-bold text-white">
            {code}
          </span>
        </p>
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <AuthForm />
        </section>
      </main>
    );
  return <RoomInner code={code} userId={auth.userId} profile={auth.profile} />;
}

function RoomInner({ code, userId, profile }: { code: string; userId: string; profile: Profile }) {
  const { phase, error, room, players, offset, join, call, online, kicked } = useRoom(code, userId);
  const router = useRouter();
  const nextCode = room?.next_code ?? null;

  // منشئ الغرفة بدأ لعبة جديدة لنفس اللاعبين: ننتقل لها تلقائياً
  useEffect(() => {
    if (!nextCode) return;
    const t = setTimeout(() => router.replace(`/room/?code=${nextCode}`), 1500);
    return () => clearTimeout(t);
  }, [nextCode, router]);

  if (nextCode)
    return (
      <Center>
        <div className="text-5xl">🎮</div>
        <p className="mt-3 text-lg font-bold text-white">منشئ الغرفة بدأ لعبة جديدة!</p>
        <p className="mt-1">جارٍ نقلك للغرفة الجديدة...</p>
      </Center>
    );

  if (phase === "loading") return <Center>جارٍ التحميل...</Center>;
  if (phase === "error")
    return (
      <Center>
        <ErrorBox>{error}</ErrorBox>
        <Link href="/" className="btn-ghost mt-4 inline-block">
          العودة للرئيسية
        </Link>
      </Center>
    );
  if (phase === "need-join" || !room) return <JoinGate code={code} profile={profile} onJoin={join} kicked={kicked} />;

  const isHost = room.host_id === userId;

  return (
    <RoomPeopleContext.Provider
      value={{ online, canKick: isHost, hostId: room.host_id, kick: (u) => call("kick_player", { p_user: u }) }}
    >
      <main className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-4 sm:py-6">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-6 sm:gap-3">
          <Link href="/" className="text-lg font-black sm:text-xl">
            🏆 تحدي الأسئلة
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-sm">
              <span className="text-indigo-200">رمز الغرفة</span>
              <span dir="ltr" className="font-mono text-lg font-bold tracking-widest">
                {room.code}
              </span>
            </div>
            <Avatar emoji={profile.avatar} size="sm" />
          </div>
        </header>

        <VoiceChat roomId={room.id} {...voiceChannel(room, players, userId)} />

        {room.status === "lobby" && <Lobby room={room} players={players} userId={userId} isHost={isHost} call={call} />}

        {room.status === "playing" && room.game === "domino" && room.domino && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <DominoGame
              room={room}
              state={room.domino}
              players={players}
              userId={userId}
              isHost={isHost}
              offset={offset}
              call={call}
            />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "connect4" && room.c4 && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <Connect4Game room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "bank" && room.bank && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <BankGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "spy" && room.spy && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <SpyGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "pirate" && room.pirate && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <PirateGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "chess" && room.chess && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <ChessGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "snakes" && room.snakes && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <SnakesGame
              room={room}
              state={room.snakes}
              players={players}
              userId={userId}
              isHost={isHost}
              offset={offset}
              call={call}
            />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "playing" && room.game === "ludo" && room.ludo && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <LudoGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {(room.status === "writing" || room.status === "voting" || room.status === "round_end") && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <StopGame room={room} players={players} userId={userId} isHost={isHost} offset={offset} call={call} />
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {(room.status === "question" || room.status === "reveal" || room.status === "picking") && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            {room.status === "picking" ? (
              <PickCategory room={room} players={players} userId={userId} offset={offset} call={call} />
            ) : (
              <QuestionView
                key={room.current_index}
                room={room}
                players={players}
                userId={userId}
                isHost={isHost}
                offset={offset}
                call={call}
              />
            )}
            <Scoreboard players={players} userId={userId} room={room} call={call} />
          </div>
        )}

        {room.status === "finished" && <Results players={players} userId={userId} room={room} />}

        <RoomChat roomId={room.id} userId={userId} inGame={room.status === "question" || room.status === "reveal"} />
      </main>
    </RoomPeopleContext.Provider>
  );
}

function JoinGate({
  code,
  profile,
  onJoin,
  kicked,
}: {
  code: string;
  profile: Profile;
  onJoin: () => Promise<void>;
  kicked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    setBusy(true);
    setError("");
    try {
      await onJoin();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <div className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
        <h1 className="text-2xl font-bold">الانضمام للغرفة</h1>
        {kicked && (
          <p className="rounded-2xl bg-amber-400/15 p-3 text-sm text-amber-100">
            🔌 خرجت من الغرفة (انقطع اتصالك أو أخرجك منشئ الغرفة). اضغط انضمام للدخول من جديد.
          </p>
        )}
        <p dir="ltr" className="font-mono text-3xl tracking-[0.4em]">
          {code}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Avatar emoji={profile.avatar} size="lg" />
          <span className="text-xl font-bold">{profile.display_name}</span>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button onClick={join} disabled={busy} className="btn-primary w-full">
          {busy ? "جارٍ الانضمام..." : "انضمام"}
        </button>
        <Link href="/" className="block text-sm text-indigo-300 hover:underline">
          العودة للرئيسية
        </Link>
      </div>
    </main>
  );
}

/** غرفة الصوت: في الفرق أثناء اللعب لكل فريق غرفته، وإلا غرفة واحدة للجميع (نفس منطق دالة voice-token) */
function voiceChannel(room: Room, players: Player[], userId: string): { channel: string; label: string } {
  const team = players.find((p) => p.user_id === userId)?.team ?? null;
  const playing = room.status !== "lobby" && room.status !== "finished";
  if (room.team_size != null && playing && team != null) {
    const info = teamInfo(team);
    return { channel: `team-${team}`, label: `صوت ${info.name} ${info.emoji}` };
  }
  return { channel: "all", label: "صوت الغرفة" };
}
