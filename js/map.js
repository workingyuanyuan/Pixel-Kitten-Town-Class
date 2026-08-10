/* =====================================================================
 * map.js — 確定性地圖生成與繪製模組
 * =====================================================================
 * 本檔案負責地圖的確定性隨機生成（使用 Mulberry32 PRNG）與 Canvas 繪製。
 * 不依賴任何模組載入器，所有函式均暴露於全域範疇。
 * ===================================================================== */

/**
 * 種子偽隨機數生成器 (Mulberry32)。
 * @param {number} seed - 隨機種子整數
 * @returns {function(): number} 回傳 [0, 1) 之間的浮點數
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 純資料地圖生成函式。不包含任何 DOM 或繪製邏輯。
 * @param {number} seed - 地圖種子
 * @param {number} cols - 地圖欄數（預設 30）
 * @param {number} rows - 地圖列數（預設 14）
 * @returns {object} MapData 物件
 */
/* 這一格還是原始的乾淨草地嗎（不是花、不是草叢、不是混草石板）。
 * 用來避免把已經有裝飾的格子再蓋掉。 */
function isPlainGrass(src) {
  return src[0] === GRASS.PLAIN[0] && src[1] === GRASS.PLAIN[1];
}

function generateMap(seed, cols, rows) {
  const rand = mulberry32(seed);

  // 隨機輔助函式
  function randInt(min, max) {
    return min + Math.floor(rand() * (max - min + 1));
  }

  function randChoice(arr) {
    return arr[Math.floor(rand() * arr.length)];
  }

  // 初始化地面與通行狀態陣列
  const ground = [];
  const blocked = [];

  for (let r = 0; r < rows; r++) {
    const gRow = [];
    const bRow = [];
    for (let c = 0; c < cols; c++) {
      gRow.push(null);
      bRow.push(false);
    }
    ground.push(gRow);
    blocked.push(bRow);
  }

  // 1. 生成基礎草地（~72% 乾淨草地，~22% 草叢，~6% 花朵/碎石）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = rand();
      if (v < 0.72) {
        ground[r][c] = { sheet: 'grass', src: GRASS.PLAIN };
      } else if (v < 0.94) {
        ground[r][c] = { sheet: 'grass', src: randChoice(GRASS.TUFT) };
      } else {
        ground[r][c] = { sheet: 'grass', src: randChoice(GRASS.FLOWER) };
      }
    }
  }

  // 2. 生成石板鋪面廣場 (2–3 個軸對齊矩形廣場，大小 4x3 至 9x5，彼此相隔至少 2 格草地)
  const numPlazas = randInt(2, 3);
  const plazas = [];

  for (let i = 0; i < numPlazas; i++) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pw = randInt(4, 9);
      const ph = randInt(3, 5);
      const px = randInt(1, cols - 1 - pw);
      const py = randInt(1, rows - 1 - ph);

      // 檢查是否與已設置廣場重疊或間隔少於 2 格草地
      let valid = true;
      for (let p = 0; p < plazas.length; p++) {
        const existing = plazas[p];
        const sepOK = (
          px >= existing.x + existing.w + 2 ||
          px + pw + 2 <= existing.x ||
          py >= existing.y + existing.h + 2 ||
          py + ph + 2 <= existing.y
        );
        if (!sepOK) {
          valid = false;
          break;
        }
      }

      if (valid) {
        plazas.push({ x: px, y: py, w: pw, h: ph });
        break;
      }
    }
  }

  /* 廣場鋪面。
   *
   * 石板圖集是一整片無縫的室內地板，沒有任何「石頭接草地」的收邊磚，
   * 所以只用它會鋪出一個死板的大灰方塊。收邊要靠草地圖集裡那組
   * 「石頭縫裡長草」的磚（GRASS.BLEND_*），由內而外一層比一層疏，
   * 石板才會自然地羽化進草地。
   *
   * 由內而外：實心地板 → 密集混草 → 中等混草 →（外圍再零星點綴） */
  function plazaDistance(c, r) {
    let best = 999;
    for (let i = 0; i < plazas.length; i++) {
      const p = plazas[i];
      const dx = (c < p.x) ? (p.x - c) : (c >= p.x + p.w ? c - (p.x + p.w - 1) : 0);
      const dy = (r < p.y) ? (p.y - r) : (r >= p.y + p.h ? r - (p.y + p.h - 1) : 0);
      const d = Math.max(dx, dy);
      if (d < best) best = d;
    }
    return best;   // 0 代表在廣場範圍內
  }

  for (let i = 0; i < plazas.length; i++) {
    const p = plazas[i];
    for (let r = p.y; r < p.y + p.h; r++) {
      for (let c = p.x; c < p.x + p.w; c++) {
        const edge = (r === p.y) || (r === p.y + p.h - 1) ||
                     (c === p.x) || (c === p.x + p.w - 1);
        if (edge) {
          ground[r][c] = { sheet: 'grass', src: randChoice(GRASS.BLEND_DENSE) };
        } else {
          ground[r][c] = { sheet: 'stone', src: randChoice(STONE_FLOOR.SOLID) };
        }
      }
    }
  }

  // 廣場外圍第一圈：中等混草，把石板往草地帶出去
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (ground[r][c].sheet !== 'grass') continue;
      const d = plazaDistance(c, r);
      if (d === 1 && rand() < 0.75) {
        ground[r][c] = { sheet: 'grass', src: randChoice(GRASS.BLEND_MEDIUM) };
      }
    }
  }

  // 再外圈與遠處：零星幾塊，看起來像被草長回去的舊石板
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (ground[r][c].sheet !== 'grass') continue;
      if (!isPlainGrass(ground[r][c].src)) continue;
      const d = plazaDistance(c, r);
      const prob = (d === 2) ? 0.45 : (d === 3 ? 0.12 : 0.02);
      if (rand() < prob) {
        ground[r][c] = { sheet: 'grass', src: randChoice(GRASS.BLEND_SPARSE) };
      }
    }
  }

  const overlays = [];

  // 4. 外圍邊界灌木牆 (最外圍一圈設為 blocked: true，約 85% 繪製灌木)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        blocked[r][c] = true;
        if (rand() < 0.85) {
          overlays.push({
            sheet: 'plant',
            src: randChoice(PLANT.BUSHES),
            w: 1,
            h: 1,
            col: c,
            row: r,
          });
        }
      }
    }
  }

  // 5. 大樹 (四角各一棵，加上內部 2–4 棵)
  const treeTrunks = [];

  // 四角大樹
  const cornerRegions = [
    // 左上
    { getC: (w) => randInt(0, Math.min(1, cols - w)), getR: (h) => randInt(0, Math.min(1, rows - h)) },
    // 右上
    { getC: (w) => randInt(Math.max(0, cols - w - 1), cols - w), getR: (h) => randInt(0, Math.min(1, rows - h)) },
    // 左下
    { getC: (w) => randInt(0, Math.min(1, cols - w)), getR: (h) => randInt(Math.max(0, rows - h - 1), rows - h) },
    // 右下
    { getC: (w) => randInt(Math.max(0, cols - w - 1), cols - w), getR: (h) => randInt(Math.max(0, rows - h - 1), rows - h) },
  ];

  for (let i = 0; i < 4; i++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const treeDef = randChoice(PLANT.TREES);
      const w = treeDef.w;
      const h = treeDef.h;
      const dc = Math.max(0, Math.min(cols - w, cornerRegions[i].getC(w)));
      const dr = Math.max(0, Math.min(rows - h, cornerRegions[i].getR(h)));
      const tc = dc + treeDef.anchorCol;
      const tr = dr + h - 1;

      // 檢查是否不在石板鋪面上
      let onStone = false;
      for (let r = dr; r < dr + h; r++) {
        for (let c = dc; c < dc + w; c++) {
          if (ground[r][c].sheet === 'stone') {
            onStone = true;
            break;
          }
        }
        if (onStone) break;
      }

      // 檢查樹幹距離 >= 3
      let trunkCollision = false;
      for (let t = 0; t < treeTrunks.length; t++) {
        const existing = treeTrunks[t];
        if (Math.max(Math.abs(tc - existing.col), Math.abs(tr - existing.row)) < 3) {
          trunkCollision = true;
          break;
        }
      }

      if (!onStone && !trunkCollision) {
        overlays.push({
          sheet: 'plant',
          src: [treeDef.col, treeDef.row],
          w: w,
          h: h,
          col: dc,
          row: dr,
        });
        blocked[tr][tc] = true;
        treeTrunks.push({ col: tc, row: tr });
        break;
      }
    }
  }

  // 內部大樹 (2–4 棵)
  const numInteriorTrees = randInt(2, 4);
  for (let i = 0; i < numInteriorTrees; i++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const treeDef = randChoice(PLANT.TREES);
      const w = treeDef.w;
      const h = treeDef.h;
      const dc = randInt(1, cols - w - 1);
      const dr = randInt(1, rows - h - 1);
      const tc = dc + treeDef.anchorCol;
      const tr = dr + h - 1;

      if (tc < 0 || tc >= cols || tr < 0 || tr >= rows) continue;

      // 檢查是否在石板鋪面上
      let onStone = false;
      for (let r = dr; r < dr + h; r++) {
        for (let c = dc; c < dc + w; c++) {
          if (ground[r][c].sheet === 'stone') {
            onStone = true;
            break;
          }
        }
        if (onStone) break;
      }

      // 檢查樹幹衝突
      let trunkCollision = false;
      for (let t = 0; t < treeTrunks.length; t++) {
        const existing = treeTrunks[t];
        if (Math.max(Math.abs(tc - existing.col), Math.abs(tr - existing.row)) < 3) {
          trunkCollision = true;
          break;
        }
      }

      if (!onStone && !trunkCollision && !blocked[tr][tc]) {
        overlays.push({
          sheet: 'plant',
          src: [treeDef.col, treeDef.row],
          w: w,
          h: h,
          col: dc,
          row: dr,
        });
        blocked[tr][tc] = true;
        treeTrunks.push({ col: tc, row: tr });
        break;
      }
    }
  }

  // 6. 擺設 10–16 個 PROPS.SOLID 道具 (偏好廣場邊緣與樹幹周圍)
  const targetPropsCount = randInt(10, 16);

  for (let i = 0; i < targetPropsCount; i++) {
    const propDef = randChoice(PROPS.SOLID);
    const w = propDef.w;
    const h = propDef.h;

    let bestCandidate = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < 25; attempt++) {
      const c = randInt(1, cols - w - 1);
      const r = randInt(1, rows - h - 1);

      // 硬性條件：不超出內圈、不佔用石板鋪面、不與已 Blocked 格子重疊
      let valid = true;
      for (let pr = r; pr < r + h; pr++) {
        for (let pc = c; pc < c + w; pc++) {
          if (ground[pr][pc].sheet === 'stone' || blocked[pr][pc]) {
            valid = false;
            break;
          }
        }
        if (!valid) break;
      }

      if (!valid) continue;

      let score = 1;
      // 鄰近石板鋪面加分
      let nearStone = false;
      for (let p = 0; p < plazas.length; p++) {
        const pl = plazas[p];
        const dx = (c + w - 1 < pl.x) ? (pl.x - (c + w - 1)) : (c >= pl.x + pl.w ? c - (pl.x + pl.w - 1) : 0);
        const dy = (r + h - 1 < pl.y) ? (pl.y - (r + h - 1)) : (r >= pl.y + pl.h ? r - (pl.y + pl.h - 1) : 0);
        if (Math.max(dx, dy) <= 2) {
          nearStone = true;
          break;
        }
      }
      if (nearStone) score += 3;

      // 鄰近樹幹加分
      let nearTree = false;
      for (let t = 0; t < treeTrunks.length; t++) {
        const trk = treeTrunks[t];
        const dx = (trk.col < c) ? (c - trk.col) : (trk.col >= c + w ? trk.col - (c + w - 1) : 0);
        const dy = (trk.row < r) ? (r - trk.row) : (trk.row >= r + h ? trk.row - (r + h - 1) : 0);
        if (Math.max(dx, dy) <= 2) {
          nearTree = true;
          break;
        }
      }
      if (nearTree) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { c: c, r: r };
      }
    }

    if (bestCandidate) {
      const c = bestCandidate.c;
      const r = bestCandidate.r;
      overlays.push({
        sheet: 'props',
        src: [propDef.col, propDef.row],
        w: w,
        h: h,
        col: c,
        row: r,
      });

      for (let pr = r; pr < r + h; pr++) {
        for (let pc = c; pc < c + w; pc++) {
          blocked[pr][pc] = true;
        }
      }
    }
  }

  // 7. 碎石 (~3%) 與雜草 (~6%，僅非鋪面格)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!blocked[r][c]) {
        const v = rand();
        if (v < 0.03) {
          overlays.push({
            sheet: 'props',
            src: randChoice(PROPS.PEBBLES),
            w: 1,
            h: 1,
            col: c,
            row: r,
          });
        } else if (v < 0.09) {
          if (ground[r][c].sheet === 'grass') {
            overlays.push({
              sheet: 'plant',
              src: randChoice(PLANT.WEEDS),
              w: 1,
              h: 1,
              col: c,
              row: r,
            });
          }
        }
      }
    }
  }

  // 8. 排序 Overlays：依 anchorRow (row + h - 1) 升冪排序，若相同則依 col 排序
  overlays.sort((a, b) => {
    const anchorA = a.row + a.h - 1;
    const anchorB = b.row + b.h - 1;
    if (anchorA !== anchorB) {
      return anchorA - anchorB;
    }
    return a.col - b.col;
  });

  // 9. 容量檢查：確保內部可用格子數量 >= 200
  let freeCount = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!blocked[r][c]) {
        freeCount++;
      }
    }
  }

  if (freeCount < 200) {
    throw new Error(`地圖可用內部格子過少 (${freeCount} < 200)`);
  }

  return {
    cols: cols,
    rows: rows,
    ground: ground,
    blocked: blocked,
    overlays: overlays,
  };
}

/**
 * 繪製地圖地面（草地與石板鋪面）。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D 繪圖上下文
 * @param {object} mapData - 地圖資料
 * @param {object} images - 已載入的圖塊影像物件 { grass, stone, props, plant, shadowPlant }
 */
function drawGround(ctx, mapData, images) {
  ctx.imageSmoothingEnabled = false;
  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 32;

  for (let r = 0; r < mapData.rows; r++) {
    for (let c = 0; c < mapData.cols; c++) {
      const cell = mapData.ground[r][c];
      const img = (images && cell) ? images[cell.sheet] : null;
      const dx = c * tileSize;
      const dy = r * tileSize;

      if (img) {
        const sx = cell.src[0] * tileSize;
        const sy = cell.src[1] * tileSize;
        ctx.drawImage(img, sx, sy, tileSize, tileSize, dx, dy, tileSize, tileSize);
      } else {
        ctx.fillStyle = '#5d7a3a';
        ctx.fillRect(dx, dy, tileSize, tileSize);
      }
    }
  }
}

/**
 * 繪製地圖指定列的覆蓋物件 (Overlays)。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D 繪圖上下文
 * @param {object} mapData - 地圖資料
 * @param {object} images - 已載入的圖塊影像物件 { grass, stone, props, plant, shadowPlant }
 * @param {number} row - 當前繪製的錨點列
 */
function drawOverlay(ctx, mapData, images, row) {
  ctx.imageSmoothingEnabled = false;
  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 32;
  const overlays = mapData.overlays;
  if (!overlays) return;

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const anchorRow = o.row + o.h - 1;
    if (anchorRow === row) {
      const img = images ? images[o.sheet] : null;
      if (img) {
        const sx = o.src[0] * tileSize;
        const sy = o.src[1] * tileSize;
        const sw = o.w * tileSize;
        const sh = o.h * tileSize;
        const dx = o.col * tileSize;
        const dy = o.row * tileSize;
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
      }
    } else if (anchorRow > row) {
      break;
    }
  }
}
