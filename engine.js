// 꾹꾹 룰렛 물리 엔진 — 화면과 떼어 둬서 노드에서도 돌릴 수 있다(tools/sim.js).
// 단위는 상자 기준 가상 좌표(가로 1000 x 세로 800). 공은 위치 기반(verlet)으로 움직인다.
(function (root) {
  "use strict";

  var W = 1000, H = 800;
  // 상자: 위는 평평하고 아래가 오각형으로 좁아진다.
  var L = 60, R = 940, T = 170, Y1 = 560, B = 740, FL = 330, FR = 670;
  var POLY = [[L, T], [R, T], [R, Y1], [FR, B], [FL, B], [L, Y1]];
  // 프레스
  var PX = 500, PW = 330, PTH = 26, ROD = 36;
  var REST = T + 4, YMAX = B - 6 - PTH;

  var CFG = {
    R0: 36,          // 처음 공 반지름
    MINR: 7,         // 가장 작은 공
    SHRINK: 0.72,    // 눌리면 반지름이 이만큼으로
    G: 1600,         // 중력
    SUB: 6,          // 한 프레임 쪼개기
    CRUSH: 0.25,     // 프레스에 반지름의 이만큼 이상 파고들면 터짐
    BLOCK: 0.5,      // 못 터지는 공이 이만큼 박히면 막힌 것
    BLOCKN: 12,      // 막힌 공이 이만큼이면 프레스가 멈추고 올라감
    VDOWN: 820,
    VUP: 1100,
    RESTT: 0.22,
    HOLDT: 0.05,
    FILL: 0.6,       // 상자 넓이 대비 공 넓이가 이만큼이면 펑
    CAP: 2600,
    TMAX: 150
  };

  var EDGES = (function () {
    var cx = 0, cy = 0, i;
    for (i = 0; i < POLY.length; i++) { cx += POLY[i][0]; cy += POLY[i][1]; }
    cx /= POLY.length; cy /= POLY.length;
    var out = [];
    for (i = 0; i < POLY.length; i++) {
      var a = POLY[i], b = POLY[(i + 1) % POLY.length];
      var ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey);
      var nx = -ey / len, ny = ex / len;
      if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
      out.push({ ax: a[0], ay: a[1], nx: nx, ny: ny });
    }
    return out;
  })();

  var BOXAREA = (function () {
    var s = 0;
    for (var i = 0; i < POLY.length; i++) {
      var a = POLY[i], b = POLY[(i + 1) % POLY.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  })();

  function makeSim(nColors, opt) {
    opt = opt || {};
    var rnd = opt.random || Math.random;
    var C = {};
    for (var k in CFG) C[k] = opt[k] != null ? opt[k] : CFG[k];
    var CAP = C.CAP + 64;

    var x = new Float32Array(CAP), y = new Float32Array(CAP);
    var ox = new Float32Array(CAP), oy = new Float32Array(CAP);
    var r = new Float32Array(CAP), col = new Uint8Array(CAP), born = new Int32Array(CAP);
    var n = 0, area = 0;
    var counts = [];
    for (var c = 0; c < nColors; c++) counts.push(0);

    var CS = Math.ceil(C.MINR * 2.6);
    var GW = Math.ceil(W / CS) + 2, GH = Math.ceil(H / CS) + 2;
    var head = new Int32Array(GW * GH), next = new Int32Array(CAP);

    var P = { y: REST, phase: "wait", t: 0, stroke: 0, flash: 0 };
    var sim = {
      W: W, H: H, POLY: POLY, PX: PX, PW: PW, PTH: PTH, ROD: ROD, T: T, B: B, FL: FL, FR: FR,
      x: x, y: y, r: r, col: col, counts: counts, piston: P,
      state: "ready", time: 0, crushes: 0,
      onCrush: null,
      get n() { return n; },
      get fill() { return area / BOXAREA; }
    };

    function add(X, Y, Rr, cc, b, vx, vy) {
      if (n >= CAP) return -1;
      x[n] = X; y[n] = Y; ox[n] = X - (vx || 0); oy[n] = Y - (vy || 0);
      r[n] = Rr; col[n] = cc; born[n] = b;
      counts[cc]++; area += Math.PI * Rr * Rr;
      return n++;
    }
    function remove(i) {
      counts[col[i]]--; area -= Math.PI * r[i] * r[i];
      n--;
      if (i !== n) {
        x[i] = x[n]; y[i] = y[n]; ox[i] = ox[n]; oy[i] = oy[n];
        r[i] = r[n]; col[i] = col[n]; born[i] = born[n];
      }
    }

    // 처음 공: 색 순서를 섞어서 한 줄로
    var order = [];
    for (c = 0; c < nColors; c++) order.push(c);
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    var span = Math.min(R - L - 160, (nColors - 1) * 110);
    for (c = 0; c < nColors; c++) {
      var fx = nColors === 1 ? PX : PX - span / 2 + span * c / (nColors - 1);
      add(fx + (rnd() - 0.5) * 6, T + 150 + (rnd() - 0.5) * 10, C.R0, order[c], -1, 0, 0);
    }

    function crush(i) {
      var X = x[i], Y = y[i], Rr = r[i], cc = col[i];
      remove(i);
      var rc = Math.max(C.MINR, Rr * C.SHRINK);
      var a0 = rnd() * Math.PI * 2;
      for (var k = 0; k < 3; k++) {
        var a = a0 + k * 2.0944;
        var cx = Math.cos(a), cy = Math.sin(a);
        add(X + cx * rc * 0.7, Y + cy * rc * 0.5 + rc * 0.2, rc, cc, P.stroke, cx * 1.2, Math.abs(cy) * 0.6);
      }
      sim.crushes++;
      P.flash = 1;
      if (sim.onCrush) sim.onCrush(X, Y, Rr, cc);
    }

    // 원과 사각형: 겹치면 밀어내고 겹친 깊이를 돌려준다
    function pushRect(i, x0, y0, x1, y1) {
      var bx = x[i], by = y[i], br = r[i];
      if (bx + br <= x0 || bx - br >= x1 || by + br <= y0 || by - br >= y1) return 0;
      var cx = bx < x0 ? x0 : bx > x1 ? x1 : bx;
      var cy = by < y0 ? y0 : by > y1 ? y1 : by;
      var dx = bx - cx, dy = by - cy, d2 = dx * dx + dy * dy;
      if (d2 > 1e-6) {
        if (d2 >= br * br) return 0;
        var d = Math.sqrt(d2), pen = br - d;
        x[i] += dx / d * pen; y[i] += dy / d * pen;
        return pen;
      }
      // 중심이 안에 들어옴: 가장 가까운 면으로
      var dl = bx - x0, dr = x1 - bx, du = by - y0, dd = y1 - by;
      var m = Math.min(dl, dr, du, dd);
      if (m === dd) { y[i] = y1 + br; return dd + br; }
      if (m === du) { y[i] = y0 - br; return du + br; }
      if (m === dl) { x[i] = x0 - br; return dl + br; }
      x[i] = x1 + br; return dr + br;
    }

    function stepPiston(h) {
      if (P.phase === "wait") return;
      P.flash = Math.max(0, P.flash - h * 4);
      if (P.phase === "rest") {
        P.t += h;
        if (P.t >= C.RESTT) { P.phase = "down"; P.t = 0; P.stroke++; }
      } else if (P.phase === "down") {
        P.y += C.VDOWN * h;
        if (P.y >= YMAX) { P.y = YMAX; P.phase = "hold"; P.t = 0; }
      } else if (P.phase === "hold") {
        P.t += h;
        if (P.t >= C.HOLDT) { P.phase = "up"; P.t = 0; }
      } else if (P.phase === "up") {
        P.y -= C.VUP * h;
        if (P.y <= REST) { P.y = REST; P.phase = "rest"; P.t = 0; }
      }
    }

    function substep(h) {
      var i, j, boom = sim.state === "boom";
      if (!boom) stepPiston(h);
      var g = C.G * h * h, vmax = 2400 * h;
      for (i = 0; i < n; i++) {
        var vx = (x[i] - ox[i]) * 0.999, vy = (y[i] - oy[i]) * 0.999 + g;
        var v2 = vx * vx + vy * vy;
        if (v2 > vmax * vmax) { var s = vmax / Math.sqrt(v2); vx *= s; vy *= s; }
        ox[i] = x[i]; oy[i] = y[i];
        x[i] += vx; y[i] += vy;
      }
      if (boom) return;

      var x0 = PX - PW / 2, x1 = PX + PW / 2, py0 = P.y, py1 = P.y + PTH;
      var up = P.phase === "up" || P.phase === "rest";
      // 프레스
      for (i = 0; i < n; i++) {
        if (y[i] - r[i] > py1 || x[i] + r[i] < x0 || x[i] - r[i] > x1) continue;
        pushRect(i, x0, py0, x1, py1);
        pushRect(i, PX - ROD / 2, T - 60, PX + ROD / 2, py0);
        // 판 위에 얹힌 공은 옆으로 흘려 보낸다 (올라갈 때 천장에 끼지 않게)
        if (up && y[i] < py0 && py0 - T < r[i] * 2 + 30) {
          x[i] += (x[i] < PX ? -1 : 1) * 1.6;
        }
      }

      // 공끼리
      head.fill(-1);
      var maxR = 0;
      for (i = 0; i < n; i++) {
        var gx = (x[i] / CS | 0) + 1, gy = (y[i] / CS | 0) + 1;
        if (gx < 0) gx = 0; else if (gx >= GW) gx = GW - 1;
        if (gy < 0) gy = 0; else if (gy >= GH) gy = GH - 1;
        var cell = gy * GW + gx;
        next[i] = head[cell]; head[cell] = i;
        if (r[i] > maxR) maxR = r[i];
      }
      for (i = 0; i < n; i++) {
        var xi = x[i], yi = y[i], ri = r[i];
        var rng = Math.ceil((ri + maxR) / CS);
        var cx = (xi / CS | 0) + 1, cy = (yi / CS | 0) + 1;
        var ya = Math.max(0, cy - rng), yb = Math.min(GH - 1, cy + rng);
        var xa = Math.max(0, cx - rng), xb = Math.min(GW - 1, cx + rng);
        for (var yy = ya; yy <= yb; yy++) {
          for (var xx = xa; xx <= xb; xx++) {
            for (j = head[yy * GW + xx]; j !== -1; j = next[j]) {
              if (j <= i) continue;
              var dx = x[j] - xi, dy = y[j] - yi, rr = ri + r[j];
              var d2 = dx * dx + dy * dy;
              if (d2 >= rr * rr || d2 < 1e-8) continue;
              var d = Math.sqrt(d2), pen = (rr - d) / d;
              var mi = ri * ri, mj = r[j] * r[j], wi = mj / (mi + mj), wj = 1 - wi;
              xi -= dx * pen * wi; yi -= dy * pen * wi;
              x[j] += dx * pen * wj; y[j] += dy * pen * wj;
            }
          }
        }
        x[i] = xi; y[i] = yi;
      }

      // 벽
      for (i = 0; i < n; i++) {
        for (var e = 0; e < EDGES.length; e++) {
          var E = EDGES[e];
          var dd = (x[i] - E.ax) * E.nx + (y[i] - E.ay) * E.ny;
          if (dd < r[i]) { x[i] += E.nx * (r[i] - dd); y[i] += E.ny * (r[i] - dd); }
        }
      }

      // 눌림 판정: 벽과 다른 공에 밀려 다시 판 밑으로 파고든 깊이
      if (P.phase === "down" || P.phase === "hold") {
        var blocked = 0;
        for (i = n - 1; i >= 0; i--) {
          var br = r[i];
          if (y[i] < py1 - br * 0.3 || x[i] < x0 - br * 0.5 || x[i] > x1 + br * 0.5) continue;
          var qx = x[i] < x0 ? x0 : x[i] > x1 ? x1 : x[i];
          var ddx = x[i] - qx, ddy = y[i] - py1;
          var over = br - Math.sqrt(ddx * ddx + (ddy > 0 ? ddy * ddy : 0));
          if (over <= 0) continue;
          if (over > C.CRUSH * br && born[i] < P.stroke && n < C.CAP) crush(i);
          else if (over > C.BLOCK * br) blocked++;
        }
        if (P.phase === "down" && blocked >= C.BLOCKN) { P.phase = "hold"; P.t = 0; }
      }
    }

    sim.start = function () {
      if (sim.state !== "ready") return;
      sim.state = "run";
      P.phase = "rest"; P.t = 0;
    };

    sim.leader = function () {
      var best = 0;
      for (var c = 1; c < counts.length; c++) if (counts[c] > counts[best]) best = c;
      return best;
    };

    sim.boom = function () {
      sim.state = "boom";
      var cx = PX, cy = (T + B) / 2;
      for (var i = 0; i < n; i++) {
        var dx = x[i] - cx, dy = y[i] - cy, d = Math.hypot(dx, dy) || 1;
        var sp = (700 + rnd() * 900) / 60 / C.SUB;
        ox[i] = x[i] - (dx / d * sp + (rnd() - 0.5) * sp * 0.6);
        oy[i] = y[i] - (dy / d * sp - sp * 0.5 + (rnd() - 0.5) * sp * 0.6);
      }
    };

    // dt 초만큼 진행. 끝나야 하면 true
    sim.step = function (dt) {
      if (sim.state === "ready" || sim.state === "done") return false;
      dt = Math.min(dt, 1 / 30);
      var h = dt / C.SUB;
      for (var s = 0; s < C.SUB; s++) substep(h);
      sim.time += dt;
      if (sim.state === "run" && (sim.fill >= C.FILL || n >= C.CAP || sim.time >= C.TMAX)) {
        sim.boom();
        return true;
      }
      return false;
    };

    return sim;
  }

  var api = { makeSim: makeSim, CFG: CFG, BOXAREA: BOXAREA };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PressEngine = api;
})(this);
