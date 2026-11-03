/* =====================================================================
 * map.js — 地圖資料、產生、繪製
 * =====================================================================
 *
 * 【資料驅動】地圖的真相是兩樣東西：
 *   ground   每一格的地磚
 *   objects  一份可編輯的物件清單 { t: 種類, i: 第幾個, c: 欄, r: 列 }
 *
 * 畫面用的 overlays 與通行判定 blocked 都是從這兩者「重建」出來的
 * （rebuildMap）。編輯器只要動 ground 與 objects，再重建一次就好。
 *
 * 【預設地圖刻意做得很單純】
 * 程式沒有辦法判斷「階梯該落在哪裡才合理」「擋土牆下面該不該是空地」
 * 這類空間語意，硬要自動擺就會產生一堆看起來沒有邏輯的東西。
 * 所以預設只鋪草地、一條路、一條小溪與橋、零星植栽 —— 真正的場景交給地圖編輯器
 * （按工具列的 ✎）由人來擺。
 * ===================================================================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------
 * 從 ground + objects 重建 overlays 與 blocked
 * ------------------------------------------------------------------- */
function rebuildMap(map) {
  const { cols, rows } = map;
  const blocked = [];
  for (let r = 0; r < rows; r++) blocked.push(new Array(cols).fill(false));

  // 最外圈永遠不可通行，貓才不會走出畫面
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) blocked[r][c] = true;
    }
  }

  const overlays = [];

  for (const o of map.objects) {
    const kind = OBJECT_KINDS[o.t];
    const list = OBJECT_LISTS[o.t];
    if (!kind || !list) continue;
    const item = list[o.i];
    if (!item) continue;

    if (kind.tiled) {
      // 地磚性質（院牆）：用格座標，固定 1x1
      overlays.push({ sheet: kind.sheet, src: item.src, w: 1, h: 1, col: o.c, row: o.r, ref: o });
      if (kind.blocks === 'all' && blocked[o.r] && o.c < cols) blocked[o.r][o.c] = true;
      continue;
    }

    if (kind.shadow) {
      overlays.push({
        sheet: 'shadowPlant', px: [item.sx, item.sy, item.sw, item.sh],
        w: item.w, h: item.h, col: o.c, row: o.r, ref: o,
      });
    }
    overlays.push({
      sheet: kind.sheet, px: [item.sx, item.sy, item.sw, item.sh],
      w: item.w, h: item.h, col: o.c, row: o.r, ref: o, flat: !!kind.flat,
    });

    if (kind.blocks === 'all') {
      for (let r = o.r; r < o.r + item.h; r++) {
        for (let c = o.c; c < o.c + item.w; c++) {
          if (blocked[r] && c >= 0 && c < cols) blocked[r][c] = true;
        }
      }
    } else if (kind.blocks === 'trunk') {
      const tc = o.c + Math.floor(item.w / 2), tr = o.r + item.h - 1;
      if (blocked[tr] && tc >= 0 && tc < cols) blocked[tr][tc] = true;
    }
  }

  /* 水不能走，除非上面架了橋。橋只讓水格變得能走，不會解除樹或道具的阻擋。 */
  const bridged = new Set();
  for (const o of overlays) {
    if (!o.flat) continue;
    for (let r = Math.max(0, o.row); r < Math.min(rows, o.row + o.h); r++) {
      for (let c = Math.max(0, o.col); c < Math.min(cols, o.col + o.w); c++) bridged.add(r * cols + c);
    }
  }
  // 順便記下水面的形狀：水的畫面只跟它有關，搬樹、塗草地都不必重畫
  const wet = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (map.ground[r][c].sheet !== 'water') continue;
      wet.push(r * cols + c);
      if (!bridged.has(r * cols + c)) blocked[r][c] = true;
    }
  }
  map.waterKey = `${cols}x${rows}:${wet.join(',')}`;

  /* 由上而下排序，貓與物件才能正確互相遮擋；同錨點時影子優先。 */
  overlays.sort((a, b) => {
    const aa = a.row + a.h - 1, bb = b.row + b.h - 1;
    if (aa !== bb) return aa - bb;
    if (a.col !== b.col) return a.col - b.col;
    return (a.sheet === 'shadowPlant' ? 0 : 1) - (b.sheet === 'shadowPlant' ? 0 : 1);
  });

  map.blocked = blocked;
  map.overlays = overlays;
  return map;
}

/* 這一格的地磚。ground 存成 { sheet, src } 。 */
function groundAt(map, c, r) { return map.ground[r][c]; }

/* ---------------------------------------------------------------------
 * 產生預設地圖
 *
 * 刻意保守：草地、一條主幹道、一條支線、零星植栽與靠路的道具。
 * 不自動擺院牆、擋土牆或階梯 —— 那些需要空間判斷，交給人。
 * ------------------------------------------------------------------- */
function generateMap(seed, cols, rows) {
  const rand = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const ground = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const v = rand();
      row.push({
        sheet: 'grass',
        src: v < 0.76 ? GRASS.PLAIN : (v < 0.95 ? pick(GRASS.TUFT) : pick(GRASS.FLOWER)),
      });
    }
    ground.push(row);
  }

  const road = [];
  for (let r = 0; r < rows; r++) road.push(new Array(cols).fill(false));

  function pave(c, r) {
    if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) return;
    ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
    road[r][c] = true;
  }

  // 一條橫貫的主幹道，寬 2
  const mainRow = Math.floor(rows * 0.55);
  for (let c = 1; c < cols - 1; c++) { pave(c, mainRow); pave(c, mainRow + 1); }

  // 一條垂直支線
  const branchCol = ri(Math.floor(cols * 0.25), Math.floor(cols * 0.75));
  for (let r = 1; r < rows - 1; r++) pave(branchCol, r);

  // 路緣羽化
  const nRoad = (c, r) => {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc, nr = r + dr;
      if ((dc || dr) && nr >= 0 && nr < rows && nc >= 0 && nc < cols && road[nr][nc]) n++;
    }
    return n;
  };
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (road[r][c]) continue;
      const n = nRoad(c, r);
      if (n >= 3 && rand() < 0.65) ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_MEDIUM) };
      else if (n >= 1 && rand() < 0.3) ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_SPARSE) };
    }
  }

  /* 一條橫越下方的小溪，寬 2，緩緩彎曲，從畫面左緣流到右緣。
   * 支線穿過溪的地方架一座南北向的橋，那幾欄的溪道拉直，橋才放得進去。 */
  const water = [];
  for (let r = 0; r < rows; r++) water.push(new Array(cols).fill(false));
  const riverRow = Math.floor(rows * 0.8);
  const phase = rand() * 6.28;
  // 橋佔 bridgeTop-1 到 bridgeTop+2，所以溪頂最低只能到 rows-4，才不會壓到最外圈
  const riverTop = (c) => Math.max(2, Math.min(rows - 4,
    riverRow + Math.round(Math.sin(c * 0.22 + phase) * 1.2)));
  const bridgeTop = riverTop(branchCol);
  const hasRiver = rows >= 10 && cols >= 8;   // 太小的地圖放不下溪和橋，就不放
  if (hasRiver) {
    const tops = [];
    for (let c = -1; c <= cols; c++) tops.push((c >= branchCol - 1 && c <= branchCol + 2) ? bridgeTop : riverTop(c));
    for (let c = 0; c < cols; c++) {
      // 轉彎處把相鄰兩欄的溪道連起來（寬 3），才會是斜坡而不是一格一格的缺口
      const near = [tops[c], tops[c + 1], tops[c + 2]];
      for (let r = Math.min(...near); r < Math.max(...near) + 2; r++) {
        ground[r][c] = { sheet: 'water', src: [0, 0] };
        water[r][c] = true;
      }
    }
  }

  const objects = [];
  const used = [];
  for (let r = 0; r < rows; r++) used.push(new Array(cols).fill(false));

  function free(c, r, w, h) {
    for (let rr = r; rr < r + h; rr++) {
      for (let cc = c; cc < c + w; cc++) {
        if (cc < 1 || rr < 1 || cc >= cols - 1 || rr >= rows - 1) return false;
        if (used[rr][cc] || road[rr][cc] || water[rr][cc]) return false;
      }
    }
    return true;
  }

  function take(c, r, w, h) {
    for (let rr = Math.max(0, r); rr < Math.min(rows, r + h); rr++) {
      for (let cc = Math.max(0, c); cc < Math.min(cols, c + w); cc++) used[rr][cc] = true;
    }
  }
  function place(t, i, c, r) {
    const it = OBJECT_LISTS[t][i];
    if (!free(c, r, it.w, it.h)) return false;
    objects.push({ t, i, c, r });
    take(c, r, it.w, it.h);
    return true;
  }

  // 橋一定要放：它跨在水上，不能用 free() 檢查
  // 兩頭橋墩外再多留一格，木箱、樹才不會堵在橋口
  if (hasRiver) {
    objects.push({ t: 'bridge', i: 0, c: branchCol, r: bridgeTop - 1 });
    take(branchCol, bridgeTop - 2, 2, 6);
  }

  // 樹：彼此隔開，不擋路
  const trunks = [];
  for (let a = 0, made = 0; a < 500 && made < 14; a++) {
    const i = ri(0, OBJECT_LISTS.tree.length - 1);
    const it = OBJECT_LISTS.tree[i];
    const c = ri(1, cols - it.w - 1), r = ri(1, rows - it.h - 1);
    const tc = c + Math.floor(it.w / 2), tr = r + it.h - 1;
    if (trunks.some((p) => Math.max(Math.abs(p[0] - tc), Math.abs(p[1] - tr)) < 5)) continue;
    if (place('tree', i, c, r)) { trunks.push([tc, tr]); made++; }
  }

  // 灌木：零星
  for (let a = 0, made = 0; a < 300 && made < 12; a++) {
    const big = rand() < 0.4;
    const t = big ? 'bushL' : 'bush';
    const i = ri(0, OBJECT_LISTS[t].length - 1);
    if (place(t, i, ri(1, cols - 3), ri(1, rows - 3))) made++;
  }

  // 道具：靠路邊
  for (let a = 0, made = 0; a < 400 && made < 10; a++) {
    const c = ri(1, cols - 3), r = ri(2, rows - 3);
    if (nRoad(c, r) === 0) continue;
    const i = ri(0, OBJECT_LISTS.prop.length - 1);
    if (place('prop', i, c, r)) made++;
  }

  // 細節
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (used[r][c] || water[r][c]) continue;
      if (road[r][c]) {
        if (rand() < 0.04) objects.push({ t: 'pebble', i: ri(0, OBJECT_LISTS.pebble.length - 1), c, r });
      } else if (rand() < 0.07) {
        objects.push({ t: 'weed', i: ri(0, OBJECT_LISTS.weed.length - 1), c, r });
      }
    }
  }

  return rebuildMap({ cols, rows, ground, objects });
}

/* ---------------------------------------------------------------------
 * 存檔格式
 *
 * 地面存成 "sheet:col,row" 的字串陣列，看得懂也改得動。
 * ------------------------------------------------------------------- */
function serializeMap(map) {
  return {
    version: 1,
    cols: map.cols,
    rows: map.rows,
    ground: map.ground.map((row) => row.map((g) => `${g.sheet}:${g.src[0]},${g.src[1]}`)),
    objects: map.objects.map((o) => ({ t: o.t, i: o.i, c: o.c, r: o.r })),
  };
}

function deserializeMap(data) {
  const cols = Number(data.cols), rows = Number(data.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 4 || rows < 4) {
    throw new Error('地圖檔的尺寸不合理');
  }
  const ground = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cell = data.ground && data.ground[r] && data.ground[r][c];
      let sheet = 'grass', src = GRASS.PLAIN;
      if (typeof cell === 'string') {
        const m = /^(\w+):(\d+),(\d+)$/.exec(cell);
        if (m) { sheet = m[1]; src = [Number(m[2]), Number(m[3])]; }
      }
      row.push({ sheet, src });
    }
    ground.push(row);
  }
  const objects = (Array.isArray(data.objects) ? data.objects : [])
    .filter((o) => o && OBJECT_KINDS[o.t] && OBJECT_LISTS[o.t] && OBJECT_LISTS[o.t][o.i])
    .filter((o) => Number.isFinite(o.c) && Number.isFinite(o.r))
    .map((o) => ({ t: o.t, i: o.i | 0, c: o.c | 0, r: o.r | 0 }));

  return rebuildMap({ cols, rows, ground, objects });
}

/* ---------------------------------------------------------------------
 * 繪製
 * ------------------------------------------------------------------- */
function sheetImage(images, name) { return images[name] || null; }

/* 地面（草地、小路）在 ground.js 用程式畫，這裡只畫地面以上的東西 */

/* 貼地的物件（橋）畫在地面與水之後、植物與貓之前，貓才能走在上面。
 * 右下方墊一條半透明的影子，看起來架在水面上。 */
function drawFlats(ctx, mapData, images) {
  ctx.imageSmoothingEnabled = false;
  const T = TILE_SIZE;
  for (const o of mapData.overlays) {
    if (!o.flat) continue;
    const img = sheetImage(images, o.sheet);
    if (!img) continue;
    const [sx, sy, sw, sh] = o.px;
    const dx = o.col * T + Math.round((o.w * T - sw) / 2);
    const dy = (o.row + o.h) * T - sh;
    ctx.fillStyle = 'rgba(25, 45, 55, 0.35)';
    if (sh > sw) ctx.fillRect(dx + sw - 6, dy + 4, 5, sh - 8);
    else ctx.fillRect(dx + 4, dy + sh - 8, sw - 8, 5);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
  }
}

/* 樹在風裡輕輕擺：每棵樹相位不同，大部分時間停在原位，偶爾偏 1 像素。
 * 一陣風吹過（weather.js 的 windAt）時往右偏，風越大偏得越久。 */
function treeSway(o) {
  if (!CONFIG.AMBIENCE || !CONFIG.SCENE_LIFE || !o.ref || o.ref.t !== 'tree') return 0;
  const t = performance.now() / 1000;
  const gust = windAt(o.col * TILE_SIZE);
  return Math.round(Math.sin(t * 0.9 + o.col * 1.7 + o.row * 0.6) * 0.6 + gust * 0.6);
}

function drawOverlay(ctx, mapData, images, row) {
  ctx.imageSmoothingEnabled = false;
  const T = TILE_SIZE;
  const list = mapData.overlays;

  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const anchor = o.row + o.h - 1;
    if (anchor < row) continue;
    if (anchor > row) break;
    if (o.flat) continue;   // 貼地物件在 drawFlats 畫過了

    const img = sheetImage(images, o.sheet);
    if (!img) continue;

    /* 陰影圖的像素是完全不透明的深褐色，原作是設計成半透明疊加的。
     * 直接畫會在草地上挖出褐色的洞。 */
    const isShadow = (o.sheet === 'shadowPlant');
    if (isShadow) ctx.globalAlpha = 0.26;

    if (o.px) {
      const [sx, sy, sw, sh] = o.px;
      const dx = o.col * T + Math.round((o.w * T - sw) / 2);
      const dy = (o.row + o.h) * T - sh;
      const sway = treeSway(o);
      if (sway) {
        // 樹冠上半截左右挪 1 像素，樹幹不動。整數位移，像素才不會糊。
        const top = Math.round(sh * 0.55);
        ctx.drawImage(img, sx, sy, sw, top, dx + sway, dy, sw, top);
        ctx.drawImage(img, sx, sy + top, sw, sh - top, dx, dy + top, sw, sh - top);
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
      }
    } else {
      ctx.drawImage(img, o.src[0] * T, o.src[1] * T, o.w * T, o.h * T,
        o.col * T, o.row * T, o.w * T, o.h * T);
    }

    if (isShadow) ctx.globalAlpha = 1;
  }
}
