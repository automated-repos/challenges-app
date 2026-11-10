// أصوات بسيطة بدون ملفات خارجية
let ctx: AudioContext | null = null;

function tone(freq: number, duration: number, type: OscillatorType = "sine", delay = 0) {
  if (typeof window === "undefined") return;
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

export const sounds = {
  buzz: () => tone(880, 0.15, "square"),
  correct: () => {
    tone(660, 0.12);
    tone(990, 0.2, "sine", 0.12);
  },
  wrong: () => tone(180, 0.35, "sawtooth"),
  tick: () => tone(1200, 0.04),
  message: () => tone(740, 0.08, "triangle"),
  // قرية روبن هود
  shoot: () => tone(520, 0.06, "triangle"),
  hit: () => tone(240, 0.12, "square"),
  coin: () => {
    tone(1320, 0.06, "square");
    tone(1760, 0.1, "square", 0.06);
  },
  bank: () => {
    tone(660, 0.1, "triangle");
    tone(880, 0.1, "triangle", 0.1);
    tone(1100, 0.18, "triangle", 0.2);
  },
  death: () => {
    tone(330, 0.15, "sawtooth");
    tone(196, 0.3, "sawtooth", 0.15);
  },
};

// تشغيل مقطع صوتي (الملصقات الصوتية). مقطع واحد في كل مرة: الجديد يوقف السابق.
let clip: HTMLAudioElement | null = null;

export function playClip(src: string) {
  if (typeof window === "undefined") return;
  clip?.pause();
  clip = new Audio(src);
  clip.volume = 0.8;
  clip.play().catch(() => {}); // المتصفح قد يمنع التشغيل قبل أول تفاعل مع الصفحة
}
