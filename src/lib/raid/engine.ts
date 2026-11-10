// محاكاة قرية روبن هود. تعمل على جهاز منشئ الغرفة فقط (هو الحَكَم)، والباقون يرسلون مواقعهم ويستقبلون اللقطات.
// الحركة يحسبها كل لاعب على جهازه (حتى تكون فورية)، والمنشئ يتحقق منها ويحسم السهام والإصابات والذهب.

import { CHESTS, SPAWNS, arrowBlocked, circleBlocked, inBase, type Team } from "./map";

export const HERO_RADIUS = 11;
export const SPEED = 170; // بكسل في الثانية
export const MAX_HP = 100;
export const ARROW_SPEED = 560;
export const ARROW_LIFE = 0.85; // ثانية
export const ARROW_DAMAGE = 34;
export const SHOT_COOLDOWN = 450; // ميلي ثانية
export const RESPAWN_MS = 3000;
export const SHIELD_MS = 1500;
export const CHEST_RESPAWN_MS = 10_000;
export const DROP_LIFE_MS = 25_000;
export const PICK_RADIUS = 24;

/** حِمل الذهب يبطئ صاحبه (حتى 35%) */
export function speedFor(carried: number) {
  return SPEED * (1 - Math.min(0.35, carried / 150));
}

export interface RosterEntry {
  user: string;
  team: Team;
}

/** موضع الظهور الأول لكل لاعب: ثابت ومعروف للجميع حتى يتحرك قبل وصول أول لقطة */
export function firstSpawn(roster: RosterEntry[], user: string) {
  const me = roster.find((r) => r.user === user);
  if (!me) return SPAWNS[1][0];
  const idx = roster.filter((r) => r.team === me.team).findIndex((r) => r.user === user);
  const list = SPAWNS[me.team];
  return list[idx % list.length];
}

// ---------- الرسائل ----------

/** ما يرسله كل لاعب عن نفسه (~12 مرة في الثانية) */
export interface Report {
  u: string;
  x: number;
  y: number;
  /** زاوية التصويب */
  a: number;
  /** يضغط الرمي */
  f: boolean;
  /** رقم الحياة: يزيد مع كل ظهور جديد، فالرسائل القديمة من حياة سابقة تُهمل */
  l: number;
}

export interface HeroSnap {
  i: string;
  t: Team;
  x: number;
  y: number;
  a: number;
  hp: number;
  /** الذهب المحمول */
  c: number;
  /** الذهب المودَع في المعسكر */
  b: number;
  l: number;
  /** وقت العودة للحياة (بتوقيت الخادم)، أو 0 إن كان حياً */
  r: number;
  /** محمي بعد الظهور */
  s: 0 | 1;
  k: number;
  d: number;
}

export interface ArrowSnap {
  i: number;
  x: number;
  y: number;
  a: number;
  t: Team;
}

export interface DropSnap {
  i: number;
  x: number;
  y: number;
  v: number;
}

export type RaidEvent =
  | { k: "shoot"; u: string }
  | { k: "hit"; u: string; by: string }
  | { k: "kill"; u: string; by: string; lost: number }
  | { k: "pick"; u: string; v: number }
  | { k: "bank"; u: string; v: number };

export interface Snapshot {
  /** توقيت الخادم */
  t: number;
  h: HeroSnap[];
  ar: ArrowSnap[];
  /** 1 = الصندوق متاح */
  ch: (0 | 1)[];
  dr: DropSnap[];
  /** ذهب كل فريق في معسكره */
  sc: [number, number];
  ev: RaidEvent[];
}

export interface PlayerStats {
  g: number;
  k: number;
  d: number;
}

// ---------- المحاكاة ----------

interface Hero {
  id: string;
  team: Team;
  x: number;
  y: number;
  angle: number;
  fire: boolean;
  hp: number;
  carried: number;
  banked: number;
  life: number;
  respawnAt: number; // 0 = حي
  shieldUntil: number;
  nextShot: number;
  lastReport: number;
  kills: number;
  deaths: number;
}

interface Arrow {
  id: number;
  owner: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  dies: number;
}

interface Drop {
  id: number;
  x: number;
  y: number;
  value: number;
  dies: number;
}

export class RaidEngine {
  private heroes = new Map<string, Hero>();
  private arrows: Arrow[] = [];
  private drops: Drop[] = [];
  private chestReady: number[] = CHESTS.map(() => 0);
  private events: RaidEvent[] = [];
  private nextId = 1;
  private last = 0;
  private startAt: number;
  private endAt: number;

  constructor(roster: RosterEntry[], startAt: number, endAt: number) {
    this.startAt = startAt;
    this.endAt = endAt;
    for (const r of roster) {
      const p = firstSpawn(roster, r.user);
      this.heroes.set(r.user, {
        id: r.user,
        team: r.team,
        x: p.x,
        y: p.y,
        angle: r.team === 1 ? 0 : Math.PI,
        fire: false,
        hp: MAX_HP,
        carried: 0,
        banked: 0,
        life: 1,
        respawnAt: 0,
        shieldUntil: startAt + SHIELD_MS,
        nextShot: 0,
        lastReport: startAt,
        kills: 0,
        deaths: 0,
      });
    }
  }

  /** يُخرج من غادر الغرفة (ذهبه المودَع يبقى لفريقه) */
  keepOnly(users: Set<string>) {
    for (const [id, h] of this.heroes) {
      if (users.has(id) || h.respawnAt === -1) continue;
      h.respawnAt = -1; // خارج اللعبة
      h.fire = false;
      if (h.carried > 0) this.drop(h.x, h.y, h.carried);
      h.carried = 0;
    }
  }

  /** موقع اللاعب كما حسبه جهازه: نقبله إن كان معقولاً */
  report(msg: Report, now: number) {
    const h = this.heroes.get(msg.u);
    if (!h || h.respawnAt === -1) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y) || !Number.isFinite(msg.a)) return;
    h.angle = msg.a;
    h.fire = !!msg.f;
    if (h.respawnAt !== 0 || msg.l !== h.life || now < this.startAt) return;

    const elapsed = Math.max(0, now - h.lastReport) / 1000;
    const maxStep = SPEED * elapsed * 1.5 + 24;
    let nx = msg.x;
    let ny = msg.y;
    const dist = Math.hypot(nx - h.x, ny - h.y);
    if (dist > maxStep) {
      // أسرع من المسموح (غش أو تأخر شبكة): نقرّبه بالقدر المسموح فقط
      nx = h.x + ((nx - h.x) / dist) * maxStep;
      ny = h.y + ((ny - h.y) / dist) * maxStep;
    }
    h.lastReport = now;
    if (circleBlocked(nx, ny, HERO_RADIUS - 2)) return;
    h.x = nx;
    h.y = ny;
  }

  step(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (now < this.startAt || now >= this.endAt) return;

    for (const h of this.heroes.values()) {
      if (h.respawnAt > 0 && now >= h.respawnAt) this.respawn(h, now);
      if (h.respawnAt !== 0) continue;
      if (h.fire && now >= h.nextShot) {
        h.nextShot = now + SHOT_COOLDOWN;
        const cos = Math.cos(h.angle);
        const sin = Math.sin(h.angle);
        this.arrows.push({
          id: this.nextId++,
          owner: h.id,
          team: h.team,
          x: h.x + cos * (HERO_RADIUS + 4),
          y: h.y + sin * (HERO_RADIUS + 4),
          vx: cos * ARROW_SPEED,
          vy: sin * ARROW_SPEED,
          angle: h.angle,
          dies: now + ARROW_LIFE * 1000,
        });
        this.events.push({ k: "shoot", u: h.id });
      }
    }

    this.moveArrows(dt, now);

    for (const h of this.heroes.values()) {
      if (h.respawnAt !== 0) continue;
      // الصناديق
      CHESTS.forEach((c, i) => {
        if (this.chestReady[i] > now) return;
        if ((c.x - h.x) ** 2 + (c.y - h.y) ** 2 > PICK_RADIUS ** 2) return;
        this.chestReady[i] = now + CHEST_RESPAWN_MS;
        h.carried += c.value;
        this.events.push({ k: "pick", u: h.id, v: c.value });
      });
      // ذهب سقط من لاعب
      this.drops = this.drops.filter((d) => {
        if ((d.x - h.x) ** 2 + (d.y - h.y) ** 2 > PICK_RADIUS ** 2) return true;
        h.carried += d.value;
        this.events.push({ k: "pick", u: h.id, v: d.value });
        return false;
      });
      // الإيداع في المعسكر
      if (h.carried > 0 && inBase(h.team, h.x, h.y)) {
        h.banked += h.carried;
        this.events.push({ k: "bank", u: h.id, v: h.carried });
        h.carried = 0;
      }
    }
    this.drops = this.drops.filter((d) => d.dies > now);
  }

  private moveArrows(dt: number, now: number) {
    const alive: Arrow[] = [];
    outer: for (const a of this.arrows) {
      // خطوتان صغيرتان حتى لا يعبر السهم الشخصية دون أن يصيبها
      for (let s = 0; s < 2; s++) {
        a.x += (a.vx * dt) / 2;
        a.y += (a.vy * dt) / 2;
        if (now >= a.dies || arrowBlocked(a.x, a.y)) continue outer;
        for (const h of this.heroes.values()) {
          if (h.respawnAt !== 0 || h.team === a.team) continue;
          if ((h.x - a.x) ** 2 + (h.y - a.y) ** 2 > (HERO_RADIUS + 4) ** 2) continue;
          if (now >= h.shieldUntil) this.damage(h, a.owner, now);
          continue outer;
        }
      }
      alive.push(a);
    }
    this.arrows = alive;
  }

  private damage(h: Hero, by: string, now: number) {
    h.hp -= ARROW_DAMAGE;
    if (h.hp > 0) {
      this.events.push({ k: "hit", u: h.id, by });
      return;
    }
    h.hp = 0;
    h.respawnAt = now + RESPAWN_MS;
    h.fire = false;
    h.deaths++;
    const killer = this.heroes.get(by);
    if (killer) killer.kills++;
    this.events.push({ k: "kill", u: h.id, by, lost: h.carried });
    if (h.carried > 0) this.drop(h.x, h.y, h.carried);
    h.carried = 0;
  }

  private drop(x: number, y: number, value: number) {
    this.drops.push({ id: this.nextId++, x, y, value, dies: (this.last || this.startAt) + DROP_LIFE_MS });
  }

  private respawn(h: Hero, now: number) {
    const list = SPAWNS[h.team];
    const p = list[Math.floor(Math.random() * list.length)];
    h.x = p.x;
    h.y = p.y;
    h.hp = MAX_HP;
    h.life++;
    h.respawnAt = 0;
    h.shieldUntil = now + SHIELD_MS;
    h.lastReport = now;
  }

  /** لقطة الحالة للبث. الأحداث تُرسل مرة واحدة ثم تُمسح */
  snapshot(now: number): Snapshot {
    const heroes = [...this.heroes.values()].filter((h) => h.respawnAt !== -1);
    const sc: [number, number] = [0, 0];
    for (const h of this.heroes.values()) sc[h.team - 1] += h.banked;
    const snap: Snapshot = {
      t: Math.round(now),
      h: heroes.map((h) => ({
        i: h.id,
        t: h.team,
        x: Math.round(h.x),
        y: Math.round(h.y),
        a: Math.round(h.angle * 100) / 100,
        hp: h.hp,
        c: h.carried,
        b: h.banked,
        l: h.life,
        r: h.respawnAt,
        s: now < h.shieldUntil ? 1 : 0,
        k: h.kills,
        d: h.deaths,
      })),
      ar: this.arrows.map((a) => ({
        i: a.id,
        x: Math.round(a.x),
        y: Math.round(a.y),
        a: Math.round(a.angle * 100) / 100,
        t: a.team,
      })),
      ch: this.chestReady.map((t) => (t <= now ? 1 : 0)),
      dr: this.drops.map((d) => ({ i: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.value })),
      sc,
      ev: this.events,
    };
    this.events = [];
    return snap;
  }

  /** النتيجة النهائية لكل لاعب (يشمل من خرج: ذهبه المودَع يُحسب لفريقه) */
  stats(): Record<string, PlayerStats> {
    const out: Record<string, PlayerStats> = {};
    for (const h of this.heroes.values()) out[h.id] = { g: h.banked, k: h.kills, d: h.deaths };
    return out;
  }
}
