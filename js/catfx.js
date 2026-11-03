/* =====================================================================
 * catfx.js — 等級特效與最高分光環
 * =====================================================================
 *
 * 每升一級就多一樣東西（清單與解鎖等級在 config.js 的 LEVEL_FX），
 * 而且一直循環播放，不是升級那一下就沒了。貓與其他動物共用同一套。
 *
 * 分三個時機畫，好讓前後遮擋自然：
 *   drawCatGarden   家門口的小芽、花與向日葵，固定在錨點那一格，在貓之前畫
 *   drawCatFxBack   貓身後：最高分光環、繞到後面的光點
 *   drawCatFxFront  貓身前：愛心音符、星星、蝴蝶、繞到前面的光點、今日之星
 *
 * 角色正下方只留給影子，什麼都不畫。
 *
 * 座標都以 32x32 一格為單位，(x, y) 是格子左上角。像素層是低解析度
 * 再放大的，所以小圖示一律用 fillRect 逐點畫，才會跟素材一樣銳利。
 *
 * 粒子不存狀態：位置全由時間與學生 id 雜湊算出來，同一隻貓每次開啟
 * 都是同一種節奏，30 隻貓也不必維護任何粒子陣列。
 * ===================================================================== */

const CAT_FX = { t: 0 };

/* 這一級有沒有解鎖某項特效。 */
function hasLevelFx(lv, key) {
  for (const fx of LEVEL_FX) if (fx.key === key) return lv >= fx.level;
  return false;
}

/* 剛好在這一級解鎖的特效（面板升級提示用）。沒有就回 null。 */
function levelFxAt(lv) {
  return LEVEL_FX.find((fx) => fx.level === lv) || null;
}

/* 下一個還沒解鎖的特效。全部解鎖了就回 null。 */
function nextLevelFx(lv) {
  let best = null;
  for (const fx of LEVEL_FX) {
    if (fx.level > lv && (!best || fx.level < best.level)) best = fx;
  }
  return best;
}

/* 每隻貓自己的節奏，讓全班的愛心、星星不會同時冒出來。 */
function fxSeed(cat) {
  if (cat.fxSeed === undefined) cat.fxSeed = hash32('fx:' + cat.student.id);
  return cat.fxSeed;
}

function fxHash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return (h ^ (h >>> 13)) >>> 0;
}

/* 小圖示。'#' 是主色，'o' 是亮點，'.' 是透明。 */
const FX_SPRITES = {
  heart: ['#.#.', '####', '.##.', '..#.'].map((r) => r.split('')),
  note: ['..##', '..#.', '..#.', '###.', '##..'].map((r) => r.split('')),
  wingsOpen: ['##.##', '#o#o#', '.#.#.'].map((r) => r.split('')),
  wingsShut: ['.#.#.', '.o#o.', '..#..'].map((r) => r.split('')),
  star: ['...#...', '..#o#..', '##ooo##', '.#ooo#.', '.##.##.', '.#...#.'].map((r) => r.split('')),
};

function drawSprite(ctx, rows, x, y, color, light) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'o' && light ? light : color;
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

/* 十字星：size 1 是一顆亮點加四個角，size 2 拉長成閃光。 */
function drawStar(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
  for (let k = 1; k <= size; k++) {
    ctx.globalAlpha *= 0.85;
    ctx.fillRect(x - k, y, 1, 1);
    ctx.fillRect(x + k, y, 1, 1);
    ctx.fillRect(x, y - k, 1, 1);
    ctx.fillRect(x, y + k, 1, 1);
  }
}

/* ---------------------------------------------------------------------
 * 家門口的小花園（sprout → flowers → sunflower）
 * ------------------------------------------------------------------- */
const FX_FLOWER_COLORS = ['#ffd1e8', '#fff1a8', '#c9e4ff', '#ffffff', '#e6c9ff'];

function drawCatGarden(ctx, cat, x, y) {
  const lv = levelFromXp(cat.student.xp);
  if (!hasLevelFx(lv, 'sprout')) return;
  const bloom = hasLevelFx(lv, 'flowers');
  const seed = fxSeed(cat);
  const t = CAT_FX.t;

  // 貓站在格子中間（x 約 8..24），花長在兩側才不會被身體擋住
  const spots = bloom ? [[3, 27], [27, 25], [6, 30], [25, 30]] : [[4, 28], [27, 27]];
  ctx.save();
  for (let i = 0; i < spots.length; i++) {
    const [sx, sy] = spots[i];
    const h = fxHash(seed, i);
    // 微風：每株錯開一點，最多偏一格
    const sway = Math.round(Math.sin(t * 1.6 + i * 1.9 + (h & 7)) * 0.7);
    const px = x + sx;
    const py = y + sy;
    // 莖與葉
    ctx.fillStyle = '#3f8a3a';
    ctx.fillRect(px, py - 1, 1, 2);
    ctx.fillStyle = '#7fd36a';
    ctx.fillRect(px - 1, py, 1, 1);
    ctx.fillRect(px + 1, py - 1, 1, 1);
    if (!bloom) {
      ctx.fillRect(px + sway, py - 2, 1, 1);
      continue;
    }
    ctx.fillStyle = '#3f8a3a';
    ctx.fillRect(px + sway, py - 3, 1, 2);
    // 花瓣與花心
    const fx = px + sway;
    const fy = py - 5;
    ctx.fillStyle = FX_FLOWER_COLORS[h % FX_FLOWER_COLORS.length];
    ctx.fillRect(fx - 1, fy, 1, 1);
    ctx.fillRect(fx + 1, fy, 1, 1);
    ctx.fillRect(fx, fy - 1, 1, 1);
    ctx.fillRect(fx, fy + 1, 1, 1);
    ctx.fillStyle = '#ffcf4a';
    ctx.fillRect(fx, fy, 1, 1);
  }
  if (hasLevelFx(lv, 'sunflower')) drawSunflower(ctx, x + (seed & 1 ? 1 : 30), y + 31, t, seed);
  ctx.restore();
}

/* 一株比貓矮一點的向日葵，花盤跟著風慢慢點頭。(x, y) 是根部。 */
function drawSunflower(ctx, x, y, t, seed) {
  const sway = Math.round(Math.sin(t * 1.1 + (seed & 15)) * 0.8);
  ctx.fillStyle = '#3f8a3a';
  ctx.fillRect(x, y - 9, 1, 9);
  ctx.fillStyle = '#7fd36a';
  ctx.fillRect(x - 2, y - 4, 2, 1);
  ctx.fillRect(x + 1, y - 6, 2, 1);
  const cx = x + sway;
  const cy = y - 12;
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(cx - 1, cy - 2, 3, 1);
  ctx.fillRect(cx - 1, cy + 2, 3, 1);
  ctx.fillRect(cx - 2, cy - 1, 1, 3);
  ctx.fillRect(cx + 2, cy - 1, 1, 3);
  ctx.fillStyle = '#ffe98a';
  ctx.fillRect(cx - 2, cy - 2, 1, 1);
  ctx.fillRect(cx + 2, cy + 2, 1, 1);
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
  ctx.fillStyle = '#b27a3f';
  ctx.fillRect(cx, cy, 1, 1);
}

/* ---------------------------------------------------------------------
 * 貓身後
 * ------------------------------------------------------------------- */
function drawCatFxBack(ctx, cat, x, y) {
  const lv = levelFromXp(cat.student.xp);
  const t = CAT_FX.t;
  ctx.save();

  if (cat.isTop) drawTopHalo(ctx, x, y, t);
  if (hasLevelFx(lv, 'orbit')) drawOrbit(ctx, cat, x, y, t, false);

  ctx.restore();
}

/* 全班最高分：身後一圈慢慢轉的金色光芒，加上柔和的光暈。
 * 光暈的圓心放在身體上半，往下的光芒逐漸淡掉，腳下只留影子。 */
function drawTopHalo(ctx, x, y, t) {
  const cx = x + 16;
  const cy = y + 15;
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.8);
  const r = 9 + breathe * 2;          // 最低到 y + 26，碰不到腳

  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255, 226, 120, 0.55)');
  g.addColorStop(0.6, 'rgba(255, 214, 102, 0.22)');
  g.addColorStop(1, 'rgba(255, 214, 102, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgb(255, 236, 150)';
  const rays = 10;
  for (let i = 0; i < rays; i++) {
    const a = t * 0.35 + (i / rays) * Math.PI * 2;
    // 朝下的光芒淡掉：正上方最亮，水平以下慢慢消失
    const fade = Math.max(0, Math.min(1, (0.35 - Math.sin(a)) / 0.7));
    if (fade <= 0) continue;
    ctx.globalAlpha = 0.35 * fade;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.11) * 6, cy + Math.sin(a - 0.11) * 6);
    ctx.lineTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
    ctx.lineTo(cx + Math.cos(a + 0.11) * 6, cy + Math.sin(a + 0.11) * 6);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* 三顆金色光點繞著貓轉。front 決定畫的是前半圈還是後半圈。 */
function drawOrbit(ctx, cat, x, y, t, front) {
  const base = t * 1.4 + (fxSeed(cat) & 63) / 10;
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * Math.PI * 2;
    const s = Math.sin(a);
    if ((s > 0) !== front) continue;
    const px = Math.round(x + 16 + Math.cos(a) * 13);
    const py = Math.round(y + 20 + s * 4.5);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(px - 1, py - 1, 3, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = front ? '#fff6d0' : '#ffd666';
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------------
 * 貓身前
 * ------------------------------------------------------------------- */
function drawCatFxFront(ctx, cat, x, y) {
  const lv = levelFromXp(cat.student.xp);
  const t = CAT_FX.t;
  const seed = fxSeed(cat);
  ctx.save();

  if (hasLevelFx(lv, 'hearts')) drawFloaters(ctx, x, y, t, seed, hasLevelFx(lv, 'notes'));
  if (hasLevelFx(lv, 'stars')) drawStars(ctx, x, y, t, seed, hasLevelFx(lv, 'goldStars'));
  if (hasLevelFx(lv, 'butterfly')) drawButterfly(ctx, x, y, t, seed);
  if (hasLevelFx(lv, 'butterflies')) drawButterfly(ctx, x, y, t * 1.15 + 2.6, seed + 1);
  if (hasLevelFx(lv, 'orbit')) drawOrbit(ctx, cat, x, y, t, true);
  if (cat.isStar) drawTodayStar(ctx, x, y, t);

  ctx.restore();
}

/* 今日之星：頭頂上一顆上下輕飄、偶爾閃一下的大星星。
 * 先用深色描一圈邊，在草地和小路上都看得清楚。 */
function drawTodayStar(ctx, x, y, t) {
  const rows = FX_SPRITES.star;
  const sx = x + 16 - 3;
  const sy = Math.round(y + 1 + Math.sin(t * 2.4) * 1.2);
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    drawSprite(ctx, rows, sx + ox, sy + oy, '#7a4a12');
  }
  drawSprite(ctx, rows, sx, sy, '#ffd23f', '#fff6c4');
  const glint = (t * 0.6) % 1;
  if (glint < 0.25) {
    ctx.globalAlpha = Math.sin(glint / 0.25 * Math.PI);
    drawStar(ctx, sx + 6, sy, 1, '#ffffff');
    ctx.globalAlpha = 1;
  }
}

/* 從頭頂冒出來、慢慢往上飄淡的愛心（升級後也有音符）。 */
function drawFloaters(ctx, x, y, t, seed, withNotes) {
  const period = withNotes ? 1.7 : 3.2;   // 多久冒一個
  const life = 1.8;
  // 同時可能有前一個還沒飄完，所以看兩個週期
  const phase = t + (seed % 1000) / 100;
  const k0 = Math.floor(phase / period);
  for (let k = k0 - 1; k <= k0; k++) {
    const age = phase - k * period;
    if (age < 0 || age > life) continue;
    const h = fxHash(seed, k);
    const p = age / life;
    const side = (h & 1) ? 1 : -1;
    const px = Math.round(x + 16 + side * (3 + (h >>> 3) % 4) + Math.sin(age * 4 + (h & 7)) * 1.2);
    const py = Math.round(y + 13 - p * 12);
    ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - Math.max(0, p - 0.55) / 0.45;
    const isNote = withNotes && ((h >>> 9) % 2 === 0);
    if (isNote) drawSprite(ctx, FX_SPRITES.note, px - 2, py - 2, '#a5e3ff');
    else drawSprite(ctx, FX_SPRITES.heart, px - 2, py - 2, '#ff8fb8');
  }
  ctx.globalAlpha = 1;
}

/* 身邊一閃一閃的星星。金色版多兩顆、也更亮。 */
function drawStars(ctx, x, y, t, seed, gold) {
  const count = gold ? 5 : 3;
  const cycle = 1.4;
  for (let i = 0; i < count; i++) {
    const phase = t / cycle + i / count + (seed % 97) / 97;
    const k = Math.floor(phase);
    const p = phase - k;                       // 0..1 一次閃爍
    const h = fxHash(seed + i * 7919, k);
    const a = (h % 360) * Math.PI / 180;
    const rad = 9 + (h >>> 9) % 5;
    const px = Math.round(x + 16 + Math.cos(a) * rad);
    let py = Math.round(y + 20 + Math.sin(a) * rad * 0.7);
    // 落到腳邊的那幾顆翻到上半身，腳下只留影子
    if (py > y + 24 && Math.abs(px - x - 16) < 10) py = 2 * (y + 20) - py;
    const glow = Math.sin(p * Math.PI);
    ctx.globalAlpha = glow;
    const color = gold ? (i % 2 ? '#ffd666' : '#fff6d0') : '#fffbe6';
    drawStar(ctx, px, py, glow > 0.7 ? 2 : 1, color);
  }
  ctx.globalAlpha = 1;
}

const FX_BUTTERFLY_COLORS = [['#ffd166', '#fff3c4'], ['#9be7ff', '#e3f9ff'], ['#ffb3d9', '#ffe3f1'], ['#c4f08b', '#effcd9']];

/* 一隻蝴蝶繞著貓飛「8」字。 */
function drawButterfly(ctx, x, y, t, seed) {
  const w = 0.9;
  const off = (seed % 628) / 100;
  const a = t * w + off;
  const px = Math.round(x + 16 + Math.sin(a) * 12);
  const py = Math.round(y + 12 + Math.sin(a * 2) * 3);
  const [color, light] = FX_BUTTERFLY_COLORS[seed % FX_BUTTERFLY_COLORS.length];
  const open = Math.floor(t * 8 + off) % 2 === 0;
  drawSprite(ctx, open ? FX_SPRITES.wingsOpen : FX_SPRITES.wingsShut, px - 2, py - 1, color, light);
  ctx.fillStyle = '#4a3b34';
  ctx.fillRect(px, py, 1, 2);
}
