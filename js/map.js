/* =====================================================================
 * map.js — 有層次、有規劃的俯視地圖
 * =====================================================================
 *
 * 設計原則（照 Cainos 官方示範地圖的邏輯）：
 *
 *   1. 有高低差才有層次。上層平台的南側露出一道擋土牆立面，配一座階梯
 *      走下來。少了這道牆，整張圖就只是一片平的草皮。
 *   2. 石板是「路」，不是點綴。道路連續鋪滿、有寬度有走向，只有邊緣不規則。
 *   3. 撐起秩序的是牆。院落、門洞，讓畫面看起來被設計過。
 *   4. 灌木是散落的植栽，不是圍牆。沿著地圖四周圍一圈灌木很不自然，
 *      真正的場景裡它們是零星長在空地上的。
 *   5. 一切都要落地：植物先畫半透明影子再畫本體。
 *
 * 【物件一律用像素矩形繪製】理由見 tileset.js 開頭。簡單說：這些圖集
 * 不是每格一個物件，用格線切一定會切到隔壁，造成描邊斷裂、上緣被砍、
 * 憑空出現碎片。
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

function isPlainGrass(src) {
  return src[0] === GRASS.PLAIN[0] && src[1] === GRASS.PLAIN[1];
}

function generateMap(seed, cols, rows) {
  const rand = mulberry32(seed);
  const ri = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const ground = [];
  const blocked = [];
  const road = [];
  const solid = [];
  const upper = [];   // 是不是在上層平台上

  for (let r = 0; r < rows; r++) {
    ground.push(new Array(cols));
    blocked.push(new Array(cols).fill(false));
    road.push(new Array(cols).fill(false));
    solid.push(new Array(cols).fill(false));
    upper.push(new Array(cols).fill(false));
    for (let c = 0; c < cols; c++) {
      const v = rand();
      ground[r][c] = {
        sheet: 'grass',
        src: v < 0.74 ? GRASS.PLAIN : (v < 0.95 ? pick(GRASS.TUFT) : pick(GRASS.FLOWER)),
      };
    }
  }

  const overlays = [];
  const inB = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;

  /* 放一個像素矩形物件。col/row 是它佔位範圍的左上角。 */
  function obj(sheet, o, col, row) {
    overlays.push({ sheet, px: [o.sx, o.sy, o.sw, o.sh], w: o.w, h: o.h, col, row });
  }
  /* 地磚性質的東西（牆）仍用格座標。 */
  function tile(sheet, src, col, row) {
    overlays.push({ sheet, src, w: 1, h: 1, col, row });
  }
  /* 植物要先影子再本體。 */
  function plant(o, col, row) {
    obj('shadowPlant', o, col, row);
    obj('plant', o, col, row);
  }

  function areaFree(col, row, w, h) {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (!inB(c, r) || blocked[r][c] || road[r][c] || solid[r][c]) return false;
      }
    }
    return true;
  }

  function markBlocked(col, row, w, h, isSolid) {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (!inB(c, r)) continue;
        blocked[r][c] = true;
        if (isSolid) solid[r][c] = true;
      }
    }
  }

  /* ===================================================================
   * 1. 上層平台
   *
   * 平台的南緣露出 3 列高的擋土牆立面，中間開一座階梯。
   * 這是整張圖「有層次」的來源。
   * =================================================================== */
  const terrW = Math.max(10, Math.min(cols - 8, 2 * ri(8, Math.floor((cols - 8) / 2))));
  const terrX = ri(2, Math.max(2, cols - terrW - 2));
  const terrY = 1;
  const terrH = ri(4, 6);                 // 平台上表面的高度（列）
  const faceRow = terrY + terrH;          // 立面第一列
  const groundRow = faceRow + 3;          // 立面之下才是下層地面

  // 平台上表面：鋪一部分石板，其餘留草
  for (let r = terrY; r < faceRow; r++) {
    for (let c = terrX; c < terrX + terrW; c++) {
      upper[r][c] = true;
    }
  }

  // 立面：每 2 格一塊，最後留一段給階梯
  const stairW = 3;
  const stairCol = terrX + 1 + 2 * ri(0, Math.max(0, Math.floor((terrW - stairW - 2) / 2)));

  for (let c = terrX; c < terrX + terrW; c += 2) {
    if (c + 1 >= stairCol && c <= stairCol + stairW - 1) continue;   // 讓位給階梯
    const f = pick(STRUCT.WALL_FACE);
    obj('struct', f, c, faceRow);
    markBlocked(c, faceRow, 2, 3, true);
  }

  // 階梯
  const st = pick(STRUCT.STAIRS);
  obj('struct', st, stairCol, faceRow);
  markBlocked(stairCol, faceRow, stairW, 3, true);

  /* ===================================================================
   * 2. 平台上的院落
   * =================================================================== */
  let compound = null;
  const compW = Math.min(terrW - 4, ri(8, 12));
  const compH = Math.min(terrH, 5);
  if (compW >= 6 && compH >= 4) {
    const cx0 = terrX + Math.floor((terrW - compW) / 2);
    const cy0 = terrY;
    const gate = cx0 + Math.floor(compW / 2);

    for (let c = cx0; c < cx0 + compW; c++) {
      for (let r = cy0; r < cy0 + compH; r++) {
        const isL = c === cx0, isR = c === cx0 + compW - 1;
        const isT = r === cy0, isB = r === cy0 + compH - 1;
        if (!isL && !isR && !isT && !isB) {
          ground[r][c] = { sheet: 'stone', src: pick(STONE_FLOOR.SOLID) };
          road[r][c] = true;
          continue;
        }
        if (isB && Math.abs(c - gate) <= 1) {
          ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
          road[r][c] = true;
          continue;
        }
        let src = isT && isL ? WALL.TL : isT && isR ? WALL.TR : isT ? WALL.T
          : isB && isL ? WALL.BL : isB && isR ? WALL.BR : isB ? WALL.B
          : isL ? WALL.L : WALL.R;
        tile('wall', src, c, r);
        blocked[r][c] = true; solid[r][c] = true;
      }
    }
    compound = { x: cx0, y: cy0, w: compW, h: compH, gate };

    // 中庭焦點
    const fits = PROPS.CENTERPIECES.filter((p) => p.w <= compW - 4 && p.h <= compH - 2);
    if (fits.length) {
      const p = pick(fits);
      let px = cx0 + 1 + Math.floor((compW - 2 - p.w) / 2);
      if (Math.abs(px - gate) <= 1) px = Math.max(cx0 + 1, px - p.w - 1);
      const py = cy0 + 1 + Math.floor((compH - 2 - p.h) / 2);
      obj('props', p, px, py);
      markBlocked(px, py, p.w, p.h, true);
    }
  }

  /* ===================================================================
   * 3. 道路
   * =================================================================== */
  function pave(c, r) {
    if (!inB(c, r) || blocked[r][c] || solid[r][c]) return;
    ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_DENSE) };
    road[r][c] = true;
  }

  // 主幹道：橫貫下層
  const mainRow = Math.min(rows - 4, groundRow + ri(2, Math.max(2, Math.floor((rows - groundRow) / 2))));
  for (let c = 1; c < cols - 1; c++) { pave(c, mainRow); pave(c, mainRow + 1); }

  // 階梯下來接到主幹道
  for (let r = groundRow; r <= mainRow; r++) {
    for (let k = 0; k < stairW; k++) pave(stairCol + k, r);
  }

  // 一條往下的支線，讓下半部不會空
  const branchCol = ri(3, cols - 4);
  for (let r = mainRow + 2; r < rows - 2; r++) pave(branchCol, r);

  // 路緣羽化
  const nRoad = (c, r) => {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dc || dr) && inB(c + dc, r + dr) && road[r + dr][c + dc]) n++;
    }
    return n;
  };
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (road[r][c] || blocked[r][c]) continue;
      const n = nRoad(c, r);
      if (n >= 3 && rand() < 0.7) ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_MEDIUM) };
      else if (n >= 1 && rand() < 0.35) ground[r][c] = { sheet: 'grass', src: pick(GRASS.BLEND_SPARSE) };
    }
  }

  /* ===================================================================
   * 4. 邊界
   *
   * 只擋住不讓貓走出去，不畫任何東西。
   * 沿著四周圍一圈灌木很不自然 —— 真正的場景裡沒有那種東西。
   * 畫面的邊界交給畫布本身的外框處理。
   * =================================================================== */
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) blocked[r][c] = true;
    }
  }

  /* ===================================================================
   * 5. 樹
   * =================================================================== */
  const trunks = [];
  function tryTree(col, row) {
    const t = pick(PLANT.TREES);
    if (col < 1 || row < 1 || col + t.w > cols - 1 || row + t.h > rows - 1) return false;
    const tc = col + Math.floor(t.w / 2), tr = row + t.h - 1;
    if (!inB(tc, tr) || blocked[tr][tc] || road[tr][tc]) return false;
    // 樹冠不要蓋到平台立面或院落
    for (let r = row; r < row + t.h; r++) {
      for (let c = col; c < col + t.w; c++) {
        if (inB(c, r) && solid[r][c]) return false;
      }
    }
    for (const p of trunks) {
      if (Math.max(Math.abs(p[0] - tc), Math.abs(p[1] - tr)) < 5) return false;
    }
    plant(t, col, row);
    blocked[tr][tc] = true;
    trunks.push([tc, tr]);
    return true;
  }
  for (let a = 0, made = 0; a < 400 && made < 12; a++) {
    if (tryTree(ri(1, cols - 5), ri(groundRow, rows - 6))) made++;
  }

  /* ===================================================================
   * 6. 灌木 —— 零星散落，不圍成一圈
   * =================================================================== */
  for (let a = 0, made = 0; a < 300 && made < 14; a++) {
    const c = ri(1, cols - 3), r = ri(1, rows - 2);
    const useLarge = rand() < 0.45;
    const b = useLarge ? pick(PLANT.BUSHES_LARGE) : pick(PLANT.BUSHES);
    if (!areaFree(c, r, b.w, b.h)) continue;
    // 別擋在路中間，也別黏在平台立面上
    if (nRoad(c, r) > 2) continue;
    plant(b, c, r);
    markBlocked(c, r, b.w, b.h, false);
    made++;
  }

  /* ===================================================================
   * 7. 道具：只擺在靠牆或靠路的位置
   * =================================================================== */
  function nearStructure(c, r) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc, nr = r + dr;
      if (!inB(nc, nr)) continue;
      if (solid[nr][nc]) return true;
      if (road[nr][nc] && !road[r][c]) return true;
    }
    return false;
  }
  const spots = [];
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 1; c < cols - 2; c++) {
      if (!blocked[r][c] && !road[r][c] && nearStructure(c, r)) spots.push([c, r]);
    }
  }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = spots[i]; spots[i] = spots[j]; spots[j] = t;
  }
  let props = 0;
  for (const [c, r] of spots) {
    if (props >= 18) break;
    const p = pick(PROPS.SOLID);
    if (!areaFree(c, r, p.w, p.h)) continue;
    obj('props', p, c, r);
    markBlocked(c, r, p.w, p.h, false);
    props++;
  }

  /* ===================================================================
   * 8. 細節
   * =================================================================== */
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (blocked[r][c]) continue;
      if (road[r][c]) {
        if (rand() < 0.05) obj('props', pick(PROPS.PEBBLES), c, r);
      } else if (isPlainGrass(ground[r][c].src) && rand() < 0.09) {
        obj('plant', pick(PLANT.WEEDS), c, r);
      }
    }
  }

  /* 由上而下排序，貓與物件才能正確互相遮擋；同錨點時影子優先。 */
  overlays.sort((a, b) => {
    const aa = a.row + a.h - 1, bb = b.row + b.h - 1;
    if (aa !== bb) return aa - bb;
    if (a.col !== b.col) return a.col - b.col;
    return (a.sheet === 'shadowPlant' ? 0 : 1) - (b.sheet === 'shadowPlant' ? 0 : 1);
  });

  let free = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) if (!blocked[r][c]) free++;
  }
  if (free < 200) throw new Error(`地圖可用格子過少（${free}）。`);

  return { cols, rows, ground, blocked, overlays, upper };
}

/* ---------------------------------------------------------------------
 * 繪製
 * ------------------------------------------------------------------- */
function sheetImage(images, name) {
  return images[name] || null;
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
    if (anchor > row) break;

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
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    } else {
      ctx.drawImage(img, o.src[0] * T, o.src[1] * T, o.w * T, o.h * T,
        o.col * T, o.row * T, o.w * T, o.h * T);
    }

    if (isShadow) ctx.globalAlpha = 1;
  }
}
