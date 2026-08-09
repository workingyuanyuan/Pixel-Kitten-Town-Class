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
 * @param {number} rows - 地圖列數（預設 16）
 * @returns {object} MapData 物件
 */
function generateMap(seed, cols, rows) {
  const rand = mulberry32(seed);

  // 隨機輔助函式
  function randInt(min, max) {
    return min + Math.floor(rand() * (max - min + 1));
  }

  function randChoice(arr) {
    return arr[Math.floor(rand() * arr.length)];
  }

  // 初始化地面、通行為與石板路標記陣列
  const ground = [];
  const blocked = [];
  const isStonePath = [];

  for (let r = 0; r < rows; r++) {
    const gRow = [];
    const bRow = [];
    const sRow = [];
    for (let c = 0; c < cols; c++) {
      gRow.push(null);
      bRow.push(false);
      sRow.push(false);
    }
    ground.push(gRow);
    blocked.push(bRow);
    isStonePath.push(sRow);
  }

  // 1. 生成基礎草地（70% 乾淨草地，25% 草叢，5% 花朵/碎石）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = rand();
      if (val < 0.70) {
        ground[r][c] = GRASS.PLAIN;
      } else if (val < 0.95) {
        ground[r][c] = randChoice(GRASS.TUFT);
      } else {
        ground[r][c] = randChoice(GRASS.FLOWER);
      }
    }
  }

  // 2. 生成石板小徑（1-2 條蜿蜒小徑，不阻擋通行）
  const numPaths = (rand() < 0.5) ? 1 : 2;

  // 第一條：水平蜿蜒小徑
  let curRow = randInt(2, rows - 3);
  const path1Width = randInt(1, 2);
  for (let c = 0; c < cols; c++) {
    for (let w = 0; w < path1Width; w++) {
      const r = curRow + w;
      if (r >= 0 && r < rows) {
        ground[r][c] = randChoice(GRASS.STONE);
        isStonePath[r][c] = true;
      }
    }
    const step = rand();
    if (step < 0.25 && curRow > 2) {
      curRow--;
    } else if (step > 0.75 && curRow < rows - 3 - path1Width) {
      curRow++;
    }
  }

  // 第二條（若有）：垂直蜿蜒小徑
  if (numPaths === 2) {
    let curCol = randInt(3, cols - 4);
    const path2Width = randInt(1, 2);
    for (let r = 0; r < rows; r++) {
      for (let w = 0; w < path2Width; w++) {
        const c = curCol + w;
        if (c >= 0 && c < cols) {
          ground[r][c] = randChoice(GRASS.STONE);
          isStonePath[r][c] = true;
        }
      }
      const step = rand();
      if (step < 0.25 && curCol > 3) {
        curCol--;
      } else if (step > 0.75 && curCol < cols - 4 - path2Width) {
        curCol++;
      }
    }
  }

  const overlays = [];

  // 3. 外圍邊界灌木牆（最外圍一圈設為 blocked: true，隨機抽樣繪製灌木）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        blocked[r][c] = true;
        // 85% 機率放灌木，15% 留空避免過於機械化
        if (rand() >= 0.15) {
          const bushTile = randChoice(PLANT.BUSHES);
          overlays.push({
            src: bushTile,
            w: 1,
            h: 1,
            col: c,
            row: r,
          });
        }
      }
    }
  }

  // 4. 四角大樹（角落擺放 4 棵大樹，樹幹所在格子設為 blocked: true）
  const cornerConfigs = [
    // 左上角
    {
      cMin: 0, cMax: 1,
      rMin: 0, rMax: 1,
    },
    // 右上角
    {
      cMinFn: (w) => cols - w - 1, cMaxFn: (w) => cols - w,
      rMin: 0, rMax: 1,
    },
    // 左下角
    {
      cMin: 0, cMax: 1,
      rMinFn: (h) => rows - h - 1, rMaxFn: (h) => rows - h,
    },
    // 右下角
    {
      cMinFn: (w) => cols - w - 1, cMaxFn: (w) => cols - w,
      rMinFn: (h) => rows - h - 1, rMaxFn: (h) => rows - h,
    },
  ];

  for (let i = 0; i < 4; i++) {
    const treeDef = randChoice(PLANT.TREES);
    const w = treeDef.w;
    const h = treeDef.h;
    const cfg = cornerConfigs[i];

    let destCol = cfg.cMinFn ? randInt(cfg.cMinFn(w), cfg.cMaxFn(w)) : randInt(cfg.cMin, cfg.cMax);
    let destRow = cfg.rMinFn ? randInt(cfg.rMinFn(h), cfg.rMaxFn(h)) : randInt(cfg.rMin, cfg.rMax);

    // 確保不會超出地圖邊界
    destCol = Math.max(0, Math.min(cols - w, destCol));
    destRow = Math.max(0, Math.min(rows - h, destRow));

    overlays.push({
      src: [treeDef.col, treeDef.row],
      w: w,
      h: h,
      col: destCol,
      row: destRow,
    });

    // 僅樹幹著地處標記為 blocked
    const trunkCol = destCol + treeDef.anchorCol;
    const trunkRow = destRow + h - 1;
    if (trunkRow >= 0 && trunkRow < rows && trunkCol >= 0 && trunkCol < cols) {
      blocked[trunkRow][trunkCol] = true;
    }
  }

  // 5. 內部散落雜草（約 6% 非阻擋、非石板路的內部格子）
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!blocked[r][c] && !isStonePath[r][c]) {
        if (rand() < 0.06) {
          const weedTile = randChoice(PLANT.WEEDS);
          overlays.push({
            src: weedTile,
            w: 1,
            h: 1,
            col: c,
            row: r,
          });
        }
      }
    }
  }

  // 排序 overlays：依錨點列 (row + h - 1) 升冪排序，若相同則依 col 排序
  overlays.sort((a, b) => {
    const anchorA = a.row + a.h - 1;
    const anchorB = b.row + b.h - 1;
    if (anchorA !== anchorB) {
      return anchorA - anchorB;
    }
    return a.col - b.col;
  });

  // 6. 容量檢查：確保可通行的內部格子數量 >= 200
  let freeInterior = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!blocked[r][c]) {
        freeInterior++;
      }
    }
  }

  if (freeInterior < 200) {
    throw new Error(`地圖可用內部格子過少 (${freeInterior} < 200)`);
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
 * 繪製地圖地面（草地與石板路）。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D 繪圖上下文
 * @param {object} mapData - 地圖資料
 * @param {object} images - 已載入的圖塊影像物件 { grass, plant, ... }
 */
function drawGround(ctx, mapData, images) {
  ctx.imageSmoothingEnabled = false;
  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 32;
  const img = images.grass;

  for (let r = 0; r < mapData.rows; r++) {
    for (let c = 0; c < mapData.cols; c++) {
      const tile = mapData.ground[r][c];
      const sx = tile[0] * tileSize;
      const sy = tile[1] * tileSize;
      const dx = c * tileSize;
      const dy = r * tileSize;
      ctx.drawImage(img, sx, sy, tileSize, tileSize, dx, dy, tileSize, tileSize);
    }
  }
}

/**
 * 繪製地圖指定列的覆蓋植物 (Overlays)。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D 繪圖上下文
 * @param {object} mapData - 地圖資料
 * @param {object} images - 已載入的圖塊影像物件 { grass, plant, ... }
 * @param {number} row - 當前繪製的錨點列
 */
function drawOverlay(ctx, mapData, images, row) {
  ctx.imageSmoothingEnabled = false;
  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 32;
  const img = images.plant;
  const overlays = mapData.overlays;

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const anchorRow = o.row + o.h - 1;
    if (anchorRow === row) {
      const sx = o.src[0] * tileSize;
      const sy = o.src[1] * tileSize;
      const sw = o.w * tileSize;
      const sh = o.h * tileSize;
      const dx = o.col * tileSize;
      const dy = o.row * tileSize;
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    } else if (anchorRow > row) {
      // 由於 overlays 已依 anchorRow 排序，當 anchorRow 超過當前列時可提前中斷
      break;
    }
  }
}
