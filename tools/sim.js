// 헤드리스로 몇 판 돌려 판 길이·공 개수·1등 분포를 본다.
// node tools/sim.js [판수] [항목수] [KEY=VAL ...]
const { makeSim } = require("../engine.js");

const games = +process.argv[2] || 6;
const nc = +process.argv[3] || 3;
const over = {};
for (const a of process.argv.slice(4)) { const [k, v] = a.split("="); over[k] = +v; }

function mulberry(s) {
  return () => { s |= 0; s = s + 0x6d2b79f5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const wins = new Array(nc).fill(0);
let totT = 0;
for (let g = 0; g < games; g++) {
  const sim = makeSim(nc, Object.assign({ random: mulberry(g + 1) }, over));
  sim.start();
  const t0 = Date.now();
  let worst = 0, line = [], leadChanges = 0, lead = -1;
  for (let f = 0; f < 60 * 200; f++) {
    const a = Date.now();
    const end = sim.step(1 / 60);
    worst = Math.max(worst, Date.now() - a);
    if (f % 300 === 0) line.push(sim.n);
    if (sim.n > 20) { const l = sim.leader(); if (l !== lead) { if (lead >= 0) leadChanges++; lead = l; } }
    if (end) break;
  }
  const w = sim.leader();
  wins[w]++;
  totT += sim.time;
  console.log(`#${g} ${sim.time.toFixed(1)}s strokes=${sim.piston.stroke} n=${sim.n} fill=${sim.fill.toFixed(2)} counts=${sim.counts.join("/")} lead±${leadChanges} worstFrame=${worst}ms cpu=${Date.now() - t0}ms  n@5s: ${line.join(" ")}`);
}
console.log("wins", wins.join("/"), "avg", (totT / games).toFixed(1) + "s");
