/* =====================================================================
 * water.js — 程式繪製的水與橋
 * =====================================================================
 *
 * 【為什麼不用現成素材】
 * 找不到同時符合「32px 俯視、跟 Cainos 畫風一致、授權允許放進公開 repo」
 * 的水與橋。Cainos 自己的付費包也是用 shader 畫水，不是圖塊。所以這裡
 * 直接用程式畫：顏色取自 Cainos 圖集，水會動，也沒有授權問題。
 *
 * 【水是地面，橋是貼地物件】
 *   水  地面筆刷的一種（ground 的 sheet 為 'water'），不能走。
 *   橋  物件種類 bridge，flat: true —— 畫在貓底下，蓋住的水格可以走。
 * 通行判定在 rebuildMap 裡處理。
 *
 * 【畫法】
 * 靜態的部分（岸邊、深淺、石頭）依每個像素離岸多遠算一次，存在離屏畫布；
 * 會動的部分（水紋、岸邊白沫、反光、漣漪）每一格畫幾百個像素而已。
 * rebuildMap 會把水面的形狀記成 map.waterKey，形狀變了才重算；
 * 搬樹、塗草地都不會觸發。
 * ===================================================================== */

const WATER_COLORS = {
  lip: '#72751b',       // 岸上的草。實際上不畫，讓 ground.js 的草地透出來
  bank: '#45431f',      // 濕泥岸
  shallow: '#5f8f7f',
  mid: '#4d7d78',
  deep: '#416c6f',
  ripple: '#9cc4b4',
  foam: '#cfe3cf',
  glint: '#f6f8ea',
  rock: '#878579',      // 跟石地板同色
  rockDark: '#61594b',
};

/* 木頭色取自 TX Props 的木箱 */
const WOOD = {
  outline: '#4f2913',
  gap: '#3a1f0e',
  dark: '#593219',
  planks: ['#6a5030', '#705536', '#7a5d3c'],
  light: '#8c7350',
};

const WATER = {
  key: null,
  base: null,       // 靜態層
  mask: null,       // Uint8Array：1 = 夠深、水紋可以出現的像素
  cells: [],        // 所有水格 [c, r]
  box: null,        // 水面範圍（像素）{ x, y, w, h }
  foam: [],         // 兩張交替的白沫畫布
  horizontal: true, // 水流方向
  dashes: [],
  glints: [],
  rings: [],
  ringTimer: 4,
  t: 0,
};

function isWater(map, c, r) {
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return null;  // 地圖外：不算岸
  return map.ground[r][c].sheet === 'water';
}

/* 給每個像素一個固定的雜湊值，抖色和石頭位置都靠它，同一張地圖永遠長一樣 */
function pixelHash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ---------------------------------------------------------------------
 * 程式產生的圖集：水的地面圖塊、兩座橋（座標表 BRIDGES 在 tileset.js）
 *
 * 註冊成跟 PNG 一樣的 tiles，編輯器縮圖、drawFlats 都能直接用。
 * ------------------------------------------------------------------- */
function makeProceduralSheets() {
  return { water: makeWaterTile(), bridge: makeBridgeSheet() };
}

function makeWaterTile() {
  const c = document.createElement('canvas');
  c.width = TILE_SIZE; c.height = TILE_SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = WATER_COLORS.mid;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = WATER_COLORS.ripple;
  for (const [x, y, w] of [[4, 6, 4], [18, 12, 3], [9, 21, 4], [22, 26, 3]]) ctx.fillRect(x, y, w, 1);
  return c;
}

function makeBridgeSheet() {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 128;
  const ctx = c.getContext('2d');
  const px = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

  // --- 南北向：64 x 128，木板橫鋪，左右欄杆 ---
  for (let y = 0, i = 0; y < 128; y += 6, i++) {
    px(WOOD.planks[pixelHash(i, 1) % 3], 10, y, 44, 5);
    px(WOOD.light, 10, y, 44, 1);
    px(WOOD.gap, 10, y + 5, 44, 1);
    px(WOOD.outline, 12, y + 2, 1, 1);          // 釘子
    px(WOOD.outline, 51, y + 2, 1, 1);
  }
  for (const x of [6, 54]) {
    px(WOOD.outline, x, 0, 4, 128);
    px(WOOD.planks[0], x + 1, 0, 2, 128);
    px(WOOD.light, x + 1, 0, 1, 128);
    for (const y of [2, 42, 82, 120]) {         // 欄杆柱
      px(WOOD.outline, x - 1, y, 6, 6);
      px(WOOD.planks[2], x, y + 1, 4, 4);
      px(WOOD.light, x, y + 1, 4, 1);
    }
  }

  // --- 東西向：128 x 64，木板直鋪，上下欄杆；下欄杆看得到正面 ---
  const ox = 64;
  for (let x = 0, i = 0; x < 128; x += 6, i++) {
    px(WOOD.planks[pixelHash(i, 2) % 3], ox + x, 10, 5, 38);
    px(WOOD.light, ox + x, 10, 1, 38);
    px(WOOD.gap, ox + x + 5, 10, 1, 38);
    px(WOOD.outline, ox + x + 2, 12, 1, 1);
    px(WOOD.outline, ox + x + 2, 45, 1, 1);
  }
  px(WOOD.outline, ox, 6, 128, 4);
  px(WOOD.planks[0], ox, 7, 128, 2);
  px(WOOD.light, ox, 7, 128, 1);
  px(WOOD.outline, ox, 48, 128, 4);
  px(WOOD.planks[0], ox, 49, 128, 2);
  px(WOOD.light, ox, 49, 128, 1);
  px(WOOD.dark, ox, 52, 128, 3);                 // 下欄杆的正面
  px(WOOD.outline, ox, 55, 128, 1);
  for (const x of [2, 42, 82, 120]) {
    for (const y of [5, 47]) {
      px(WOOD.outline, ox + x, y, 6, 6);
      px(WOOD.planks[2], ox + x + 1, y + 1, 4, 4);
      px(WOOD.light, ox + x + 1, y + 1, 4, 1);
    }
    px(WOOD.dark, ox + x, 53, 6, 4);             // 柱子正面
  }
  return c;
}

/* ---------------------------------------------------------------------
 * 靜態層：依像素離岸距離分出草緣、泥岸、淺水、深水
 * ------------------------------------------------------------------- */
const WATER_BANDS = [
  // [距離上限, 顏色, 與下一層交界時抖色]
  [2, WATER_COLORS.lip, false],
  [4, WATER_COLORS.bank, true],
  [10, WATER_COLORS.shallow, true],
  [16, WATER_COLORS.mid, true],
  [Infinity, WATER_COLORS.deep, false],
];

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 平滑的雜訊，0 到 1。岸線靠它才不會是一條尺畫的直線。 */
function valueNoise(x, y, s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s);
  const fx = x / s - gx, fy = y / s - gy;
  const h = (i, j) => (pixelHash(gx + i, gy + j) & 1023) / 1023;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h(0, 0) + (h(1, 0) - h(0, 0)) * ux;
  const b = h(0, 1) + (h(1, 1) - h(0, 1)) * ux;
  return a + (b - a) * uy;
}

/* 像素 (x, y) 離岸多遠（只看周圍 8 格，再遠就當作很深）。
 * 雜訊只會把岸往水裡推、不會往外推，所以草地永遠接得上格子邊緣。 */
function shoreDistance(map, c, r, x, y) {
  const d = rawShoreDistance(map, c, r, x, y);
  if (d >= 30) return d;   // 四周都是水：雜訊最多推 6.5 像素，影響不到深水
  return d - valueNoise(x, y, 10) * 5 - valueNoise(x + 97, y, 4) * 1.5;
}

/* 岸邊的格子當成圓角方塊，凸進水裡的岸角就是圓的；
 * 兩塊岸之間再用「平滑取最小值」接起來，水的直角轉彎也會變成圓弧。 */
const SHORE_CORNER = 12, SHORE_FILLET = 14;

function rawShoreDistance(map, c, r, x, y) {
  const T = TILE_SIZE, R = SHORE_CORNER, k = SHORE_FILLET;
  let best = 99;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      if (isWater(map, c + dc, r + dr) !== false) continue;
      const qx = Math.abs(x - (c + dc + 0.5) * T) - (T / 2 - R);
      const qy = Math.abs(y - (r + dr + 0.5) * T) - (T / 2 - R);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
      const h = Math.max(k - Math.abs(best - d), 0) / k;
      best = Math.min(best, d) - h * h * k / 4;
    }
  }
  return Math.max(0, best);
}

function buildWater(map, W, H) {
  const T = TILE_SIZE;
  WATER.cells = [];
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!isWater(map, c, r)) continue;
      WATER.cells.push([c, r]);
      x0 = Math.min(x0, c * T); y0 = Math.min(y0, r * T);
      x1 = Math.max(x1, (c + 1) * T); y1 = Math.max(y1, (r + 1) * T);
    }
  }
  WATER.base = null;
  WATER.dashes = [];
  WATER.glints = [];
  WATER.rings = [];
  if (!WATER.cells.length) return;

  const bw = x1 - x0, bh = y1 - y0;
  WATER.box = { x: x0, y: y0, w: bw, h: bh };
  WATER.horizontal = bw >= bh;

  const base = document.createElement('canvas');
  base.width = bw; base.height = bh;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(bw, bh);
  const mask = new Uint8Array(W * H);
  const foamPx = [];
  const bands = WATER_BANDS.map(([lim, col, dither]) => [lim, hexRgb(col), dither]);

  for (const [c, r] of WATER.cells) {
    for (let y = r * T; y < (r + 1) * T; y++) {
      for (let x = c * T; x < (c + 1) * T; x++) {
        const d = shoreDistance(map, c, r, x + 0.5, y + 0.5);
        let b = 0;
        while (d >= bands[b][0]) b++;
        // 交界處一格棋盤抖色，像素畫的漸層
        if (b > 0 && bands[b - 1][2] && d < bands[b - 1][0] + 1 && ((x + y) & 1)) b--;
        const i = ((y - y0) * bw + (x - x0)) * 4;
        // 最外層是岸上的草：留空，讓底下 ground.js 畫的草地透出來，岸線才接得上
        if (b > 0) {
          const [cr, cg, cb] = bands[b][1];
          img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = 255;
        }
        if (d >= 6) mask[y * W + x] = 1;
        if (d >= 4 && d < 5.5) foamPx.push([x - x0, y - y0]);
      }
    }
  }
  bctx.putImageData(img, 0, 0);

  // 岸邊零星的石頭，旁邊一撮白沫
  for (const [c, r] of WATER.cells) {
    const h = pixelHash(c, r);
    if (h % 9) continue;
    const x = c * T + 6 + (h >>> 4) % 18, y = r * T + 6 + (h >>> 9) % 18;
    const sd = shoreDistance(map, c, r, x, y);
    if (sd < 5 || sd > 11) continue;
    bctx.fillStyle = WATER_COLORS.rockDark; bctx.fillRect(x - x0, y - y0 + 1, 4, 2);
    bctx.fillStyle = WATER_COLORS.rock;     bctx.fillRect(x - x0, y - y0, 4, 2);
    bctx.fillRect(x - x0 + 1, y - y0 - 1, 2, 1);
    bctx.fillStyle = WATER_COLORS.foam;     bctx.fillRect(x - x0 - 1, y - y0 + 2, 1, 1);
  }
  WATER.base = base;
  WATER.mask = mask;

  // 白沫：兩張畫布各取一半的像素，交替淡入淡出就會閃
  WATER.foam = [0, 1].map((k) => {
    const f = document.createElement('canvas');
    f.width = bw; f.height = bh;
    const fctx = f.getContext('2d');
    fctx.fillStyle = WATER_COLORS.foam;
    for (const [x, y] of foamPx) if (pixelHash(x + x0, y + y0) % 3 === k) fctx.fillRect(x, y, 1, 1);
    return f;
  });

  const n = WATER.cells.length;
  for (let i = 0; i < Math.ceil(n * 0.6); i++) WATER.dashes.push(newDash(W, true));
  for (let i = 0; i < Math.ceil(n / 3); i++) {
    const p = randomDeepPixel(W);
    if (p) WATER.glints.push({ x: p[0], y: p[1], p: Math.random() * 6.28, s: 0.6 + Math.random() });
  }
}

function randomDeepPixel(W) {
  const T = TILE_SIZE;
  for (let a = 0; a < 8; a++) {
    const [c, r] = WATER.cells[Math.floor(Math.random() * WATER.cells.length)];
    const x = c * T + Math.floor(Math.random() * T), y = r * T + Math.floor(Math.random() * T);
    if (WATER.mask[y * W + x]) return [x, y];
  }
  return null;
}

function newDash(W, anyAge) {
  const p = randomDeepPixel(W) || [-99, -99];
  const life = 2 + Math.random() * 2.5;
  return { x: p[0], y: p[1], len: 2 + Math.floor(Math.random() * 3), life, age: anyAge ? Math.random() * life : 0, v: 5 + Math.random() * 5 };
}

/* ---------------------------------------------------------------------
 * 每一格
 * ------------------------------------------------------------------- */
function updateWater(dt, W) {
  WATER.t += dt;
  const hz = WATER.horizontal;

  for (let i = 0; i < WATER.dashes.length; i++) {
    const d = WATER.dashes[i];
    d.age += dt;
    if (hz) d.x += d.v * dt; else d.y += d.v * dt;
    const hx = Math.round(d.x) + (hz ? d.len : 0), hy = Math.round(d.y) + (hz ? 0 : d.len);
    const inside = hx >= 0 && hy >= 0 && hx < W && WATER.mask[hy * W + hx];
    if (d.age >= d.life || !inside) WATER.dashes[i] = newDash(W, false);
  }

  if (CONFIG.AMBIENCE && CONFIG.SCENE_LIFE) {
    WATER.ringTimer -= dt;
    if (WATER.ringTimer <= 0) {
      WATER.ringTimer = 5 + Math.random() * 9;
      const p = randomDeepPixel(W);
      if (p) WATER.rings.push({ x: p[0], y: p[1], age: 0 });
    }
  }
  WATER.rings = WATER.rings.filter((r) => (r.age += dt) < 1.4);
}

function drawWater(ctx, map, dt) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (WATER.key !== map.waterKey) {
    WATER.key = map.waterKey;
    buildWater(map, W, H);
  }
  if (!WATER.base) return;
  updateWater(dt, W);

  const t = WATER.t, b = WATER.box;
  ctx.save();
  ctx.drawImage(WATER.base, b.x, b.y);

  const f = 0.5 + 0.5 * Math.sin(t * 2.2);
  ctx.globalAlpha = 0.25 + 0.6 * f;
  ctx.drawImage(WATER.foam[0], b.x, b.y);
  ctx.globalAlpha = 0.85 - 0.6 * f;
  ctx.drawImage(WATER.foam[1], b.x, b.y);

  ctx.fillStyle = WATER_COLORS.ripple;
  for (const d of WATER.dashes) {
    const a = Math.sin(Math.PI * d.age / d.life);
    if (a < 0.15) continue;
    ctx.globalAlpha = a * 0.8;
    const x = Math.round(d.x), y = Math.round(d.y);
    if (WATER.horizontal) ctx.fillRect(x, y, d.len, 1); else ctx.fillRect(x, y, 1, d.len);
  }

  ctx.fillStyle = WATER_COLORS.glint;
  for (const g of WATER.glints) {
    const s = Math.sin(t * g.s * 2 + g.p);
    if (s < 0.9) continue;
    ctx.globalAlpha = (s - 0.9) * 10;
    ctx.fillRect(g.x, g.y, 1, 1);
    if (s > 0.97) { ctx.fillRect(g.x - 1, g.y, 3, 1); ctx.fillRect(g.x, g.y - 1, 1, 3); }
  }

  // 漣漪：一圈像素慢慢擴散變淡，像魚兒剛冒出水面
  ctx.fillStyle = WATER_COLORS.foam;
  for (const r of WATER.rings) {
    const rad = 1 + r.age * 5;
    ctx.globalAlpha = Math.max(0, 1 - r.age / 1.4) * 0.9;
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2;
      const x = Math.round(r.x + Math.cos(ang) * rad), y = Math.round(r.y + Math.sin(ang) * rad * 0.6);
      if (WATER.mask[y * W + x]) ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}
