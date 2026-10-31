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
};
