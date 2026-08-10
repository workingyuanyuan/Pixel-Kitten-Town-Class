/* =====================================================================
 * map.js — 有規劃的俯視地圖：院落、道路、植栽
 * =====================================================================
 *
 * 這一版的設計原則，是照著 Cainos 官方示範地圖的邏輯重寫的：
 *
 *   1. 石板是「路」，不是「點綴」。
 *      官方圖裡的石板彼此相鄰、連成有寬度有走向的道路，邊緣才不規則。
 *      用機率隨機灑點會變成一堆沒有意義的雜訊 —— 那是前一版的錯誤。
 *
 *   2. 撐起「規劃感」的是牆。
 *      有圍牆圍出的院落、有門、有從門口延伸出去的路，畫面才像被設計過。
 *      沒有牆的話，再多道具也只是散落在草地上的雜物。
 *
 *   3. 東西沿著結構擺。
 *      道具靠牆邊、靠路邊；樹在院落外圍成林。不要平均散佈。
 *
 *   4. 一切都要落地。
 *      樹與灌木先畫影子再畫本體，否則會像貼紙浮在草皮上。
 * ===================================================================== */

/**
 * 種子偽隨機數生成器 (Mulberry32)。
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 這一格還是原始的乾淨草地嗎。用來避免蓋掉已經有裝飾的格子。 */
function isPlainGrass(src) {
  return src[0] === GRASS.PLAIN[0] && src[1] === GRASS.PLAIN[1];
}

/**
 * 產生地圖。純資料，不碰 DOM。
 */
function generateMap(seed, cols, rows) {
  const rand = mulberry32(seed);
  const ri = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const ground = [];
  const blocked = [];
  const road = [];      // 是不是道路或院內鋪面
  const solid = [];     // 是不是牆體（樹與道具都要避開）

  for (let r = 0; r < rows; r++) {
    ground.push(new Array(cols));
    blocked.push(new Array(cols).fill(false));
    road.push(new Array(cols).fill(false));
    solid.push(new Array(cols).fill(false));
    for (let c = 0; c < cols; c++) {
      const v = rand();
      ground[r][c] = {
        sheet: 'grass',
        src: v < 0.72 ? GRASS.PLAIN : (v < 0.94 ? pick(GRASS.TUFT) : pick(GRASS.FLOWER)),
      };
    }
  }

  const overlays = [];
  const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const put = (sheet, src, c, r, w, h) => overlays.push({ sheet, src, w: w || 1, h: h || 1, col: c, row: r });

  /* ===================================================================
   * 1. 院落
   *
   * 一圈圍牆，南面牆有牆頂與正面兩層，門開在南面牆上。
   * 院子裡鋪石板，是整張地圖的視覺重心。
   * =================================================================== */
  const compounds = [];

  function buildCompound(x, y, w, h) {
    // 南面牆的正面要再往下佔一列，先確認空間夠
    if (x < 1 || y < 1 || x + w > cols - 1 || y + h + 1 > rows - 1) return false;

    for (const cp of compounds) {
      if (x < cp.x + cp.w + 2 && x + w + 2 > cp.x &&
          y < cp.y + cp.h + 3 && y + h + 3 > cp.y) return false;
    }

    // 門開在南面牆，避開兩端轉角
    const gate = ri(x + 1, x + w - 2);

    for (let c = x; c < x + w; c++) {
      for (let r = y; r < y + h; r++) {
        const isL = c === x, isR = c === x + w - 1;
        const isT = r === y, isB = r === y + h - 1;
        if (!isL && !isR && !isT && !isB) {
          // 院內鋪面
          ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
          road[r][c] = true;
          continue;
        }

        let src = null;
        if (isT && isL) src = WALL.TL;
        else if (isT && isR) src = WALL.TR;
        else if (isT) src = WALL.T;
        else if (isB && isL) src = WALL.BL;
        else if (isB && isR) src = WALL.BR;
        else if (isB) src = WALL.B;
        else if (isL) src = WALL.L;
        else if (isR) src = WALL.R;

        if (isB && c === gate) {
          // 門口：不畫牆，鋪成路讓人走進去
          ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
          road[r][c] = true;
          continue;
        }

        put('wall', src, c, r);
        blocked[r][c] = true;
        solid[r][c] = true;

        // 南面牆的正面，畫在牆頂的下一列
        if (isB) {
          const face = isL ? WALL.BLF : (isR ? WALL.BRF : WALL.BF);
          put('wall', face, c, r + 1);
          blocked[r + 1][c] = true;
          solid[r + 1][c] = true;
        }
      }
    }

    /* 院子中央擺一個焦點物件（石壇或石井）。
     * 官方示範地圖的中庭也是這樣處理的 —— 有焦點，院子才不只是一塊空地。 */
    const iw = w - 2, ih = h - 2;
    const candidates = PROPS.CENTERPIECES.filter((p) => p.w <= iw - 1 && p.h <= ih);
    if (candidates.length) {
      const p = pick(candidates);
      const cy = y + 1 + Math.floor((ih - p.h) / 2);
      const lo = x + 1, hi = x + w - 1 - p.w;

      /* 置中，但要閃開門口那一欄 —— 焦點物件擋住動線就本末倒置了。
       * 先往左讓，讓不開再往右讓，兩邊都不行才放棄。 */
      let cx = x + 1 + Math.floor((iw - p.w) / 2);
      const blocksGate = (px) => gate >= px && gate < px + p.w;
      if (blocksGate(cx)) {
        const left = gate - p.w;
        const right = gate + 1;
        if (left >= lo) cx = left;
        else if (right <= hi) cx = right;
        else cx = -1;
      }

      if (cx >= lo && cx <= hi) {
        put('props', [p.col, p.row], cx, cy, p.w, p.h);
        for (let dr = 0; dr < p.h; dr++) {
          for (let dc = 0; dc < p.w; dc++) {
            blocked[cy + dr][cx + dc] = true;
            solid[cy + dr][cx + dc] = true;
          }
        }
      }
    }

    compounds.push({ x, y, w, h, gate });
    return true;
  }

  // 主院落靠上方，是畫面的重心
  const mainW = ri(8, Math.min(12, cols - 8));
  const mainH = ri(4, 5);
  const mainX = ri(3, Math.max(3, cols - mainW - 3));
  buildCompound(mainX, 1, mainW, mainH);

  // 有空間的話，再放一個小院落在另一側
  if (cols >= 24) {
    const sw = ri(5, 7), sh = ri(3, 4);
    const leftSide = mainX > cols / 2;
    const sx = leftSide ? ri(2, Math.max(2, mainX - sw - 3))
                        : ri(Math.min(cols - sw - 2, mainX + mainW + 3), cols - sw - 2);
    buildCompound(sx, rows - sh - 4, sw, sh);
  }

  /* ===================================================================
   * 2. 道路
   *
   * 一條橫貫地圖的主幹道，加上從每個院落門口接出來的支線。
   * 道路是「連續鋪滿」的，這是它看起來像路而不像雜訊的唯一原因。
   * =================================================================== */
  function paveCell(c, r) {
    if (!inBounds(c, r)) return;
    if (solid[r][c] || blocked[r][c]) return;
    ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
    road[r][c] = true;
  }

  function paveRow(r, c0, c1, width) {
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
      for (let k = 0; k < width; k++) paveCell(c, r + k);
    }
  }

  function paveCol(c, r0, r1, width) {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let k = 0; k < width; k++) paveCell(c + k, r);
    }
  }

  // 主幹道：橫貫，寬 2，位置落在下半部但不貼邊
  const mainRoadRow = Math.min(rows - 4, Math.max(Math.floor(rows * 0.55), 1 + mainH + 2));
  paveRow(mainRoadRow, 1, cols - 2, 2);

  // 支線：從每個院落的門口垂直接到主幹道
  for (const cp of compounds) {
    const gateRow = cp.y + cp.h;           // 門口下方那一列（南面牆正面所在列）
    const from = Math.min(gateRow + 1, rows - 2);
    const to = mainRoadRow;
    paveCol(cp.gate, Math.min(from, to), Math.max(from, to), 1);
    // 門口前面鋪一小塊，讓出入口有個緩衝
    paveCell(cp.gate - 1, from);
    paveCell(cp.gate + 1, from);
  }

  /* 路緣羽化：路旁一圈用中等混草，再外圈零星幾塊，
   * 石板才會自然地融進草地，而不是一刀切。 */
  const isRoad = (c, r) => inBounds(c, r) && road[r][c];
  const roadNeighbours = (c, r) => {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (isRoad(c + dc, r + dr)) n++;
      }
    }
    return n;
  };

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (road[r][c] || blocked[r][c]) continue;
      const n = roadNeighbours(c, r);
      if (n >= 3 && rand() < 0.7) {
        ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_MEDIUM) };
      } else if (n >= 1 && rand() < 0.35) {
        ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_SPARSE) };
      }
    }
  }

  /* ===================================================================
   * 3. 邊界樹籬
   *
   * 不要一圈一模一樣的小灌木 —— 那是複製貼上，不是樹籬。
   * 用一條低頻的波去調整密度，長出成叢與缺口；再讓大叢灌木往內站一格，
   * 形成前後兩層，邊界才有厚度與起伏。
   * =================================================================== */
  const hedgePhase = rand() * Math.PI * 2;

  /* 沿著邊界走一圈的位置參數 t，轉成 0..1 的密度。
   * 兩個不同週期的正弦疊加，看起來像自然的疏密，而不是規律的鋸齒。 */
  function hedgeDensity(t) {
    const a = Math.sin(t * 0.55 + hedgePhase);
    const b = Math.sin(t * 0.23 + hedgePhase * 1.7);
    return 0.5 + 0.32 * a + 0.18 * b;   // 約 0..1
  }

  function plantBush(c, r, allowLarge) {
    if (allowLarge && rand() < 0.34) {
      const L = pick(PLANT.BUSHES_LARGE);
      // 大叢灌木往上長，要確認上方還在圖內
      if (r - L.h + 1 >= 0) {
        put('shadowPlant', [L.col, L.row], c, r - L.h + 1, L.w, L.h);
        put('plant', [L.col, L.row], c, r - L.h + 1, L.w, L.h);
        return true;
      }
    }
    const b = pick(PLANT.BUSHES);
    put('shadowPlant', b, c, r);
    put('plant', b, c, r);
    return true;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== 0 && r !== rows - 1 && c !== 0 && c !== cols - 1) continue;
      blocked[r][c] = true;

      // 沿邊界的行走距離，讓疏密沿著邊界連續變化而不是每格獨立亂數
      const t = (r === 0) ? c
        : (c === cols - 1) ? cols + r
        : (r === rows - 1) ? cols + rows + (cols - c)
        : cols * 2 + rows + (rows - r);

      const d = hedgeDensity(t);
      if (d < 0.18) continue;                    // 缺口：讓樹籬有呼吸
      // 只有下緣與左右緣有往上長的空間，上緣不放大叢（會超出圖外）
      plantBush(c, r, r !== 0 && d > 0.72);
    }
  }

  /* 第二層：邊界往內一格零星補一些矮灌木與雜草，做出厚度。
   * 這一層會擋路，所以放得很克制，避免吃掉貓的站位。 */
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const onInnerRing = (r === 1 || r === rows - 2 || c === 1 || c === cols - 2);
      if (!onInnerRing || blocked[r][c] || road[r][c] || solid[r][c]) continue;
      const t = c * 1.3 + r * 0.7;
      const d = hedgeDensity(t + 3.1);
      if (d > 0.78 && rand() < 0.45) {
        const b = pick(PLANT.BUSHES);
        put('shadowPlant', b, c, r);
        put('plant', b, c, r);
        blocked[r][c] = true;
      } else if (rand() < 0.22) {
        put('plant', pick(PLANT.WEEDS), c, r);   // 雜草不擋路
      }
    }
  }

  /* ===================================================================
   * 4. 樹
   *
   * 沿著地圖外緣與院落外圍成林，不要平均散佈在中間擋住貓。
   * =================================================================== */
  const trunks = [];
  function tryTree(col, row) {
    const t = pick(PLANT.TREES);
    if (col < 1 || row < 1 || col + t.w > cols - 1 || row + t.h > rows - 1) return false;
    const tc = col + t.anchorCol, tr = row + t.h - 1;
    if (!inBounds(tc, tr) || blocked[tr][tc] || road[tr][tc]) return false;
    // 樹冠不要蓋到院落
    for (const cp of compounds) {
      if (col < cp.x + cp.w && col + t.w > cp.x && row < cp.y + cp.h + 2 && row + t.h > cp.y) return false;
    }
    for (const p of trunks) {
      if (Math.max(Math.abs(p[0] - tc), Math.abs(p[1] - tr)) < 4) return false;
    }
    put('shadowPlant', [t.col, t.row], col, row, t.w, t.h);
    put('plant', [t.col, t.row], col, row, t.w, t.h);
    blocked[tr][tc] = true;
    trunks.push([tc, tr]);
    return true;
  }

  for (let attempt = 0, made = 0; attempt < 220 && made < 9; attempt++) {
    // 偏好左右兩側與下緣，中央留給貓
    const edgeBias = rand();
    let col;
    if (edgeBias < 0.4) col = ri(1, Math.max(1, Math.floor(cols * 0.22)));
    else if (edgeBias < 0.8) col = ri(Math.floor(cols * 0.74), cols - 5);
    else col = ri(1, cols - 5);
    const row = ri(Math.max(1, Math.floor(rows * 0.25)), rows - 6);
    if (tryTree(col, row)) made++;
  }

  /* ===================================================================
   * 5. 道具
   *
   * 只擺在「靠牆」或「靠路」的格子。散落在空地中央的木桶沒有故事，
   * 靠著牆角的木桶才有。
   * =================================================================== */
  function nearStructure(c, r) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc, nr = r + dr;
        if (!inBounds(nc, nr)) continue;
        if (solid[nr][nc]) return true;
        if (road[nr][nc] && !road[r][c]) return true;
      }
    }
    return false;
  }

  const propCells = [];
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (blocked[r][c] || road[r][c]) continue;
      if (nearStructure(c, r)) propCells.push([c, r]);
    }
  }
  // 依固定順序洗牌，維持決定性
  for (let i = propCells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = propCells[i]; propCells[i] = propCells[j]; propCells[j] = t;
  }

  let placedProps = 0;
  for (const [c, r] of propCells) {
    if (placedProps >= 14) break;
    const p = pick(PROPS.SOLID);
    if (c + p.w > cols - 1 || r + p.h > rows - 1) continue;
    let ok = true;
    for (let dr = 0; dr < p.h && ok; dr++) {
      for (let dc = 0; dc < p.w; dc++) {
        if (blocked[r + dr][c + dc] || road[r + dr][c + dc]) { ok = false; break; }
      }
    }
    if (!ok) continue;
    put('props', [p.col, p.row], c, r, p.w, p.h);
    for (let dr = 0; dr < p.h; dr++) {
      for (let dc = 0; dc < p.w; dc++) blocked[r + dr][c + dc] = true;
    }
    placedProps++;
  }

  /* ===================================================================
   * 6. 細節：路上的碎石、草地的雜草
   * =================================================================== */
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (blocked[r][c]) continue;
      if (road[r][c]) {
        if (rand() < 0.04) put('props', pick(PROPS.PEBBLES), c, r);
      } else if (isPlainGrass(ground[r][c].src) && rand() < 0.07) {
        put('plant', pick(PLANT.WEEDS), c, r);
      }
    }
  }

  /* 由下往上、由左往右排序，貓與物件才能正確互相遮擋。
   * 影子必須排在同一格的本體前面，所以同錨點時影子優先。 */
  overlays.sort((a, b) => {
    const aa = a.row + a.h - 1, bb = b.row + b.h - 1;
    if (aa !== bb) return aa - bb;
    if (a.col !== b.col) return a.col - b.col;
    const rank = (s) => (s === 'shadowPlant' ? 0 : 1);
    return rank(a.sheet) - rank(b.sheet);
  });

  /* 容量檢查 */
  let free = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) if (!blocked[r][c]) free++;
  }
  if (free < 200) {
    throw new Error(`地圖可用格子過少（${free}），請調大 MAP_COLS / MAP_ROWS。`);
  }

  return { cols, rows, ground, blocked, overlays };
}

/* ---------------------------------------------------------------------
 * 繪製
 * ------------------------------------------------------------------- */

function sheetImage(images, name) {
  if (name === 'grass') return images.grass;
  if (name === 'stone') return images.stone;
  if (name === 'props') return images.props;
  if (name === 'plant') return images.plant;
  if (name === 'wall') return images.wall;
  if (name === 'shadowPlant') return images.shadowPlant;
  return null;
}

function drawGround(ctx, mapData, images) {
  ctx.imageSmoothingEnabled = false;
  const T = TILE_SIZE;

  for (let r = 0; r < mapData.rows; r++) {
    for (let c = 0; c < mapData.cols; c++) {
      const g = mapData.ground[r][c];
      const img = sheetImage(images, g.sheet);
      if (!img) {
        ctx.fillStyle = '#5d7a3a';
        ctx.fillRect(c * T, r * T, T, T);
        continue;
      }
      ctx.drawImage(img, g.src[0] * T, g.src[1] * T, T, T, c * T, r * T, T, T);
    }
  }
}

function drawOverlay(ctx, mapData, images, row) {
  ctx.imageSmoothingEnabled = false;
  const T = TILE_SIZE;
  const list = mapData.overlays;

  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const anchor = o.row + o.h - 1;
    if (anchor < row) continue;
    if (anchor > row) break;          // 已排序，可提前結束

    const img = sheetImage(images, o.sheet);
    if (!img) continue;

    /* 【重要】陰影圖裡的像素是「完全不透明的深褐色」rgba(49,26,18,255)。
     * 它本來就是設計成半透明疊加的（原作在 Unity 用陰影材質處理）。
     * 直接畫上去會變成草地上一個個褐色破洞，而不是影子。 */
    const isShadow = (o.sheet === 'shadowPlant');
    if (isShadow) ctx.globalAlpha = 0.26;

    ctx.drawImage(
      img,
      o.src[0] * T, o.src[1] * T, o.w * T, o.h * T,
      o.col * T, o.row * T, o.w * T, o.h * T
    );

    if (isShadow) ctx.globalAlpha = 1;
  }
}
