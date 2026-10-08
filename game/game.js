// Flame Out - rendering, input, sound and screens.
(function () {
  'use strict';

  const E = window.FlameEngine;
  const LEVELS = window.FlameLevels.LEVELS;
  const WORLDS = [
    { name: 'Water & Lava', what: 'Cool the lava. Don’t waste water.' },
    { name: 'Rocks', what: 'Rocks fill holes and push water around.' },
    { name: 'Locked Pins', what: 'Clear the jam before you pull.' },
    { name: 'Two Fires', what: 'Share the water between the fires.' },
    { name: 'Ice', what: 'Melt ice with lava to free the water.' },
  ];
  const C = E.CELL;
  const LW = E.W * C, LH = E.H * C;
  const STEPS_PER_SEC = 120;

  const COL = {
    outline: '#1b1240',
    wall: '#b9a6ff', wallHi: '#e6ddff', wallLo: '#8f78f0',
    water: '#2c9cff', waterDeep: '#1f6fe0', waterHi: '#c4ecff',
    lavaHi: '#ffe05a', lavaEdge: '#a3170f',
    rock: ['#8d7c6c', '#9c8a78', '#7b6b5d'], rockEdge: '#3a2c25',
    stone: ['#5b5870', '#66637c', '#4f4c62'], stoneEdge: '#24213a',
    pin: '#ffce3a', pinHi: '#fff1a8', pinLo: '#d99a12',
    drain: '#140c2e',
  };

  // ---- persistent progress (per browser, optional) ----
  const SAVE_KEY = 'flame-out-v2';
  const save = loadSave();
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && Array.isArray(s.stars)) return { unlocked: s.unlocked || 1, stars: s.stars, muted: !!s.muted, musicOff: !!s.musicOff };
    } catch (e) { /* storage unavailable */ }
    return { unlocked: 1, stars: [], muted: false, musicOff: false };
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const stage = $('stage');
  const staticLayer = document.createElement('canvas');
  const sctx = staticLayer.getContext('2d');

  let scale = 1, dpr = 1;
  let world = null;
  let levelIndex = 0;
  let tries = 0;
  let pins = []; // visual pin state
  let fx = []; // effect particles
  let drag = null;
  let endTimer = 0;
  let ended = false;
  let fireScale = [1];
  let time = 0;
  let acc = 0;
  let last = 0;
  let tutorial = false;
  let running = false;

  function resize() {
    // Room inside the stage padding, minus the canvas border (4px each side) and its drop shadow.
    const cs = getComputedStyle(stage);
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8;
    const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 16;
    scale = Math.max(0.2, Math.min(aw / LW, ah / LH));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.floor(LW * scale), ch = Math.floor(LH * scale);
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    staticLayer.width = cv.width;
    staticLayer.height = cv.height;
    if (world) { drawStatic(); render(); }
  }

  // ---- level lifecycle ----
  function startLevel(i, isRetry) {
    levelIndex = i;
    tries = isRetry ? tries + 1 : 1;
    const lv = LEVELS[i];
    world = E.createWorld(lv);
    pins = world.pins.map((p) => ({ id: p.id, offset: 0, pulled: false, alpha: 1, wiggle: 0, locked: false }));
    fx = [];
    drag = null;
    ended = false;
    endTimer = 0;
    fireScale = world.fires.map(() => 1);
    tutorial = typeof lv.tutorialPin === 'number' ? lv.tutorialPin : -1;
    $('lvl-num').textContent = 'Level ' + (i + 1);
    $('lvl-name').textContent = lv.name;
    if (lv.hint) showHint(lv.hint);
    else $('hint').classList.remove('show');
    music.setWorld(worldOf(i));
    hideModal();
    drawStatic();
    updateMeter();
  }

  let hintTimer = 0;
  function showHint(text) {
    const h = $('hint');
    h.textContent = text;
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => h.classList.remove('show'), 4200);
  }

  function updateMeter() {
    let left = 1;
    if (world) {
      let need = 0;
      for (const f of world.fires) need += f.need;
      left = need ? E.waterStillNeeded(world) / need : 0;
    }
    $('meter-fill').style.transform = 'scaleX(' + left.toFixed(3) + ')';
  }

  // ---- static layer: background + walls ----
  function drawStatic() {
    const g = sctx;
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    g.clearRect(0, 0, LW, LH);

    const bg = g.createLinearGradient(0, 0, 0, LH);
    bg.addColorStop(0, '#3a1f7a');
    bg.addColorStop(0.55, '#5a2a8c');
    bg.addColorStop(1, '#8a3b8f');
    g.fillStyle = bg;
    g.fillRect(0, 0, LW, LH);

    // soft bubbles in the background
    const rnd = mulberry(levelIndex + 11);
    for (let k = 0; k < 26; k++) {
      const x = rnd() * LW, y = rnd() * LH, r = 6 + rnd() * 26;
      g.fillStyle = 'rgba(255,255,255,' + (0.025 + rnd() * 0.04).toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    const lv = LEVELS[levelIndex];

    // drains: dark holes with a grate
    for (const d of lv.drains || []) {
      const x = d.x * C, y = d.y * C, w = d.w * C, h = d.h * C;
      const dg = g.createLinearGradient(0, y, 0, y + h);
      dg.addColorStop(0, 'rgba(20,12,46,0)');
      dg.addColorStop(1, 'rgba(10,6,24,0.95)');
      g.fillStyle = dg;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(185,166,255,0.35)';
      g.lineWidth = 2;
      for (let gx = x + 5; gx < x + w; gx += 8) {
        g.beginPath(); g.moveTo(gx, y + h - 14); g.lineTo(gx, y + h); g.stroke();
      }
    }

    // fire pit glow
    if (lv.fire) {
      const f = lv.fire;
      const cx = (f.x + f.w / 2) * C, cy = (f.y + f.h) * C;
      const rg = g.createRadialGradient(cx, cy, 4, cx, cy, f.w * C);
      rg.addColorStop(0, 'rgba(255,140,40,0.45)');
      rg.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = rg;
      g.fillRect(cx - f.w * C, cy - f.w * C, f.w * C * 2, f.w * C * 2);
    }

    // walls: outline pass, fill pass, highlight pass
    const rects = lv.walls || [];
    const lines = lv.lines || [];
    const pass = (pad, color, lineExtra) => {
      g.fillStyle = color;
      g.strokeStyle = color;
      g.lineCap = 'round';
      for (const r of rects) roundRect(g, r[0] * C - pad, r[1] * C - pad, r[2] * C + pad * 2, r[3] * C + pad * 2, 3 + pad);
      for (const l of lines) {
        g.lineWidth = (l[4] || 1.5) * 2 * C + lineExtra;
        g.beginPath(); g.moveTo(l[0] * C, l[1] * C); g.lineTo(l[2] * C, l[3] * C); g.stroke();
      }
    };
    pass(3, COL.outline, 6);
    pass(0, COL.wall, 0);
    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = COL.wallLo;
    for (const r of rects) roundRect(g, r[0] * C + 1, r[1] * C + r[3] * C - 4, r[2] * C - 2, 3, 1.5);
    g.fillStyle = COL.wallHi;
    for (const r of rects) roundRect(g, r[0] * C + 2, r[1] * C + 2, Math.max(2, r[2] * C - 4), Math.min(3, r[3] * C - 3), 1.5);
    g.strokeStyle = COL.wallHi;
    g.lineWidth = 2.5;
    for (const l of lines) {
      const ang = Math.atan2(l[3] - l[1], l[2] - l[0]);
      const ox = Math.sin(ang) * 2.5, oy = -Math.cos(ang) * 2.5;
      g.beginPath(); g.moveTo(l[0] * C + ox, l[1] * C + oy); g.lineTo(l[2] * C + ox, l[3] * C + oy); g.stroke();
    }
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- frame ----
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!running || !world) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    time += dt;

    acc += dt * STEPS_PER_SEC;
    let n = 0;
    while (acc >= 1 && n < 6) {
      E.step(world);
      acc -= 1; n++;
    }
    if (n === 6) acc = 0;

    handleEvents();
    updatePins(dt);
    updateFx(dt);
    updateMeter();
    checkEnd(dt);
    render();
  }

  function checkEnd(dt) {
    world.fires.forEach((f, k) => {
      const out = f.progress >= f.need;
      const target = out || world.state === 'won' ? 0 : world.state === 'lost' && world.reason === 'lava' ? 1.7 : Math.max(0.28, 1 - f.progress / f.need);
      fireScale[k] += (target - fireScale[k]) * Math.min(1, dt * 5);
      if (out && !f.cheered) { f.cheered = true; if (world.fires.length > 1 && world.state === 'play') sfx.fireOut(); }
    });
    if (ended || world.state === 'play') return;
    endTimer += dt;
    const wait = world.state === 'won' ? 1.3 : 1.1;
    if (endTimer >= wait) {
      ended = true;
      if (world.state === 'won') onWin();
      else onLose();
    }
  }

  function handleEvents() {
    const ev = world.events;
    if (!ev.length) return;
    let sizzles = 0, douses = 0;
    for (const e of ev) {
      const x = (e.x + 0.5) * C, y = (e.y + 0.5) * C;
      if (e.e === 'steam') {
        sizzles++;
        if (fx.length < 400) fx.push({ k: 'steam', x, y, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 30, life: 0, max: 0.9 + Math.random() * 0.6, r: 3 + Math.random() * 4 });
      } else if (e.e === 'douse') {
        douses++;
        if (fx.length < 400 && Math.random() < 0.3) fx.push({ k: 'steam', x, y: y - 6, vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 40, life: 0, max: 1 + Math.random() * 0.6, r: 4 + Math.random() * 5 });
      } else if (e.e === 'flare') {
        for (let k = 0; k < 3; k++) fx.push({ k: 'spark', x, y, vx: (Math.random() - 0.5) * 140, vy: -80 - Math.random() * 120, life: 0, max: 0.6 + Math.random() * 0.4, r: 2 + Math.random() * 2 });
      } else if (e.e === 'ash') {
        fx.push({ k: 'ash', x, y, vx: (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 20, life: 0, max: 0.7, r: 3 });
      }
    }
    if (sizzles) sfx.sizzle(sizzles);
    if (douses) sfx.douse(douses);
    if (ev.some((e) => e.e === 'flare')) sfx.flare();
    world.events.length = 0;
  }

  function updatePins(dt) {
    for (const p of pins) if (!p.pulled) p.locked = E.isBlocked(world, p.id);
    for (const p of pins) {
      if (p.pulled) {
        p.offset += dt * 900;
        p.alpha = Math.max(0, p.alpha - dt * 2.2);
      } else if (!drag || drag.id !== p.id) {
        p.offset *= Math.pow(0.0001, dt);
        if (p.wiggle > 0) p.wiggle = Math.max(0, p.wiggle - dt);
      }
    }
  }

  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.life += dt;
      if (p.life >= p.max) { fx.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.k === 'spark' || p.k === 'confetti') p.vy += 260 * dt;
      if (p.k === 'confetti') { p.vx *= 0.99; p.rot += p.vr * dt; }
    }
  }

  // ---- rendering ----
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    drawFire();
    drawParticles();
    drawPins();
    drawFx();
    if (tutorial >= 0 && pins[tutorial] && !pins[tutorial].pulled) drawTutorialHand(tutorial);
  }

  function drawParticles() {
    const T = world.type, S = world.shade;
    const W = E.W, H = E.H;
    const phase = (time * 6) | 0;

    // Liquids: dark rim circles, then the body, then surface shine.
    ctx.fillStyle = 'rgba(16,40,120,0.55)';
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (T[y * W + x] === E.WATER) { const cx = x * C + 2, cy = y * C + 2; ctx.moveTo(cx + 3.4, cy); ctx.arc(cx, cy, 3.4, 0, 6.2832); }
    }
    ctx.fill();
    ctx.fillStyle = COL.lavaEdge;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (T[y * W + x] === E.LAVA) { const cx = x * C + 2, cy = y * C + 2; ctx.moveTo(cx + 3.4, cy); ctx.arc(cx, cy, 3.4, 0, 6.2832); }
    }
    ctx.fill();

    // water body with a light gradient by depth
    const wg = ctx.createLinearGradient(0, 0, 0, LH);
    wg.addColorStop(0, '#3fb0ff');
    wg.addColorStop(1, COL.waterDeep);
    ctx.fillStyle = wg;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y * W + x] === E.WATER) ctx.rect(x * C - 0.6, y * C - 0.6, C + 1.2, C + 1.2);
    ctx.fill();

    // lava body: one warm gradient, with slow glowing blobs drifting through it
    const lg = ctx.createLinearGradient(0, 0, 0, LH);
    lg.addColorStop(0, '#ff8c1a');
    lg.addColorStop(1, '#ff3d1f');
    ctx.fillStyle = lg;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y * W + x] === E.LAVA) ctx.rect(x * C - 0.6, y * C - 0.6, C + 1.2, C + 1.2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,214,80,0.55)';
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (T[y * W + x] !== E.LAVA) continue;
      const v = Math.sin(x * 0.45 + time * 1.7) + Math.sin(y * 0.38 - time * 1.3) + Math.sin((x + y) * 0.21 + time);
      if (v > 1.6) ctx.rect(x * C - 0.6, y * C - 0.6, C + 1.2, C + 1.2);
    }
    ctx.fill();

    // surface shine
    ctx.fillStyle = COL.waterHi;
    ctx.beginPath();
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === E.WATER && T[i - W] !== E.WATER) ctx.rect(x * C - 0.5, y * C - 0.5, C + 1, 1.8);
    }
    ctx.fill();
    ctx.fillStyle = COL.lavaHi;
    ctx.beginPath();
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === E.LAVA && (T[i - W] !== E.LAVA || (S[i] & 31) === (phase & 31))) ctx.rect(x * C - 0.5, y * C - 0.5, C + 1, 1.8);
    }
    ctx.fill();
    // a few bubbles inside the water
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === E.WATER && (S[i] & 63) === 7) { ctx.moveTo(x * C + 3, y * C + 2); ctx.arc(x * C + 2, y * C + 2, 1, 0, 6.2832); }
    }
    ctx.fill();

    // rocks and stone: chunky grains with a dark edge
    drawGrains(E.ROCK, COL.rock, COL.rockEdge);
    drawGrains(E.STONE, COL.stone, COL.stoneEdge);
    drawIce();
  }

  function drawIce() {
    const T = world.type, S = world.shade, W = E.W, H = E.H;
    if (!world.iceCount) return;
    ctx.fillStyle = '#3d74b8';
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y * W + x] === E.ICE) ctx.rect(x * C - 1, y * C - 1, C + 2, C + 2);
    ctx.fill();
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y * W + x] === E.ICE) ctx.rect(x * C, y * C, C, C);
    ctx.fill();
    // glints and frosty top edge
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] !== E.ICE) continue;
      if (T[i - W] !== E.ICE) ctx.rect(x * C, y * C, C, 1.6);
      else if ((S[i] & 15) === 3) ctx.rect(x * C + 1, y * C + 1, 2, 2);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(120,190,255,0.55)';
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === E.ICE && ((x + y) % 7 === 0)) ctx.rect(x * C, y * C + 2, C, 1.2);
    }
    ctx.fill();
  }

  function drawGrains(type, cols, edge) {
    const T = world.type, S = world.shade, W = E.W, H = E.H;
    let any = false;
    ctx.fillStyle = edge;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (T[y * W + x] === type) { any = true; ctx.rect(x * C - 1, y * C - 1, C + 2, C + 2); }
    }
    if (!any) return;
    ctx.fill();
    for (let b = 0; b < 3; b++) {
      ctx.fillStyle = cols[b];
      ctx.beginPath();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (T[i] === type && S[i] % 3 === b) ctx.rect(x * C, y * C, C, C);
      }
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === type && T[i - W] !== type) ctx.rect(x * C, y * C, C, 1.4);
    }
    ctx.fill();
  }

  function pinGeom(p, vis) {
    const x = p.x * C, y = p.y * C, w = p.w * C, h = p.h * C;
    const o = vis.offset + (vis.wiggle > 0 ? Math.sin(vis.wiggle * 40) * 2 : 0);
    const dx = p.dir === 'left' ? -o : p.dir === 'right' ? o : 0;
    const dy = p.dir === 'up' ? -o : p.dir === 'down' ? o : 0;
    let hx, hy;
    if (p.dir === 'left') { hx = x - 8; hy = y + h / 2; }
    else if (p.dir === 'right') { hx = x + w + 8; hy = y + h / 2; }
    else if (p.dir === 'up') { hx = x + w / 2; hy = y - 8; }
    else { hx = x + w / 2; hy = y + h + 8; }
    return { x: x + dx, y: y + dy, w, h, hx: hx + dx, hy: hy + dy };
  }

  function drawPins() {
    for (const vis of pins) {
      if (vis.alpha <= 0) continue;
      const p = world.pins[vis.id];
      const g = pinGeom(p, vis);
      ctx.save();
      ctx.globalAlpha = vis.alpha;
      const horiz = p.dir === 'left' || p.dir === 'right';
      const locked = vis.locked;
      // body
      ctx.fillStyle = COL.outline;
      roundRect(ctx, g.x - 2, g.y - 2, g.w + 4, g.h + 4, 4);
      const grad = horiz ? ctx.createLinearGradient(0, g.y, 0, g.y + g.h) : ctx.createLinearGradient(g.x, 0, g.x + g.w, 0);
      grad.addColorStop(0, locked ? '#e4dcef' : COL.pinHi);
      grad.addColorStop(0.5, locked ? '#b4a9c6' : COL.pin);
      grad.addColorStop(1, locked ? '#857a99' : COL.pinLo);
      ctx.fillStyle = grad;
      roundRect(ctx, g.x, g.y, g.w, g.h, 3);
      // handle ring
      ctx.lineWidth = 9;
      ctx.strokeStyle = COL.outline;
      ctx.beginPath(); ctx.arc(g.hx, g.hy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 5;
      ctx.strokeStyle = locked ? '#b4a9c6' : COL.pin;
      ctx.beginPath(); ctx.arc(g.hx, g.hy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = locked ? '#e4dcef' : COL.pinHi;
      ctx.beginPath(); ctx.arc(g.hx, g.hy, 8, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
      if (locked && !vis.pulled) drawPadlock(g.hx, g.hy - (horiz ? 15 : 0) + (horiz ? 0 : -2), vis.wiggle);
      ctx.restore();
    }
  }

  function drawPadlock(x, y, wiggle) {
    const sh = wiggle > 0 ? Math.sin(wiggle * 50) * 2.5 : 0;
    ctx.save();
    ctx.translate(x + sh, y);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = COL.outline;
    ctx.beginPath(); ctx.arc(0, -3, 4.5, Math.PI, 0); ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#d9d2e6';
    ctx.beginPath(); ctx.arc(0, -3, 4.5, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = COL.outline;
    roundRect(ctx, -7.5, -4, 15, 12, 3);
    ctx.fillStyle = '#ffb02e';
    roundRect(ctx, -5.5, -2, 11, 8, 2);
    ctx.fillStyle = COL.outline;
    ctx.beginPath(); ctx.arc(0, 1.5, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawFire() {
    world.fires.forEach((f, k) => drawOneFire(f, fireScale[k]));
  }

  function drawOneFire(f, s) {
    const x = f.x * C, y = f.y * C, w = f.w * C, h = f.h * C;
    const cx = x + w / 2, by = y + h - 8;

    // logs
    ctx.save();
    ctx.translate(cx, y + h - 6);
    for (const a of [-0.32, 0.32]) {
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = COL.outline;
      roundRect(ctx, -w * 0.36 - 2, -7, w * 0.72 + 4, 14, 7);
      ctx.fillStyle = '#9a5a2e';
      roundRect(ctx, -w * 0.36, -5, w * 0.72, 10, 5);
      ctx.fillStyle = '#c98149';
      roundRect(ctx, -w * 0.36 + 3, -4, w * 0.72 - 6, 3, 1.5);
      ctx.fillStyle = '#f0c48a';
      ctx.beginPath(); ctx.arc(w * 0.36 - 4, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (s < 0.02) {
      // a happy little smoke puff once it is out
      ctx.fillStyle = 'rgba(230,230,250,0.5)';
      const t = time * 2;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath(); ctx.arc(cx + Math.sin(t + k) * 6, by - 18 - k * 14 - (t * 10) % 14, 6 + k * 2, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    const fw = w * 0.62 * s, fh = (h + 44) * s;
    const glow = ctx.createRadialGradient(cx, by - fh * 0.4, 2, cx, by - fh * 0.4, fh);
    glow.addColorStop(0, 'rgba(255,170,60,0.35)');
    glow.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - fh, by - fh * 1.4, fh * 2, fh * 2);

    const layer = (k, color, outline) => {
      const ww = fw * k, hh = fh * k;
      const sway = Math.sin(time * 7 + k * 3) * ww * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.bezierCurveTo(cx - ww * 0.75, by, cx - ww * 0.62, by - hh * 0.5, cx + sway, by - hh);
      ctx.bezierCurveTo(cx + ww * 0.62, by - hh * 0.5, cx + ww * 0.75, by, cx, by);
      ctx.closePath();
      if (outline) { ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke(); }
      ctx.fillStyle = color;
      ctx.fill();
    };
    layer(1, '#ff4a2a', true);
    layer(0.74, '#ff9a1f', false);
    layer(0.46, '#ffe45c', false);

    // face
    const angry = world.state === 'lost' && world.reason === 'lava';
    const worried = f.progress > 0 && !angry;
    const ey = by - fh * 0.3, ex = fw * 0.16, er = Math.max(1.5, fw * 0.09);
    ctx.fillStyle = '#fff';
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sgn * ex, ey, er, er * 1.25, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = COL.outline;
    const look = Math.sin(time * 1.3) * er * 0.3;
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sgn * ex + look, ey + er * 0.2, er * 0.55, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = Math.max(1.2, fw * 0.035);
    ctx.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      const tilt = angry ? 1 : worried ? -1 : 0.4;
      ctx.moveTo(cx + sgn * (ex - er), ey - er * 1.7 - tilt * er * 0.5);
      ctx.lineTo(cx + sgn * (ex + er), ey - er * 1.7 + tilt * er * 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    const my = ey + er * 2.3;
    if (worried) ctx.ellipse(cx, my + 1, er * 0.7, er * 0.55, 0, 0, Math.PI * 2);
    else ctx.arc(cx, my - er * 0.6, er * 1.1, 0.2 * Math.PI, 0.8 * Math.PI);
    if (worried) { ctx.fillStyle = COL.outline; ctx.fill(); } else ctx.stroke();
  }

  function drawFx() {
    for (const p of fx) {
      const t = p.life / p.max;
      if (p.k === 'steam') {
        ctx.fillStyle = 'rgba(240,244,255,' + (0.7 * (1 - t)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + t * 1.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'spark') {
        ctx.fillStyle = t < 0.5 ? '#ffe45c' : '#ff6a1a';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'ash') {
        ctx.fillStyle = 'rgba(60,50,70,' + (0.7 * (1 - t)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + t), 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = 1 - Math.max(0, t - 0.7) / 0.3;
        ctx.fillStyle = p.c;
        ctx.fillRect(-4, -2.5, 8, 5);
        ctx.restore();
      }
    }
  }

  function drawTutorialHand(id) {
    const p = world.pins[id];
    const g = pinGeom(p, pins[id]);
    const t = (time % 1.8) / 1.8;
    const ease = t < 0.15 ? 0 : t > 0.75 ? 1 : (t - 0.15) / 0.6;
    const ux = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0;
    const uy = p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0;
    const ox = uy ? 14 : 0, oy = ux ? 14 : 0;
    const x = g.hx + ox + ux * ease * 60, y = g.hy + oy + uy * ease * 60;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - ease);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(g.hx + ox + ux * 14, g.hy + oy + uy * 14); ctx.lineTo(g.hx + ox + ux * 72, g.hy + oy + uy * 72); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : Math.min(1, t / 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---- input ----
  function toLogical(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function pinAt(pt) {
    let best = null, bestD = 1e9;
    for (const vis of pins) {
      if (vis.pulled) continue;
      const p = world.pins[vis.id];
      const g = pinGeom(p, vis);
      const pad = 12;
      const inBody = pt.x >= g.x - pad && pt.x <= g.x + g.w + pad && pt.y >= g.y - pad && pt.y <= g.y + g.h + pad;
      const dh = Math.hypot(pt.x - g.hx, pt.y - g.hy);
      const d = inBody ? Math.min(dh, 6) : dh;
      if ((inBody || dh < 22) && d < bestD) { best = vis; bestD = d; }
    }
    return best;
  }

  cv.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    if (!world || world.state !== 'play') return;
    const pt = toLogical(e);
    const vis = pinAt(pt);
    if (!vis) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drag = { id: vis.id, x0: pt.x, y0: pt.y, moved: 0, pointer: e.pointerId };
  });

  cv.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const pt = toLogical(e);
    const p = world.pins[drag.id];
    const dx = pt.x - drag.x0, dy = pt.y - drag.y0;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const along = p.dir === 'left' ? -dx : p.dir === 'right' ? dx : p.dir === 'up' ? -dy : dy;
    const vis = pins[drag.id];
    if (vis.locked) { vis.offset = Math.min(3, Math.max(0, along)); return; }
    vis.offset = Math.max(0, along);
    if (vis.offset > 26) pull(drag.id);
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const vis = pins[drag.id];
    if (vis.locked) lockedNudge(vis);
    else if (!vis.pulled && drag.moved < 8) pull(drag.id); // a tap pulls too
    drag = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointer) drag = null; });

  let lockHintShown = false;
  function lockedNudge(vis) {
    vis.wiggle = 0.35;
    sfx.clunk();
    if (!lockHintShown) { lockHintShown = true; showHint('Locked! Clear what is jamming the handle first.'); }
  }

  function pull(id) {
    const vis = pins[id];
    if (vis.pulled) return;
    if (!E.pullPin(world, id)) return;
    vis.pulled = true;
    drag = null;
    if (id === tutorial) tutorial = -1;
    sfx.pull();
    try { navigator.vibrate && navigator.vibrate(18); } catch (e) { /* ignore */ }
  }

  // ---- screens ----
  function show(id) {
    for (const s of ['scr-title', 'scr-levels']) $(s).hidden = s !== id;
    running = id === null;
  }

  function buildLevelGrid() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    WORLDS.forEach((wd, wi) => {
      const head = document.createElement('div');
      head.className = 'world-head w' + (wi + 1);
      head.innerHTML = '<span class="world-n">World ' + (wi + 1) + '</span><span class="world-name">' + wd.name + '</span><span class="world-what">' + wd.what + '</span>';
      grid.appendChild(head);
      const row = document.createElement('div');
      row.className = 'world-levels';
      for (let i = wi * 10; i < Math.min(LEVELS.length, wi * 10 + 10); i++) {
        const lv = LEVELS[i];
        const b = document.createElement('button');
        b.className = 'lvl-btn w' + (wi + 1);
        const locked = i + 1 > save.unlocked;
        b.disabled = locked;
        b.setAttribute('aria-label', locked ? 'Level ' + (i + 1) + ', locked' : 'Level ' + (i + 1) + ', ' + lv.name);
        const stars = save.stars[i] || 0;
        b.innerHTML = locked
          ? '<span class="lvl-n">' + (i + 1) + '</span>' + lockSvg()
          : '<span class="lvl-n">' + (i + 1) + '</span><span class="lvl-stars">' + [0, 1, 2].map((k) => starSvg(k < stars)).join('') + '</span>';
        b.addEventListener('click', () => { sfx.unlock(); music.start(); sfx.tap(); show(null); startLevel(i); });
        row.appendChild(b);
      }
      grid.appendChild(row);
    });
    const cur = grid.querySelectorAll('.lvl-btn:not([disabled])');
    const last = cur[cur.length - 1];
    if (last) setTimeout(() => last.scrollIntoView({ block: 'center' }), 0);
  }

  function worldOf(i) { return Math.min(WORLDS.length - 1, Math.floor(i / 10)); }

  function starSvg(on) {
    return '<svg viewBox="0 0 24 24" class="star' + (on ? ' on' : '') + '" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
  }
  function lockSvg() {
    return '<svg viewBox="0 0 24 24" class="lock" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke-width="2.6"/></svg>';
  }

  function onWin() {
    const stars = tries <= 1 ? 3 : tries === 2 ? 2 : 1;
    save.stars[levelIndex] = Math.max(save.stars[levelIndex] || 0, stars);
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
    writeSave();
    const last = levelIndex === LEVELS.length - 1;
    const praise = ['Splashing!', 'Fire’s out!', 'Too cool!', 'Nailed it!', 'Hot stuff!'];
    openModal({
      win: true,
      title: last ? 'You beat them all!' : praise[(Math.random() * praise.length) | 0],
      sub: last ? 'Every fire is out. More levels are on the way.' : stars === 3 ? 'First try. Perfect!' : 'Try it first time for 3 stars.',
      stars,
      primary: last ? 'Pick a level' : 'Next level',
      onPrimary: () => {
        if (last) { buildLevelGrid(); hideModal(); show('scr-levels'); return; }
        const next = levelIndex + 1;
        // An ad break after every third level completed.
        if (next % 3 === 0) { hideModal(); running = false; Ads.showBreak(() => { running = true; startLevel(next); }); }
        else startLevel(next);
      },
      secondary: 'Replay',
      onSecondary: () => startLevel(levelIndex),
    });
    sfx.win();
    for (let k = 0; k < 90; k++) {
      const cols = ['#ffce3a', '#2c9cff', '#ff4b1f', '#7ef0a1', '#ff7bd5', '#ffffff'];
      fx.push({ k: 'confetti', x: LW / 2 + (Math.random() - 0.5) * 60, y: LH * 0.35, vx: (Math.random() - 0.5) * 420, vy: -160 - Math.random() * 260, life: 0, max: 1.8 + Math.random(), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, c: cols[k % cols.length] });
    }
  }

  function onLose() {
    const why = {
      lava: ['Too hot!', 'The lava reached the fire. Cool it with water first.'],
      water: ['Out of water', world.fires.length > 1 ? 'Not enough water is left for every fire.' : 'Not enough water is left to reach the fire.'],
      stuck: ['Stuck!', world.fires.length > 1 ? 'Every fire needs water. One is still burning.' : 'The water could not reach the fire.'],
    }[world.reason] || ['Oops', 'Give it another go.'];
    openModal({
      win: false,
      title: why[0],
      sub: why[1],
      primary: 'Try again',
      onPrimary: () => startLevel(levelIndex, true),
      secondary: 'Levels',
      onSecondary: () => { buildLevelGrid(); hideModal(); show('scr-levels'); },
    });
    sfx.lose();
  }

  let modalPrimary = null, modalSecondary = null;
  function openModal(o) {
    const m = $('modal');
    m.classList.toggle('lose', !o.win);
    $('modal-title').textContent = o.title;
    $('modal-sub').textContent = o.sub;
    const st = $('modal-stars');
    st.hidden = !o.win;
    if (o.win) st.innerHTML = [0, 1, 2].map((k) => starSvg(k < o.stars)).join('');
    $('modal-primary').textContent = o.primary;
    $('modal-secondary').textContent = o.secondary;
    modalPrimary = o.onPrimary;
    modalSecondary = o.onSecondary;
    m.hidden = false;
    setTimeout(() => $('modal-primary').focus({ preventScroll: true }), 50);
  }
  function hideModal() { $('modal').hidden = true; }

  $('modal-primary').addEventListener('click', () => { sfx.tap(); modalPrimary && modalPrimary(); });
  $('modal-secondary').addEventListener('click', () => { sfx.tap(); modalSecondary && modalSecondary(); });
  $('btn-restart').addEventListener('click', () => {
    sfx.unlock(); sfx.tap();
    if (!world) return;
    const retry = world.pins.some((p) => p.pulled) || world.state !== 'play';
    startLevel(levelIndex, retry);
  });
  $('btn-menu').addEventListener('click', () => { sfx.unlock(); sfx.tap(); hideModal(); buildLevelGrid(); show('scr-levels'); });
  $('btn-play').addEventListener('click', () => {
    sfx.unlock(); music.start(); sfx.tap();
    show(null);
    const next = Math.min(save.unlocked, LEVELS.length) - 1;
    startLevel(next);
  });
  $('btn-levels').addEventListener('click', () => { sfx.unlock(); music.start(); sfx.tap(); buildLevelGrid(); show('scr-levels'); });
  $('btn-back').addEventListener('click', () => { sfx.tap(); show('scr-title'); });
  $('btn-sound').addEventListener('click', () => {
    save.muted = !save.muted;
    writeSave();
    syncSoundBtn();
    sfx.unlock();
    sfx.tap();
  });
  $('btn-music').addEventListener('click', () => {
    save.musicOff = !save.musicOff;
    writeSave();
    syncSoundBtn();
    sfx.unlock();
    if (save.musicOff) music.stop(); else music.start();
  });
  function syncSoundBtn() {
    $('btn-sound').classList.toggle('muted', save.muted);
    $('btn-sound').setAttribute('aria-label', save.muted ? 'Turn sound effects on' : 'Turn sound effects off');
    $('btn-music').classList.toggle('muted', !!save.musicOff);
    $('btn-music').setAttribute('aria-label', save.musicOff ? 'Turn music on' : 'Turn music off');
  }

  // ---- sound (synthesised, no files) ----
  const sfx = (function () {
    let ac = null, noise = null, lastSizzle = 0, lastDouse = 0;
    function unlock() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        noise = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
    }
    const ok = () => ac && !save.muted;
    function tone(freq, dur, type, vol, when, slide) {
      if (!ok()) return;
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function hiss(dur, freq, vol, q) {
      if (!ok()) return;
      const t = ac.currentTime;
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise;
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(ac.destination);
      s.start(t); s.stop(t + dur);
    }
    return {
      unlock,
      ctx: () => ac,
      noise: () => noise,
      clunk() { tone(140, 0.12, 'square', 0.1, 0, 90); tone(90, 0.1, 'triangle', 0.12, 0.02); },
      fireOut() { [784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.13, i * 0.09)); },
      tap() { tone(660, 0.07, 'triangle', 0.12); },
      pull() { hiss(0.18, 2400, 0.25, 0.8); tone(420, 0.16, 'square', 0.07, 0, 980); },
      sizzle(n) {
        if (!ac) return;
        const now = ac.currentTime;
        if (now - lastSizzle < 0.12) return;
        lastSizzle = now;
        hiss(0.25, 5200, Math.min(0.18, 0.04 + n * 0.01), 0.7);
      },
      douse(n) {
        if (!ac) return;
        const now = ac.currentTime;
        if (now - lastDouse < 0.18) return;
        lastDouse = now;
        hiss(0.3, 3400, Math.min(0.14, 0.05 + n * 0.02), 0.6);
      },
      flare() { tone(110, 0.5, 'sawtooth', 0.12, 0, 55); hiss(0.4, 700, 0.25, 0.6); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.11)); tone(1319, 0.5, 'sine', 0.1, 0.48); },
      lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.26, 'triangle', 0.14, i * 0.16)); },
    };
  })();

  // ---- music (generated live, no audio files) ----
  const music = (function () {
    const BPM = 116;
    const STEP = 60 / BPM / 2; // eighth notes
    const CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]]; // C G Am F
    const ROOTS = [0, 7, 9, 5];
    const R = null;
    const MEL_A = [4, 7, 4, 0, 2, 4, 7, R, 2, -1, 2, 7, 5, 2, -1, R, 0, 4, 9, 7, 4, 0, 4, R, 5, 9, 7, 5, 4, 2, 0, R];
    const MEL_B = [12, R, 11, 9, 7, R, 4, 7, 11, R, 9, 7, 2, R, 7, R, 9, R, 7, 4, 0, R, 4, 9, 9, 7, 5, 4, 5, 7, R, R];
    const KEYS = [0, 2, -3, 5, -1]; // each world sits in its own key
    let timer = null, next = 0, i = 0, out = null, key = 0, playing = false, ducked = false;

    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function note(ac, t, m, dur, type, vol) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(hz(m), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function drum(ac, t, kind) {
      if (kind === 'kick') {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 0.18);
        return;
      }
      const nb = sfx.noise();
      if (!nb) return;
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = nb;
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const v = kind === 'hat' ? 0.05 : 0.18, d = kind === 'hat' ? 0.04 : 0.12;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.3); s.stop(t + d + 0.01);
    }
    function play(ac, n, t) {
      const bar = Math.floor(n / 8) % 4, s8 = n % 8, base = 60 + KEYS[key];
      if (s8 === 0 || s8 === 3 || s8 === 4 || s8 === 6) note(ac, t, base - 24 + ROOTS[bar] + (s8 === 4 ? 12 : 0), STEP * 1.5, 'triangle', 0.2);
      if (s8 === 2 || s8 === 6) for (const c of CHORDS[bar]) note(ac, t, base + c, STEP * 0.8, 'square', 0.022);
      const mel = n < 32 ? MEL_A : MEL_B;
      const m = mel[n % 32];
      if (m !== null) note(ac, t, base + 12 + m, STEP * 1.3, 'triangle', 0.085);
      if (s8 === 0 || s8 === 5) drum(ac, t, 'kick');
      if (s8 === 4) drum(ac, t, 'snare');
      drum(ac, t, 'hat');
    }
    function tick() {
      const ac = sfx.ctx();
      if (!ac || !out) return;
      if (next < ac.currentTime - 0.2) next = ac.currentTime + 0.05; // tab was asleep
      while (next < ac.currentTime + 0.18) {
        play(ac, i, next);
        next += STEP;
        i = (i + 1) % 64;
      }
    }
    function level() { return ducked ? 0.0001 : 0.55; }
    return {
      start() {
        if (save.musicOff || playing) return;
        const ac = sfx.ctx();
        if (!ac) return;
        playing = true;
        out = ac.createGain();
        out.gain.value = 0.0001;
        out.gain.setTargetAtTime(level(), ac.currentTime, 0.3);
        out.connect(ac.destination);
        next = ac.currentTime + 0.08;
        timer = setInterval(tick, 40);
      },
      stop() {
        if (!playing) return;
        playing = false;
        clearInterval(timer);
        const ac = sfx.ctx(), g = out;
        out = null;
        if (ac && g) { g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08); setTimeout(() => g.disconnect(), 500); }
      },
      setWorld(k) { key = k; },
      duck(on) {
        ducked = on;
        const ac = sfx.ctx();
        if (ac && out) out.gain.setTargetAtTime(level(), ac.currentTime, 0.15);
      },
    };
  })();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) music.stop(); else if (running || !$('scr-title').hidden) music.start();
  });

  // ---- ad breaks ----
  // To show real ads, define window.FlameAdProvider = { showBreak(done) { ...; done(); } }
  // before this script runs (see game/README.md). Until then a placeholder break is shown.
  const Ads = {
    showBreak(done) {
      music.duck(true);
      const finish = () => { music.duck(false); done(); };
      const provider = window.FlameAdProvider;
      if (provider && typeof provider.showBreak === 'function') {
        try { provider.showBreak(finish); return; } catch (e) { /* fall back to the placeholder */ }
      }
      const box = $('adbreak'), btn = $('ad-continue'), count = $('ad-count');
      let left = 5;
      btn.disabled = true;
      count.textContent = left;
      btn.textContent = 'Continue in ' + left;
      box.hidden = false;
      const iv = setInterval(() => {
        left--;
        count.textContent = Math.max(0, left);
        if (left > 0) { btn.textContent = 'Continue in ' + left; return; }
        clearInterval(iv);
        btn.disabled = false;
        btn.textContent = 'Continue';
        btn.focus({ preventScroll: true });
      }, 1000);
      btn.onclick = () => { if (btn.disabled) return; sfx.tap(); box.hidden = true; finish(); };
    },
  };

  // ---- boot ----
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  syncSoundBtn();

  // Test hook: open the page with #debug to get window.flameDebug in the console.
  if (location.hash === '#debug') {
    window.flameDebug = {
      win() { if (world) { world.fires.forEach((f) => { f.progress = f.need; }); world.state = 'won'; } },
      level: (i) => { show(null); startLevel(i); },
      unlockAll() { save.unlocked = LEVELS.length; writeSave(); },
      adBreak: () => Ads.showBreak(() => { window.flameDebug.adDone = true; }),
      musicOn: () => { sfx.unlock(); music.start(); },
    };
  }

  function boot(data) {
    resize();
    const lvl = data && typeof data.level === 'number' ? data.level : null;
    if (lvl !== null && lvl < LEVELS.length) { show(null); startLevel(lvl); }
    else {
      // Draw level 1 behind the title screen so the first frame is not empty.
      startLevel(Math.min(save.unlocked, LEVELS.length) - 1);
      render();
      show('scr-title');
    }
    requestAnimationFrame(frame);
  }
  try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => ({ level: running ? levelIndex : null })); } catch (e) { /* ignore */ }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data ? hot.data : {});
})();
