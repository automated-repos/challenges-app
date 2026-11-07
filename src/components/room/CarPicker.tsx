"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/supabase";
import { CAR_COLORS, CAR_SHAPES, CAR_SHAPE_NAMES, type Car, type CarShape } from "@/lib/bankBoard";
import type { Player, Room } from "@/lib/types";
import { ErrorBox } from "../ui";
import { CarIcon } from "./CarIcon";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

/** إمبراطورية المدن: كل لاعب يختار شكل سيارته ولونها قبل البدء (اللون لا يتكرر) */
export function CarPicker({
  room,
  players,
  userId,
  call,
}: {
  room: Room;
  players: Player[];
  userId: string;
  call: Call;
}) {
  const cars = (room.bank?.cars && !Array.isArray(room.bank.cars) ? room.bank.cars : {}) as Record<string, Car>;
  const mine = cars[userId];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // ألوان اختارها لاعبون آخرون ما زالوا في الغرفة
  const taken = new Set(
    Object.entries(cars)
      .filter(([u]) => u !== userId && players.some((p) => p.user_id === u))
      .map(([, c]) => c.color),
  );
  const shape: CarShape = mine?.shape ?? "sedan";
  const color = mine?.color ?? CAR_COLORS.find((c) => !taken.has(c)) ?? CAR_COLORS[0];

  async function save(next: Car) {
    setBusy(true);
    setError("");
    try {
      await call("bank_set_car", { p_shape: next.shape, p_color: next.color });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
      <h2 className="font-bold">🚗 اختر سيارتك</h2>
      <div className="flex justify-center">
        <CarIcon shape={shape} color={color} size={40} />
      </div>
      {!mine && <p className="text-center text-xs text-amber-200">لم تختر بعد. اضغط على شكل أو لون لتحجزه</p>}

      <div className="grid grid-cols-3 gap-2">
        {CAR_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => save({ shape: s, color })}
            className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-xs transition ${
              mine && shape === s
                ? "border-indigo-400 bg-indigo-500/30"
                : "border-white/10 bg-white/5 hover:bg-white/10"
            }`}
          >
            <CarIcon shape={s} color={color} size={16} />
            {CAR_SHAPE_NAMES[s]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {CAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy || taken.has(c)}
            onClick={() => save({ shape, color: c })}
            title={taken.has(c) ? "اختاره لاعب آخر" : ""}
            className={`h-9 w-9 rounded-full border-4 transition ${
              mine && color === c ? "scale-110 border-white" : "border-transparent"
            } ${taken.has(c) ? "cursor-not-allowed opacity-25" : "hover:scale-110"}`}
            style={{ background: c }}
          />
        ))}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* سيارات الباقين */}
      <ul className="flex flex-wrap justify-center gap-2">
        {players.map((p) => {
          const car = cars[p.user_id];
          return (
            <li key={p.user_id} className="flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-xs">
              {car ? <CarIcon shape={car.shape} color={car.color} size={10} /> : <span>❔</span>}
              {p.name}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
