"use client";

// قرية روبن هود: لعبة حركية بين فريقين على canvas.
// كل لاعب يحرك شخصيته على جهازه ويرسل موقعه، ومنشئ الغرفة يشغّل المحاكاة (السهام والإصابات والذهب)
// ويبث الحالة للجميع عبر Supabase Realtime Broadcast. النتيجة النهائية فقط تُكتب في القاعدة (raid_finish).

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Player, Room } from "@/lib/types";
import { errorMessage } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { CHESTS, WORLD_H, WORLD_W, arrowBlocked, moveCircle, type Team } from "@/lib/raid/map";
import {
  ARROW_LIFE,
  ARROW_SPEED,
  ARROW_DAMAGE,
  HERO_RADIUS,
  RaidEngine,
  firstSpawn,
  speedFor,
  type HeroSnap,
  type Report,
  type RosterEntry,
  type Snapshot,
} from "@/lib/raid/engine";
import { openRaidNet } from "@/lib/raid/net";
import { RAID_TEAMS } from "@/lib/raid/state";
import { drawArrow, drawChest, drawDrop, drawHero, hexAlpha, label, renderBackground } from "@/lib/raid/draw";
import { ErrorBox } from "../ui";

type Call = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

/** المحاكاة 30 مرة في الثانية، واللقطات كل 3 خطوات (10 في الثانية) */
const STEP_MS = 33;
const SNAP_EVERY = 3;
/** كل لاعب يرسل موقعه كل 80 ميلي ثانية */
const REPORT_MS = 80;
/** مدى التصويب التلقائي (اللمس ولوحة المفاتيح) */
const AUTO_AIM = 460;

const KEYS: Record<string, "up" | "down" | "left" | "right" | "fire"> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "fire",
  KeyJ: "fire",
};

interface Controls {
  /** عصا اللمس (-1..1) */
  jx: number;
  jy: number;
  fire: boolean;
}

export function RaidGame({
  room,
  players,
  userId,
  isHost,
  offset,
  call,
}: {
  room: Room;
  players: Player[];
  userId: string;
  isHost: boolean;
  offset: RefObject<number>;
  call: Call;
}) {
  const raid = room.raid ?? {};
  // نص ثابت حتى لا تُعاد اللعبة مع كل تحديث للغرفة
  const rosterJson = JSON.stringify(raid.players ?? []);
  const startAt = raid.starts_at ? Date.parse(raid.starts_at) : 0;
  const endAt = raid.ends_at ? Date.parse(raid.ends_at) : 0;
  const myTeam = (raid.players ?? []).find((r) => r.user === userId)?.team ?? null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RaidEngine | null>(null);
  const ctlRef = useRef<Controls>({ jx: 0, jy: 0, fire: false });
  const namesRef = useRef(new Map<string, string>());
  const callRef = useRef(call);
  const [error, setError] = useState("");
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const [canFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenEnabled);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    namesRef.current = new Map(players.map((p) => [p.user_id, p.name]));
    // من خرج من الغرفة يخرج من اللعبة (نتجاهل القوائم الناقصة أثناء التحميل)
    if (players.some((p) => p.user_id === userId)) engineRef.current?.keepOnly(new Set(players.map((p) => p.user_id)));
  }, [players, userId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !startAt || !endAt) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const roster = JSON.parse(rosterJson) as RosterEntry[];
    const team: Team | null = roster.find((r) => r.user === userId)?.team ?? null;
    const bg = renderBackground();
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const now = () => Date.now() + (offset.current ?? 0);
    const name = (id: string) => namesRef.current.get(id) ?? "لاعب";

    // ---------- الحالة المحلية ----------
    const spawn = firstSpawn(roster, userId);
    const me = { x: spawn.x, y: spawn.y, a: team === 2 ? Math.PI : 0, life: 1 };
    let snap: Snapshot | null = null;
    let lastSnapAt = performance.now();
    const remote = new Map<string, { x: number; y: number }>();
    const arrows = new Map<number, { x: number; y: number; a: number; t: Team; born: number; dead: boolean }>();
    const floaters: { x: number; y: number; text: string; color: string; born: number }[] = [];
    const feed: { text: string; color: string; born: number }[] = [];
    const flash = new Map<string, number>();
    let hurtUntil = 0;
    const cam = { x: 0, y: 0, scale: 1 };

    const posOf = (id: string, s: Snapshot) =>
      id === userId ? me : (remote.get(id) ?? s.h.find((h) => h.i === id) ?? { x: -9999, y: -9999 });
    const near = (p: { x: number; y: number }) => Math.hypot(p.x - me.x, p.y - me.y) < 450;

    function applySnap(s: Snapshot) {
      snap = s;
      lastSnapAt = performance.now();
      const mine = s.h.find((h) => h.i === userId);
      if (mine) {
        // ظهور جديد، أو ابتعدنا كثيراً عما يراه الحَكَم: نعود لموقعه
        if (mine.l !== me.life || (mine.r === 0 && Math.hypot(mine.x - me.x, mine.y - me.y) > 220)) {
          me.x = mine.x;
          me.y = mine.y;
          me.life = mine.l;
        }
      }
      const seen = new Set<number>();
      for (const a of s.ar) {
        seen.add(a.i);
        if (!arrows.has(a.i)) arrows.set(a.i, { x: a.x, y: a.y, a: a.a, t: a.t, born: performance.now(), dead: false });
      }
      for (const id of arrows.keys()) if (!seen.has(id)) arrows.delete(id);

      const t = performance.now();
      for (const ev of s.ev) {
        const p = posOf(ev.u, s);
        if (ev.k === "shoot") {
          if (near(p)) sounds.shoot();
        } else if (ev.k === "hit") {
          flash.set(ev.u, t + 150);
          floaters.push({ x: p.x, y: p.y - 20, text: `-${ARROW_DAMAGE}`, color: "#f87171", born: t });
          if (ev.u === userId) {
            sounds.hit();
            hurtUntil = t + 250;
          } else if (ev.by === userId) sounds.tick();
        } else if (ev.k === "kill") {
          const killerTeam = s.h.find((h) => h.i === ev.by)?.t ?? 1;
          feed.push({
            text: `${name(ev.by)} 🏹 ${name(ev.u)}${ev.lost ? ` (أسقط 💰${ev.lost})` : ""}`,
            color: RAID_TEAMS[killerTeam].color,
            born: t,
          });
          if (ev.u === userId) {
            sounds.death();
            hurtUntil = t + 400;
          } else if (ev.by === userId) sounds.correct();
        } else if (ev.k === "pick") {
          floaters.push({ x: p.x, y: p.y - 22, text: `+${ev.v} 💰`, color: "#fde047", born: t });
          if (ev.u === userId) sounds.coin();
        } else if (ev.k === "bank") {
          const bankTeam = s.h.find((h) => h.i === ev.u)?.t ?? 1;
          floaters.push({ x: p.x, y: p.y - 22, text: `+${ev.v} 🏦`, color: "#86efac", born: t });
          feed.push({ text: `${name(ev.u)} أودع 💰${ev.v}`, color: RAID_TEAMS[bankTeam].color, born: t });
          if (bankTeam === team) sounds.bank();
        }
      }
      while (feed.length > 4) feed.shift();
    }

    // ---------- الشبكة والحَكَم ----------
    const engine = isHost ? new RaidEngine(roster, startAt, endAt) : null;
    engineRef.current = engine;
    const net = openRaidNet(room.id, {
      onReport: engine ? (r) => engine.report(r, now()) : undefined,
      onSnapshot: engine ? undefined : applySnap,
    });

    let hostTimer: ReturnType<typeof setInterval> | undefined;
    if (engine) {
      let n = 0;
      let finished = false;
      const finish = async (stats: ReturnType<RaidEngine["stats"]>, attempt = 0) => {
        try {
          await callRef.current("raid_finish", { p_stats: stats });
        } catch (e) {
          if (attempt < 3) setTimeout(() => finish(stats, attempt + 1), 1500);
          else setError(errorMessage(e));
        }
      };
      hostTimer = setInterval(() => {
        if (finished) return;
        const t = now();
        engine.step(t);
        if (++n % SNAP_EVERY === 0 || t >= endAt) {
          const s = engine.snapshot(t);
          net.sendSnapshot(s);
          applySnap(s);
        }
        if (t >= endAt) {
          finished = true;
          finish(engine.stats());
        }
      }, STEP_MS);
    }

    // ---------- التحكم ----------
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      if (down) keys.add(k);
      else keys.delete(k);
    };
    const keyDown = (e: KeyboardEvent) => onKey(e, true);
    const keyUp = (e: KeyboardEvent) => onKey(e, false);
    const mouse = { x: 0, y: 0, at: -Infinity, down: false };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mouse.x = e.offsetX;
      mouse.y = e.offsetY;
      mouse.at = performance.now();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      onMove(e);
      mouse.down = true;
    };
    const onUp = () => {
      mouse.down = false;
    };
    const onBlur = () => {
      keys.clear();
      mouse.down = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);

    // ---------- المقاس ----------
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    const resize = () => {
      cssW = wrap.clientWidth;
      const full = document.fullscreenElement === wrap;
      cssH = full ? window.innerHeight : Math.round(Math.min(cssW * 0.66, window.innerHeight * 0.72));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", resize);

    // ---------- حلقة الرسم ----------
    let raf = 0;
    let lastFrame = performance.now();
    let lastReport = 0;

    const nearestEnemy = () => {
      if (!snap) return null;
      let best: { x: number; y: number } | null = null;
      let bd = AUTO_AIM * AUTO_AIM;
      for (const h of snap.h) {
        if (h.t === team || h.r !== 0) continue;
        const p = remote.get(h.i) ?? h;
        const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    };

    const frame = (tf: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (tf - lastFrame) / 1000);
      lastFrame = tf;
      const t = now();
      const s = snap as Snapshot | null;
      const mine = s?.h.find((h) => h.i === userId);
      const playing = t >= startAt && t < endAt;
      const alive = team !== null && playing && (!mine || mine.r === 0);
      const ctl = ctlRef.current;

      // الحركة
      let mx = ctl.jx + (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
      let my = ctl.jy + (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      if (alive && len > 0.1) {
        const sp = speedFor(mine?.c ?? 0);
        [me.x, me.y] = moveCircle(me.x, me.y, mx * sp * dt, my * sp * dt, HERO_RADIUS);
      }

      // التصويب: الفأرة إن استُخدمت مؤخراً، وإلا أقرب خصم عند الرمي، وإلا اتجاه الحركة
      const firing = alive && (keys.has("fire") || mouse.down || ctl.fire);
      if (tf - mouse.at < 4000) {
        me.a = Math.atan2(cam.y + mouse.y / cam.scale - me.y, cam.x + mouse.x / cam.scale - me.x);
      } else {
        const target = firing ? nearestEnemy() : null;
        if (target) me.a = Math.atan2(target.y - me.y, target.x - me.x);
        else if (len > 0.1) me.a = Math.atan2(my, mx);
      }

      if (team !== null) {
        const rep: Report = {
          u: userId,
          x: Math.round(me.x),
          y: Math.round(me.y),
          a: Math.round(me.a * 100) / 100,
          f: firing,
          l: me.life,
        };
        if (engine) engine.report(rep, t);
        else if (tf - lastReport >= REPORT_MS) {
          lastReport = tf;
          net.sendReport(rep);
        }
      }

      // تنعيم حركة الآخرين، وتقدّم السهام بين اللقطات
      const k = 1 - Math.exp(-dt * 14);
      if (s)
        for (const h of s.h) {
          if (h.i === userId) continue;
          const r = remote.get(h.i);
          if (!r || Math.hypot(h.x - r.x, h.y - r.y) > 200) remote.set(h.i, { x: h.x, y: h.y });
          else {
            r.x += (h.x - r.x) * k;
            r.y += (h.y - r.y) * k;
          }
        }
      for (const a of arrows.values()) {
        if (a.dead) continue;
        a.x += Math.cos(a.a) * ARROW_SPEED * dt;
        a.y += Math.sin(a.a) * ARROW_SPEED * dt;
        if (arrowBlocked(a.x, a.y) || tf - a.born > ARROW_LIFE * 1000 + 150) a.dead = true;
      }

      // الكاميرا
      if (team !== null) {
        const viewW = Math.min(WORLD_W, Math.max(480, Math.min(cssW, 820)));
        cam.scale = cssW / viewW;
      } else {
        cam.scale = Math.min(cssW / WORLD_W, cssH / WORLD_H);
      }
      const vw = cssW / cam.scale;
      const vh = cssH / cam.scale;
      const fx = team !== null ? me.x : WORLD_W / 2;
      const fy = team !== null ? me.y : WORLD_H / 2;
      cam.x = vw >= WORLD_W ? (WORLD_W - vw) / 2 : Math.max(0, Math.min(WORLD_W - vw, fx - vw / 2));
      cam.y = vh >= WORLD_H ? (WORLD_H - vh) / 2 : Math.max(0, Math.min(WORLD_H - vh, fy - vh / 2));

      // ---------- الرسم ----------
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#14250f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const z = dpr * cam.scale;
      ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
      ctx.drawImage(bg, 0, 0);

      CHESTS.forEach((c, i) => drawChest(ctx, c.x, c.y, c.value, s ? s.ch[i] === 1 : true));
      if (s) for (const d of s.dr) drawDrop(ctx, d.x, d.y, d.v, font);
      for (const a of arrows.values()) if (!a.dead) drawArrow(ctx, a.x, a.y, a.a, a.t);

      // الشخصيات (الأبعد للأعلى أولاً)
      const heroes: { h: HeroSnap | null; entry: RosterEntry; x: number; y: number; a: number }[] = [];
      for (const entry of roster) {
        const h = s?.h.find((x) => x.i === entry.user) ?? null;
        if (s && !h) continue; // خرج من اللعبة
        if (entry.user === userId) heroes.push({ h, entry, x: me.x, y: me.y, a: me.a });
        else {
          const p = remote.get(entry.user) ?? h ?? firstSpawn(roster, entry.user);
          heroes.push({ h, entry, x: p.x, y: p.y, a: h?.a ?? (entry.team === 2 ? Math.PI : 0) });
        }
      }
      heroes.sort((p, q) => p.y - q.y);
      for (const { h, entry, x, y, a } of heroes) {
        drawHero(
          ctx,
          {
            x,
            y,
            angle: a,
            team: entry.team,
            name: name(entry.user),
            hp: h?.hp ?? 100,
            carried: h?.c ?? 0,
            me: entry.user === userId,
            dead: !!h && h.r !== 0,
            shield: (h?.s ?? 1) === 1,
            hurt: (flash.get(entry.user) ?? 0) > tf,
          },
          font,
        );
      }

      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        const age = (tf - f.born) / 1000;
        if (age > 1) {
          floaters.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - age;
        label(ctx, f.text, f.x, f.y - age * 24, `bold 13px ${font}`, f.color);
        ctx.globalAlpha = 1;
      }

      // ---------- الواجهة ----------
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.direction = "rtl";
      const sc = s?.sc ?? [0, 0];
      scoreBox(ctx, 8, 8, 1, sc[0], font, "left");
      scoreBox(ctx, cssW - 8, 8, 2, sc[1], font, "right");

      const left = Math.max(0, Math.ceil((t < startAt ? endAt - startAt : endAt - t) / 1000));
      const timer = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, cssW / 2 - 34, 8, 68, 28, 10);
      label(ctx, timer, cssW / 2, 28, `bold 17px ${font}`, left <= 10 && playing ? "#f87171" : "#ffffff");

      minimap(ctx, bg, 8, 44, Math.min(130, cssW * 0.28), s, userId, me, team);

      // آخر الأحداث
      ctx.textAlign = "right";
      let fyy = 60;
      for (const f of feed) {
        const age = (tf - f.born) / 1000;
        if (age > 6) continue;
        ctx.globalAlpha = age > 5 ? 6 - age : 1;
        ctx.font = `bold 12px ${font}`;
        const w = ctx.measureText(f.text).width + 14;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        roundRect(ctx, cssW - 8 - w, fyy - 15, w, 21, 7);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, cssW - 15, fyy);
        fyy += 25;
        ctx.globalAlpha = 1;
      }

      if (mine && mine.c > 0 && alive) {
        const msg = `💰 معك ${mine.c} ذهبة — أوصلها لمعسكرك ${team === 1 ? "⬅️" : "➡️"}`;
        ctx.font = `bold 14px ${font}`;
        const w = ctx.measureText(msg).width + 20;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        roundRect(ctx, cssW / 2 - w / 2, cssH - (touch ? 150 : 44), w, 30, 10);
        label(ctx, msg, cssW / 2, cssH - (touch ? 150 : 44) + 21, `bold 14px ${font}`, "#fde047");
      }

      if (hurtUntil > tf) {
        const g = ctx.createRadialGradient(cssW / 2, cssH / 2, cssH * 0.3, cssW / 2, cssH / 2, cssH * 0.8);
        g.addColorStop(0, "rgba(220,38,38,0)");
        g.addColorStop(1, "rgba(220,38,38,0.45)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cssW, cssH);
      }

      if (t < startAt) {
        overlay(
          ctx,
          cssW,
          cssH,
          `${Math.ceil((startAt - t) / 1000)}`,
          team ? `أنت في ${RAID_TEAMS[team].name} ${RAID_TEAMS[team].emoji}` : "تشاهد اللعبة",
          font,
        );
      } else if (t >= endAt) {
        overlay(ctx, cssW, cssH, "⌛", "انتهى الوقت! جارٍ حساب النتيجة...", font);
      } else if (mine && mine.r > 0) {
        overlay(ctx, cssW, cssH, "💀", `تعود بعد ${Math.max(0, Math.ceil((mine.r - t) / 1000))} ث`, font);
      } else if (!engine && t > startAt + 3000 && performance.now() - lastSnapAt > 4000) {
        overlay(ctx, cssW, cssH, "📡", "انقطع الاتصال بمنشئ الغرفة... ننتظر عودته", font);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(hostTimer);
      net.close();
      engineRef.current = null;
      ro.disconnect();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", resize);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, [room.id, isHost, userId, rosterJson, startAt, endAt, offset, touch]);

  function toggleFullscreen() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.requestFullscreen().catch(() => {});
  }

  const setStick = (x: number, y: number) => {
    ctlRef.current.jx = x;
    ctlRef.current.jy = y;
  };
  const setFire = (on: boolean) => {
    ctlRef.current.fire = on;
  };

  return (
    <div className="space-y-3">
      <div
        ref={wrapRef}
        dir="ltr"
        className="relative w-full select-none overflow-hidden rounded-2xl border border-white/10 bg-[#14250f]"
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="block w-full touch-none" style={{ cursor: "crosshair" }} />
        {canFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute bottom-2 right-2 rounded-lg bg-black/50 px-2 py-1 text-sm text-white hover:bg-black/70"
            style={
              touch ? { top: 44, bottom: "auto", left: "50%", right: "auto", transform: "translateX(-50%)" } : undefined
            }
            title="ملء الشاشة"
          >
            ⛶
          </button>
        )}
        {touch && myTeam !== null && (
          <>
            <Joystick onChange={setStick} />
            <button
              type="button"
              aria-label="ارمِ سهماً"
              className="absolute bottom-6 right-6 flex h-20 w-20 touch-none items-center justify-center rounded-full border-4 border-white/40 bg-rose-500/60 text-3xl shadow-lg active:bg-rose-500/90"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFire(true);
              }}
              onPointerUp={() => setFire(false)}
              onPointerCancel={() => setFire(false)}
              onLostPointerCapture={() => setFire(false)}
            >
              🏹
            </button>
          </>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-2xl bg-white/5 px-4 py-2 text-sm text-indigo-200">
        {myTeam ? (
          <span className={`font-bold ${RAID_TEAMS[myTeam].text}`}>
            أنت في {RAID_TEAMS[myTeam].name} {RAID_TEAMS[myTeam].emoji}
          </span>
        ) : (
          <span>👀 دخلت بعد البدء، تشاهد فقط</span>
        )}
        {touch ? (
          <span>العصا للحركة • 🏹 للرمي (يصوّب على أقرب خصم)</span>
        ) : (
          <span>WASD أو الأسهم للحركة • الفأرة للتصويب والرمي • مسافة = رمي على أقرب خصم</span>
        )}
        <span>اجمع 💰 من الصناديق وأوصلها لمعسكرك</span>
      </div>
    </div>
  );
}

function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx *= max / d;
      dy *= max / d;
    }
    setKnob({ x: dx, y: dy });
    onChange(dx / max, dy / max);
  };
  const reset = () => {
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };
  return (
    <div
      className="absolute bottom-6 left-6 h-28 w-28 touch-none rounded-full border-4 border-white/30 bg-black/30"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e);
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/60 shadow"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

// ---------- أدوات الرسم للواجهة ----------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function scoreBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  team: Team,
  gold: number,
  font: string,
  side: "left" | "right",
) {
  const info = RAID_TEAMS[team];
  const text = `${info.emoji} ${gold} 💰`;
  ctx.font = `bold 15px ${font}`;
  const w = ctx.measureText(text).width + 20;
  const bx = side === "left" ? x : x - w;
  ctx.fillStyle = hexAlpha(info.dark, 0.85);
  roundRect(ctx, bx, y, w, 28, 10);
  ctx.strokeStyle = info.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  label(ctx, text, bx + w / 2, y + 20, `bold 15px ${font}`, "#ffffff");
}

function overlay(ctx: CanvasRenderingContext2D, w: number, h: number, big: string, small: string, font: string) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, w, h);
  label(ctx, big, w / 2, h / 2, `900 56px ${font}`, "#ffffff");
  label(ctx, small, w / 2, h / 2 + 40, `bold 18px ${font}`, "#e0e7ff");
}

function minimap(
  ctx: CanvasRenderingContext2D,
  bg: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  s: Snapshot | null,
  userId: string,
  me: { x: number; y: number },
  team: Team | null,
) {
  const k = w / WORLD_W;
  const h = WORLD_H * k;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(bg, x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#fde047";
  CHESTS.forEach((c, i) => {
    if (s && s.ch[i] !== 1) return;
    ctx.fillRect(x + c.x * k - 1.5, y + c.y * k - 1.5, 3, 3);
  });
  if (!s) return;
  for (const hh of s.h) {
    if (hh.r !== 0) continue;
    const p = hh.i === userId ? me : hh;
    // الخصوم البعيدون لا يظهرون إلا إن كانوا يحملون ذهباً
    if (team !== null && hh.t !== team && hh.c === 0) continue;
    ctx.fillStyle = hh.i === userId ? "#ffffff" : RAID_TEAMS[hh.t].color;
    ctx.beginPath();
    ctx.arc(x + p.x * k, y + p.y * k, hh.i === userId ? 3 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
