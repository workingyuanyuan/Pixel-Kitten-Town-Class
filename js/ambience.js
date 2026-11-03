/* =====================================================================
 * ambience.js — 光影與生氣
 * =====================================================================
 *
 * 【分兩層畫，貓夾在中間】
 *   ambienceGround  畫在地面之後、植物與貓之前：
 *                   斜向投影、冷暖光、光束、雲影、飛鳥與蝴蝶的影子。
 *   ambienceAir     畫在所有東西之後：浮塵、落葉、蝴蝶。
 *
 * 陰影只落在地面上，**永遠不會蓋到貓**。投影機在開燈的教室裡會把暗部
 * 洗成一片灰，站在樹影裡的貓如果跟著變暗，後排就找不到了；而且被分到
 * 角落的學生會覺得自己的貓被「調暗」，這違反姿勢階梯「只有正向差異」
 * 的原則（見 config.js 的 POSE_LADDER）。
 *
 * 【靜態的部分只算一次】
 * 投影與冷暖光只跟地圖有關，算好存在離屏畫布上，每一格只要貼兩次圖。
 * 地圖每次重建（rebuildMap）都會換一份新的 overlays 陣列，拿它當鑰匙，
 * 地圖編輯器一改就會自動重算。
 *
 * 陽光一律從左上方來，所有影子都往右下倒。
 * ===================================================================== */

const AMB = {
  key: null,        // 上次建立光照圖時的 map.overlays
  shade: null,      // multiply：冷色環境光 + 斜向投影
  light: null,      // soft-light：左上暖、右下冷、幾處陽光光斑
  cloud: null,      // 一朵柔邊雲影，重複使用
  bird: null,       // 飛鳥影子（三格拍翅）
  t: 0,
  clouds: [],
  birds: [],
  birdTimer: 8,
  motes: [],
  leaves: [],
  butterflies: [],
};

const SUN_SHADOW = { shear: -0.55, squash: 0.42, color: 'rgb(58, 78, 112)', alpha: 0.34 };

/* 哪些物件會投影。草叢與碎石太矮，投了也只是一團雜訊。 */
const CASTS_SHADOW = { tree: 1, bush: 1, bushL: 1, prop: 1, centre: 1, face: 1 };

function ambienceStrength() {
  const s = Number(CONFIG.LIGHT_STRENGTH);
  return Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0.7;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

/* ---------------------------------------------------------------------
 * 靜態光照圖
 * ------------------------------------------------------------------- */
function buildShade(map, images, W, H) {
  const T = TILE_SIZE;
  const shade = makeCanvas(W, H);
  const sctx = shade.getContext('2d');

  // 先把所有剪影疊進同一張遮罩，再一次貼上，重疊處才不會越疊越黑
  const mask = makeCanvas(W, H);
  const mctx = mask.getContext('2d');
  const sil = makeCanvas(160, 160);
  const silCtx = sil.getContext('2d');

  for (const o of map.overlays) {
    if (!o.px || !o.ref || !CASTS_SHADOW[o.ref.t]) continue;
    const img = images[o.sheet];
    if (!img) continue;
    const [sx, sy, sw, sh] = o.px;

    // 剪影：原圖的形狀、填滿單色
    silCtx.globalCompositeOperation = 'source-over';
    silCtx.clearRect(0, 0, sil.width, sil.height);
    silCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    silCtx.globalCompositeOperation = 'source-in';
    silCtx.fillStyle = '#000';
    silCtx.fillRect(0, 0, sw, sh);

    // 以物件底部中央為錨點，往下壓扁、往右推斜，像斜陽拉出的影子
    const bx = o.col * T + Math.round((o.w * T - sw) / 2) + sw / 2;
    const by = (o.row + o.h) * T;
    mctx.setTransform(1, 0, SUN_SHADOW.shear, -SUN_SHADOW.squash, bx, by);
    mctx.drawImage(sil, 0, 0, sw, sh, -sw / 2, -sh, sw, sh);
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalCompositeOperation = 'source-in';
  mctx.fillStyle = SUN_SHADOW.color;
  mctx.fillRect(0, 0, W, H);

  const k = ambienceStrength();
  // 環境光略偏冷，陰影才會是藍綠而不是髒褐色
  sctx.fillStyle = `rgb(${255 - 26 * k}, ${255 - 20 * k}, ${255 - 10 * k})`;
  sctx.fillRect(0, 0, W, H);
  sctx.globalAlpha = SUN_SHADOW.alpha * k / 0.7;
  sctx.drawImage(mask, 0, 0);
  sctx.globalAlpha = 1;
  return shade;
}

function buildLight(map, W, H) {
  const T = TILE_SIZE;
  const light = makeCanvas(W, H);
  const ctx = light.getContext('2d');

  // soft-light 的中性色是 50% 灰
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createLinearGradient(0, 0, W * 0.75, H);
  g.addColorStop(0, 'rgba(255, 205, 130, 0.55)');
  g.addColorStop(0.5, 'rgba(255, 205, 130, 0)');
  g.addColorStop(1, 'rgba(70, 100, 150, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 陽光光斑：挑空曠、沒被擋住的格子，同一張地圖永遠落在同樣的地方
  const rand = mulberry32((map.cols * 73856093) ^ (map.rows * 19349663));
  const pools = [];
  for (let a = 0; a < 400 && pools.length < 6; a++) {
    const c = 2 + Math.floor(rand() * (map.cols - 4));
    const r = 2 + Math.floor(rand() * (map.rows - 4));
    if (map.blocked[r][c]) continue;
    if (pools.some((p) => Math.hypot(p[0] - c, p[1] - r) < 8)) continue;
    pools.push([c, r]);
  }
  for (const [c, r] of pools) {
    const x = (c + 0.5) * T, y = (r + 0.5) * T, rad = (3 + rand() * 2) * T;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, 'rgba(255, 225, 160, 0.7)');
    rg.addColorStop(0.55, 'rgba(255, 225, 160, 0.25)');
    rg.addColorStop(1, 'rgba(255, 225, 160, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
  return light;
}

function buildCloud() {
  const c = makeCanvas(260, 160);
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = 'rgb(60, 80, 110)';
  for (const [x, y, rx, ry] of [[90, 85, 60, 34], [140, 72, 56, 38], [180, 90, 46, 28], [120, 98, 70, 26]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  return c;
}

/* 三格：翅膀上、平、下。每格 9x5 像素。 */
function buildBird() {
  const frames = [
    ['.#.....#.', '..#...#..', '...###...', '....#....', '.........'],
    ['.........', '#.......#', '.##.#.##.', '...###...', '....#....'],
    ['.........', '.........', '###.#.###', '...###...', '....#....'],
  ];
  const c = makeCanvas(9 * frames.length, 5);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(50, 66, 92)';
  frames.forEach((rows, f) => rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) if (line[x] === '#') ctx.fillRect(f * 9 + x, y, 1, 1);
  }));
  return c;
}

function ensureAmbience(map, images, W, H) {
  const k = ambienceStrength();
  if (AMB.key === map.overlays && AMB.k === k && AMB.shade &&
      AMB.shade.width === W && AMB.shade.height === H) return;
  AMB.key = map.overlays;
  AMB.k = k;
  AMB.shade = buildShade(map, images, W, H);
  AMB.light = buildLight(map, W, H);
  if (!AMB.cloud) AMB.cloud = buildCloud();
  if (!AMB.bird) AMB.bird = buildBird();
  if (!AMB.clouds.length) seedCritters(W, H);
}

/* ---------------------------------------------------------------------
 * 會動的東西
 * ------------------------------------------------------------------- */
const BUTTERFLY_COLORS = ['#fff6d8', '#ffd966', '#bfe3ff', '#ffc2d6'];

function seedCritters(W, H) {
  for (let i = 0; i < 3; i++) {
    AMB.clouds.push({ x: Math.random() * W, y: Math.random() * H - 80, v: 5 + Math.random() * 4 });
  }
  for (let i = 0; i < 45; i++) {
    AMB.motes.push({ x: Math.random() * W, y: Math.random() * H, v: 2 + Math.random() * 4, p: Math.random() * 6.28 });
  }
  for (let i = 0; i < 7; i++) AMB.leaves.push(newLeaf(W, H, true));
  for (let i = 0; i < 5; i++) {
    AMB.butterflies.push({
      x: Math.random() * W, y: Math.random() * H,
      heading: Math.random() * 6.28, p: Math.random() * 6.28,
      color: BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length],
    });
  }
}

function newLeaf(W, H, anywhere) {
  return {
    x: Math.random() * W, y: anywhere ? Math.random() * H : -4,
    v: 7 + Math.random() * 6, p: Math.random() * 6.28,
    color: Math.random() < 0.5 ? '#c9a24a' : '#9fb35a',
  };
}

function updateAmbience(dt, W, H) {
  AMB.t += dt;
  const t = AMB.t;

  for (const c of AMB.clouds) {
    c.x += c.v * dt;
    if (c.x > W + 40) { c.x = -AMB.cloud.width - Math.random() * 200; c.y = Math.random() * H - 80; }
  }

  AMB.birdTimer -= dt;
  if (AMB.birdTimer <= 0) {
    AMB.birdTimer = 18 + Math.random() * 25;
    AMB.birds.push({ x: -20, y: H * (0.15 + Math.random() * 0.6), vx: 70 + Math.random() * 20, vy: 12 - Math.random() * 24, p: 0 });
  }
  AMB.birds = AMB.birds.filter((b) => {
    b.x += b.vx * dt; b.y += b.vy * dt; b.p += dt;
    return b.x < W + 20;
  });

  for (const m of AMB.motes) {
    m.y -= m.v * dt;
    m.x += Math.sin(t * 0.7 + m.p) * 3 * dt;
    if (m.y < -2) { m.y = H + 2; m.x = Math.random() * W; }
  }

  for (let i = 0; i < AMB.leaves.length; i++) {
    const l = AMB.leaves[i];
    l.y += l.v * dt;
    l.x += (6 + Math.sin(t * 1.6 + l.p) * 14) * dt;
    if (l.y > H + 4 || l.x > W + 4) AMB.leaves[i] = newLeaf(W, H, false);
  }

  for (const b of AMB.butterflies) {
    // 慢慢轉向，碰到邊緣就往中間轉
    b.heading += (Math.sin(t * 0.9 + b.p) * 1.4) * dt;
    if (b.x < 20 || b.x > W - 20 || b.y < 20 || b.y > H - 20) {
      const want = Math.atan2(H / 2 - b.y, W / 2 - b.x);
      b.heading += Math.sign(Math.sin(want - b.heading)) * 2 * dt;
    }
    b.x += Math.cos(b.heading) * 16 * dt;
    b.y += Math.sin(b.heading) * 16 * dt + Math.sin(t * 6 + b.p) * 6 * dt;
  }
}

/* ---------------------------------------------------------------------
 * 繪製
 * ------------------------------------------------------------------- */
function ambienceGround(ctx, map, images, dt) {
  if (!CONFIG.AMBIENCE) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ensureAmbience(map, images, W, H);
  updateAmbience(dt, W, H);
  const k = ambienceStrength();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(AMB.shade, 0, 0);

  if (CONFIG.SCENE_LIFE) {
    ctx.globalAlpha = 0.16 * k;
    for (const c of AMB.clouds) ctx.drawImage(AMB.cloud, Math.round(c.x), Math.round(c.y));
    ctx.globalAlpha = 0.65 * k;
    for (const b of AMB.birds) {
      const f = Math.floor(b.p * 8) % 4;
      const frame = f === 3 ? 1 : f;   // 上、平、下、平
      ctx.drawImage(AMB.bird, frame * 9, 0, 9, 5, Math.round(b.x), Math.round(b.y), 9, 5);
    }
    // 蝴蝶本體畫在最上層，牠落在地上的小影子要在這裡畫，才不會蓋到貓
    ctx.globalAlpha = 0.35 * k;
    ctx.fillStyle = 'rgb(40, 50, 70)';
    for (const b of AMB.butterflies) ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 6, 3, 1);
  }

  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = k;
  ctx.drawImage(AMB.light, 0, 0);

  // 光束：從左上斜斜照下來，很淡，慢慢呼吸。也只照在地面上，貓不會忽明忽暗。
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'screen';
  const t = AMB.t;
  for (let i = 0; i < 3; i++) {
    const x0 = W * (0.08 + i * 0.27) + Math.sin(t * 0.15 + i * 2) * 18;
    const a = (0.07 + 0.03 * Math.sin(t * 0.4 + i)) * k;
    const g = ctx.createLinearGradient(x0, 0, x0 + H * 0.35, H);
    g.addColorStop(0, `rgba(255, 236, 190, ${a})`);
    g.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + 70, 0);
    ctx.lineTo(x0 + 70 + H * 0.4, H);
    ctx.lineTo(x0 + H * 0.4 - 20, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* 浮塵、落葉、蝴蝶是空中的小東西，畫在貓上面。它們只是幾個像素，
 * 不會改變任何一隻貓的明暗。 */
function ambienceAir(ctx) {
  if (!CONFIG.AMBIENCE || !CONFIG.SCENE_LIFE) return;
  const t = AMB.t;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const m of AMB.motes) {
    const a = 0.25 + 0.25 * Math.sin(t * 1.7 + m.p);
    if (a <= 0.05) continue;
    ctx.fillStyle = `rgba(255, 240, 200, ${a})`;
    ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
  }

  ctx.globalCompositeOperation = 'source-over';
  for (const l of AMB.leaves) {
    ctx.fillStyle = l.color;
    const flat = Math.sin(t * 4 + l.p) > 0;
    ctx.fillRect(Math.round(l.x), Math.round(l.y), flat ? 2 : 1, flat ? 1 : 2);
  }

  for (const b of AMB.butterflies) {
    const x = Math.round(b.x), y = Math.round(b.y);
    const open = Math.sin(t * 14 + b.p) > 0;
    ctx.fillStyle = b.color;
    if (open) { ctx.fillRect(x - 2, y, 2, 2); ctx.fillRect(x + 1, y, 2, 2); }
    else { ctx.fillRect(x - 1, y, 1, 2); ctx.fillRect(x + 1, y, 1, 2); }
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(x, y, 1, 2);
  }
  ctx.restore();
}
