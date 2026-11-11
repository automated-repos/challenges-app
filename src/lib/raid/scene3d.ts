// المشهد ثلاثي الأبعاد لقرية روبن هود (Three.js): مجسمات بسيطة منخفضة المضلعات بلا ملفات خارجية.
// إحداثيات اللعبة بالبكسل (x، y)؛ في المشهد كل مربع = وحدة واحدة: x → x، و y → z، والارتفاع على y.

import * as THREE from "three";
import { BASES, CHESTS, COLS, GRID, ROWS, TILE, WORLD_H, WORLD_W, type Team } from "./map";
import { renderBackground } from "./draw";
import { RAID_TEAMS } from "./state";

const U = 1 / TILE;
const MAP_W = WORLD_W * U;
const MAP_H = WORLD_H * U;

export interface HeroView {
  id: string;
  team: Team;
  x: number;
  y: number;
  a: number;
  carried: number;
  dead: boolean;
  shield: boolean;
  hurt: boolean;
  me: boolean;
}

export interface SceneView {
  heroes: HeroView[];
  arrows: { id: number; x: number; y: number; a: number; t: Team }[];
  chests: boolean[];
  drops: { i: number; x: number; y: number; v: number }[];
  /** نقطة تتبعها الكاميرا (بالبكسل) */
  focus: { x: number; y: number };
  spectator: boolean;
  /** الوقت بالميلي ثانية (للحركات) */
  tf: number;
  dt: number;
}

function rand(c: number, r: number, k = 0) {
  const s = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** مستطيلات متصلة من نوع مربع واحد (البيوت مستطيلات) */
function rectsOf(kind: string): { c: number; r: number; w: number; h: number }[] {
  const seen = new Set<string>();
  const out: { c: number; r: number; w: number; h: number }[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (GRID[r][c] !== kind || seen.has(`${c},${r}`)) continue;
      let w = 0;
      while (c + w < COLS && GRID[r][c + w] === kind) w++;
      let h = 1;
      while (r + h < ROWS && GRID[r + h].slice(c, c + w).every((x) => x === kind)) h++;
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) seen.add(`${x},${y}`);
      out.push({ c, r, w, h });
    }
  return out;
}

const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });

function shadowy<T extends THREE.Object3D>(o: T): T {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return o;
}

// ---------- الشخصيات ----------

interface HeroModel {
  root: THREE.Group;
  body: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  sack: THREE.Mesh;
  shield: THREE.Mesh;
  ring: THREE.Mesh;
  phase: number;
  lastX: number;
  lastY: number;
  fall: number;
}

const SKIN = mat("#f1c27d");
const BOW = mat("#78350f");
const LEG = mat("#3f2a14");
const SACK = mat("#ca8a04", { metalness: 0.3 });

function buildHero(team: Team): HeroModel {
  const info = RAID_TEAMS[team];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bodyMat = mat(info.color);

  // الساقان
  const legGeo = new THREE.BoxGeometry(0.1, 0.28, 0.1);
  legGeo.translate(0, -0.14, 0);
  const legL = new THREE.Mesh(legGeo, LEG);
  const legR = new THREE.Mesh(legGeo, LEG);
  legL.position.set(0, 0.3, -0.1);
  legR.position.set(0, 0.3, 0.1);
  body.add(legL, legR);

  // الجسم والرأس
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.48, 8), bodyMat);
  torso.position.y = 0.53;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 8), LEG);
  belt.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), SKIN);
  head.position.y = 0.92;
  body.add(torso, belt, head);

  // القبعة: قبعة مدببة بريشة حمراء لرجال الغابة، وخوذة بريشة للحرس
  if (team === 1) {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 8), mat("#166534"));
    hat.position.set(-0.04, 1.12, 0);
    hat.rotation.z = 0.35;
    const feather = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.03), mat("#dc2626"));
    feather.position.set(-0.12, 1.12, 0.1);
    feather.rotation.z = 0.8;
    body.add(hat, feather);
  } else {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mat("#9ca3af", { metalness: 0.6, roughness: 0.4 }),
    );
    helmet.position.y = 0.95;
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), mat("#b91c1c"));
    plume.position.set(-0.02, 1.15, 0);
    body.add(helmet, plume);
  }

  // القوس أمامه (النموذج يواجه +x)
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 12, Math.PI), BOW);
  // قوس رأسي ينحني للأمام
  bow.position.set(0.22, 0.62, 0);
  bow.rotation.z = -Math.PI / 2;
  body.add(bow);

  // كيس الذهب على الظهر
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), SACK);
  sack.position.set(-0.27, 0.62, 0);
  sack.visible = false;
  body.add(sack);

  shadowy(body);

  // درع الظهور
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shield.position.y = 0.55;
  root.add(shield);

  // حلقة تحت قدمي اللاعب نفسه
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.48, 24),
    new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  return { root, body, bodyMat, legL, legR, sack, shield, ring, phase: 0, lastX: 0, lastY: 0, fall: 0 };
}

// ---------- المشهد ----------

export class RaidScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
  private camTarget = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  private heroes = new Map<string, HeroModel>();
  private arrows = new Map<number, THREE.Group>();
  private drops = new Map<number, THREE.Group>();
  private chests: THREE.Group[] = [];
  private water: THREE.Mesh[] = [];
  private flags: THREE.Mesh[] = [];
  private arrowParts: { shaft: THREE.BufferGeometry; head: THREE.BufferGeometry; mats: Record<Team, THREE.Material> };
  private coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 10);
  private coinMat = mat("#facc15", { metalness: 0.7, roughness: 0.3, emissive: "#a16207", emissiveIntensity: 0.3 });
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ray = new THREE.Raycaster();
  private w = 1;
  private h = 1;

  constructor(canvas: HTMLCanvasElement, lowPower: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const sky = new THREE.Color("#9fd3f0");
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 28, 70);

    // الإضاءة: سماء + شمس بظلال
    this.scene.add(new THREE.HemisphereLight("#dff2ff", "#3d5c2a", 1.4));
    const sun = new THREE.DirectionalLight("#fff4d6", 2.2);
    sun.position.set(MAP_W / 2 - 14, 26, MAP_H / 2 + 12);
    sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    sun.castShadow = true;
    const size = lowPower ? 1024 : 2048;
    sun.shadow.mapSize.set(size, size);
    const sc = sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 20;
    sc.bottom = -20;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.buildWorld(lowPower);

    const shaft = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5);
    shaft.rotateZ(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.05, 0.14, 5);
    head.rotateZ(-Math.PI / 2);
    head.translate(0.34, 0, 0);
    this.arrowParts = {
      shaft,
      head,
      mats: { 1: mat(RAID_TEAMS[1].color), 2: mat(RAID_TEAMS[2].color) },
    };
  }

  private buildWorld(lowPower: boolean) {
    const s = this.scene;

    // الأرضية: نفس رسم الخريطة المسطحة كخامة، ومرج واسع حولها
    const tex = new THREE.CanvasTexture(renderBackground(true, lowPower ? 1 : 2));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(MAP_W / 2, 0, MAP_H / 2);
    groundMesh.receiveShadow = true;
    s.add(groundMesh);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat("#2f5d22", { roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(MAP_W / 2, -0.02, MAP_H / 2);
    outer.receiveShadow = true;
    s.add(outer);

    // الأشجار (داخل الخريطة وحولها)
    const treeSpots: { x: number; z: number; k: number; c: number; r: number }[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (GRID[r][c] === "T")
          treeSpots.push({
            x: c + 0.5 + (rand(c, r) - 0.5) * 0.3,
            z: r + 0.5 + (rand(c, r, 1) - 0.5) * 0.3,
            k: 1,
            c,
            r,
          });
    // غابة كثيفة خارج الحدود حتى لا تنتهي الخريطة فجأة
    for (let i = 0; i < 260; i++) {
      const c = Math.floor(rand(i, 7) * (COLS + 16)) - 8;
      const r = Math.floor(rand(i, 13) * (ROWS + 16)) - 8;
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) continue;
      treeSpots.push({ x: c + rand(i, 3), z: r + rand(i, 5), k: 1.2, c: i, r: 99 });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.7, 6);
    trunkGeo.translate(0, 0.35, 0);
    const leafGeo = new THREE.IcosahedronGeometry(0.62, 0);
    const leafGeo2 = new THREE.ConeGeometry(0.55, 1.3, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat("#6b4423"), treeSpots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, mat("#2e7d32"), treeSpots.length);
    const pines = new THREE.InstancedMesh(leafGeo2, mat("#1f5f2a"), treeSpots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let nLeaf = 0;
    let nPine = 0;
    treeSpots.forEach((t, i) => {
      const size = (0.85 + rand(t.c, t.r, 2) * 0.45) * t.k;
      m.compose(v.set(t.x, 0, t.z), q.identity(), sc.set(size, size, size));
      trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(t.c, t.r, 4) * Math.PI);
      if (rand(t.c, t.r, 3) > 0.4) {
        m.compose(v.set(t.x, 0.95 * size, t.z), q, sc.set(size, size * 1.05, size));
        leaves.setMatrixAt(nLeaf++, m);
      } else {
        m.compose(v.set(t.x, 1.2 * size, t.z), q, sc.set(size, size, size));
        pines.setMatrixAt(nPine++, m);
      }
    });
    leaves.count = nLeaf;
    pines.count = nPine;
    for (const im of [trunks, leaves, pines]) {
      im.castShadow = true;
      im.receiveShadow = true;
      s.add(im);
    }

    // البيوت: جدران وسقف جملوني ومدخنة وباب
    const wallMat = mat("#ead9b6");
    const beamMat = mat("#6b4423");
    const roofMats = [mat("#a0462f"), mat("#8b5a2b"), mat("#7c2d12")];
    rectsOf("#").forEach((rc, i) => {
      const g = new THREE.Group();
      const wallH = 1.05;
      const walls = new THREE.Mesh(new THREE.BoxGeometry(rc.w - 0.1, wallH, rc.h - 0.1), wallMat);
      walls.position.y = wallH / 2;
      g.add(walls);
      // عوارض خشبية على الزوايا
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, wallH, 0.12), beamMat);
        beam.position.set((dx * (rc.w - 0.1)) / 2, wallH / 2, (dz * (rc.h - 0.1)) / 2);
        g.add(beam);
      }
      const along = rc.w >= rc.h; // السقف على امتداد الضلع الأطول
      const span = (along ? rc.h : rc.w) + 0.3;
      const len = (along ? rc.w : rc.h) + 0.3;
      const shape = new THREE.Shape();
      shape.moveTo(-span / 2, 0);
      shape.lineTo(span / 2, 0);
      shape.lineTo(0, span * 0.7);
      shape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
      roofGeo.translate(0, 0, -len / 2);
      if (along) roofGeo.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(roofGeo, roofMats[i % roofMats.length]);
      roof.position.y = wallH;
      // عارضة على قمة السقف حتى يظهر شكله من فوق
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(along ? len : 0.14, 0.12, along ? 0.14 : len), beamMat);
      ridge.position.y = wallH + span * 0.7;
      g.add(roof, ridge);
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.28), mat("#57534e"));
      chimney.position.set(along ? rc.w * 0.25 : 0.2, wallH + span * 0.5, along ? 0.2 : rc.h * 0.25);
      g.add(chimney);
      // باب ونافذتان على الجهة المواجهة للكاميرا
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.05), beamMat);
      door.position.set(0, 0.31, rc.h / 2 - 0.02);
      const winMat = mat("#93c5fd", { emissive: "#1e3a8a", emissiveIntensity: 0.2 });
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.05), winMat);
      w1.position.set(-rc.w / 2 + 0.45, 0.65, rc.h / 2 - 0.02);
      const w2 = w1.clone();
      w2.position.x = rc.w / 2 - 0.45;
      g.add(door, w1, w2);
      g.position.set(rc.c + rc.w / 2, 0, rc.r + rc.h / 2);
      s.add(shadowy(g));
    });

    // الماء
    const waterMat = new THREE.MeshStandardMaterial({
      color: "#2f7fc4",
      roughness: 0.15,
      metalness: 0.2,
      transparent: true,
      opacity: 0.9,
    });
    for (const rc of rectsOf("~")) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(rc.w, rc.h), waterMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(rc.c + rc.w / 2, 0.1, rc.r + rc.h / 2);
      w.receiveShadow = true;
      this.water.push(w);
      s.add(w);
      // حافة حجرية
      const rim = new THREE.Mesh(new THREE.BoxGeometry(rc.w + 0.2, 0.12, rc.h + 0.2), mat("#78716c"));
      rim.position.set(rc.c + rc.w / 2, 0.02, rc.r + rc.h / 2);
      rim.receiveShadow = true;
      s.add(rim);
    }

    // البئر
    for (const rc of rectsOf("w")) {
      const g = new THREE.Group();
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.6, 14, 1, true), mat("#6b7280"));
      stone.position.y = 0.3;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 6, 16), mat("#4b5563"));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.6;
      const inside = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), mat("#1e3a8a"));
      inside.rotation.x = -Math.PI / 2;
      inside.position.y = 0.35;
      g.add(stone, rim, inside);
      for (const d of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), beamMat);
        post.position.set(d * 0.8, 0.75, 0);
        g.add(post);
      }
      const roofW = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.7, 4), mat("#7c2d12"));
      roofW.position.y = 1.75;
      roofW.rotation.y = Math.PI / 4;
      g.add(roofW);
      g.position.set(rc.c + rc.w / 2, 0, rc.r + rc.h / 2);
      s.add(shadowy(g));
    }

    // أكشاك السوق بمظلات مخططة
    const stripes = document.createElement("canvas");
    stripes.width = 64;
    stripes.height = 8;
    const sx = stripes.getContext("2d")!;
    for (let i = 0; i < 8; i++) {
      sx.fillStyle = i % 2 ? "#f8fafc" : "#dc2626";
      sx.fillRect(i * 8, 0, 8, 8);
    }
    const stripeTex = new THREE.CanvasTexture(stripes);
    stripeTex.colorSpace = THREE.SRGBColorSpace;
    const awningMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.9 });
    for (const rc of rectsOf("s")) {
      const g = new THREE.Group();
      const counter = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.7), beamMat);
      counter.position.y = 0.25;
      g.add(counter);
      for (const [dx, dz] of [
        [-0.42, -0.3],
        [0.42, -0.3],
        [-0.42, 0.3],
        [0.42, 0.3],
      ]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), beamMat);
        post.position.set(dx, 0.6, dz);
        g.add(post);
      }
      const awning = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.95), awningMat);
      awning.position.y = 1.22;
      awning.rotation.x = 0.15;
      g.add(awning);
      // بضاعة: تفاح وجرار
      for (let i = 0; i < 3; i++) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat(i === 1 ? "#facc15" : "#ef4444"));
        fruit.position.set(-0.25 + i * 0.25, 0.56, 0.1);
        g.add(fruit);
      }
      g.position.set(rc.c + 0.5, 0, rc.r + 0.5);
      s.add(shadowy(g));
    }

    // المعسكرات: سياج وعلم كبير، وخيام للغابة وأبراج للحرس (على الحافة الخارجية)
    for (const team of [1, 2] as Team[]) {
      const b = BASES[team];
      const info = RAID_TEAMS[team];
      const x0 = b.x0 * U;
      const x1 = b.x1 * U;
      const z0 = b.y0 * U;
      const z1 = b.y1 * U;
      const cx = (x0 + x1) / 2;
      // أعمدة في الزوايا بلون الفريق
      for (const [px, pz] of [
        [x0, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), beamMat);
        post.position.set(px, 0.45, pz);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(info.color));
        cap.position.set(px, 0.95, pz);
        s.add(shadowy(post), shadowy(cap));
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), beamMat);
      pole.position.set(cx, 1.5, z0 + 0.4);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.6, 8, 1),
        mat(info.color, { side: THREE.DoubleSide, flatShading: false }),
      );
      flag.geometry.translate(0.5, 0, 0);
      flag.position.set(cx, 2.65, z0 + 0.4);
      if (team === 2) flag.rotation.y = Math.PI;
      this.flags.push(flag);
      s.add(shadowy(pole), shadowy(flag));

      // زينة خارج منطقة المشي (على عمود الحدود)
      const edgeX = team === 1 ? 0.5 : COLS - 0.5;
      for (const z of [z0 + 1.5, z1 - 1.5]) {
        if (team === 1) {
          const tent = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 4), mat("#4d7c0f"));
          tent.position.set(edgeX - 0.5, 0.7, z);
          tent.rotation.y = Math.PI / 4;
          s.add(shadowy(tent));
        } else {
          const tower = new THREE.Group();
          const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 2.6, 10), mat("#9ca3af"));
          base.position.y = 1.3;
          const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1, 10), mat("#991b1b"));
          top.position.y = 3.1;
          tower.add(base, top);
          tower.position.set(edgeX + 0.5, 0, z);
          s.add(shadowy(tower));
        }
      }
    }

    // الصناديق
    const boxMat = mat("#7c4a1e");
    const bandMat = mat("#facc15", { metalness: 0.6, roughness: 0.35 });
    for (const c of CHESTS) {
      const g = new THREE.Group();
      const big = c.value >= 20 ? 1.2 : 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.36), boxMat);
      box.position.y = 0.15;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8, 1, false, 0, Math.PI), boxMat);
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.3;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.38), bandMat);
      band.position.y = 0.27;
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.04), bandMat);
      lock.position.set(0, 0.22, 0.19);
      g.add(box, lid, band, lock);
      for (let i = 0; i < 3; i++) {
        const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
        coin.position.set(-0.12 + i * 0.12, 0.5, 0);
        coin.rotation.x = Math.PI / 2;
        g.add(coin);
      }
      g.scale.setScalar(big);
      g.position.set(c.x * U, 0, c.y * U);
      this.chests.push(shadowy(g));
      s.add(g);
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** من إحداثيات اللعبة (بالبكسل) وارتفاع بالوحدات إلى موقع على الشاشة */
  project(x: number, y: number, height: number) {
    const v = new THREE.Vector3(x * U, height, y * U).project(this.camera);
    return { sx: ((v.x + 1) / 2) * this.w, sy: ((1 - v.y) / 2) * this.h, visible: v.z < 1 && v.z > -1 };
  }

  /** النقطة على الأرض تحت مؤشر الفأرة (بالبكسل)، للتصويب */
  groundAt(sx: number, sy: number) {
    this.ray.setFromCamera(new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null;
    return { x: p.x * TILE, y: p.z * TILE };
  }

  render(v: SceneView) {
    const t = v.tf / 1000;
    const k = 1 - Math.exp(-v.dt * 8);

    // الكاميرا: من الأعلى والخلف بزاوية، تتبع اللاعب بنعومة
    const tight = this.camera.aspect < 1 ? 1.35 : 1;
    const target = v.spectator
      ? new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2)
      : new THREE.Vector3(
          Math.max(3, Math.min(MAP_W - 3, v.focus.x * U)),
          0,
          Math.max(2, Math.min(MAP_H - 3, v.focus.y * U)),
        );
    if (this.camTarget.distanceTo(target) > 12) this.camTarget.copy(target);
    else this.camTarget.lerp(target, k);
    const off = v.spectator ? new THREE.Vector3(0, 30, 17) : new THREE.Vector3(0, 10.5 * tight, 7.2 * tight);
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget);

    // الشخصيات
    const seen = new Set<string>();
    for (const h of v.heroes) {
      seen.add(h.id);
      let m = this.heroes.get(h.id);
      if (!m) {
        m = buildHero(h.team);
        m.lastX = h.x;
        m.lastY = h.y;
        this.heroes.set(h.id, m);
        this.scene.add(m.root);
      }
      const moved = Math.hypot(h.x - m.lastX, h.y - m.lastY);
      m.lastX = h.x;
      m.lastY = h.y;
      if (moved > 0.2 && moved < 40) m.phase += moved * 0.09;
      else m.phase *= 0.8;
      const swing = Math.sin(m.phase) * 0.6 * Math.min(1, moved / 2 + 0.2);
      m.legL.rotation.z = swing;
      m.legR.rotation.z = -swing;
      m.root.position.set(h.x * U, 0, h.y * U);
      // النموذج يواجه +x؛ زاوية اللعبة على المستوى x-z
      m.body.rotation.y = -h.a;
      m.body.position.y = moved > 0.2 ? Math.abs(Math.sin(m.phase)) * 0.06 : 0;
      m.fall += ((h.dead ? 1 : 0) - m.fall) * Math.min(1, v.dt * 10);
      m.body.rotation.x = m.fall * (Math.PI / 2);
      m.sack.visible = h.carried > 0 && !h.dead;
      m.sack.scale.setScalar(0.7 + Math.min(1, h.carried / 60));
      m.shield.visible = h.shield && !h.dead;
      m.ring.visible = h.me && !h.dead;
      m.bodyMat.emissive.set(h.hurt ? "#ff0000" : "#000000");
      m.bodyMat.emissiveIntensity = h.hurt ? 0.8 : 0;
    }
    for (const [id, m] of this.heroes)
      if (!seen.has(id)) {
        this.scene.remove(m.root);
        this.heroes.delete(id);
      }

    // السهام
    const seenA = new Set<number>();
    for (const a of v.arrows) {
      seenA.add(a.id);
      let g = this.arrows.get(a.id);
      if (!g) {
        g = new THREE.Group();
        g.add(
          new THREE.Mesh(this.arrowParts.shaft, BOW),
          new THREE.Mesh(this.arrowParts.head, this.arrowParts.mats[a.t]),
        );
        g.castShadow = true;
        this.arrows.set(a.id, g);
        this.scene.add(g);
      }
      g.position.set(a.x * U, 0.6, a.y * U);
      g.rotation.y = -a.a;
    }
    for (const [id, g] of this.arrows)
      if (!seenA.has(id)) {
        this.scene.remove(g);
        this.arrows.delete(id);
      }

    // الصناديق والذهب الساقط
    this.chests.forEach((g, i) => {
      g.visible = v.chests[i] ?? true;
      g.children.slice(4).forEach((coin, j) => (coin.position.y = 0.5 + Math.sin(t * 3 + j) * 0.05));
      g.rotation.y = Math.sin(t * 0.8 + i) * 0.15;
    });
    const seenD = new Set<number>();
    for (const d of v.drops) {
      seenD.add(d.i);
      let g = this.drops.get(d.i);
      if (!g) {
        g = new THREE.Group();
        const n = Math.min(6, 2 + Math.floor(d.v / 10));
        for (let i = 0; i < n; i++) {
          const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
          coin.position.set(Math.cos(i * 2.4) * 0.15, 0.03 + i * 0.045, Math.sin(i * 2.4) * 0.15);
          g.add(coin);
        }
        this.drops.set(d.i, shadowy(g));
        this.scene.add(g);
      }
      g.position.set(d.x * U, 0, d.y * U);
      g.rotation.y = t * 1.5;
    }
    for (const [id, g] of this.drops)
      if (!seenD.has(id)) {
        this.scene.remove(g);
        this.drops.delete(id);
      }

    // ماء وأعلام تتحرك
    for (const w of this.water) w.position.y = 0.1 + Math.sin(t * 1.5) * 0.01;
    for (const f of this.flags) {
      const pos = f.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(x * 4 - t * 5) * 0.08 * x);
      }
      pos.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.renderer.dispose();
  }
}
