/* =====================================================================
 * mapedit.js — 地圖編輯器
 * =====================================================================
 *
 * 為什麼要有這個東西：
 *
 * 程式可以做到「不破圖」（物件用像素精確矩形切），但做不到「有邏輯」。
 * 什麼位置適合放階梯、擋土牆下面該不該留空地、木桶該靠哪一面牆 ——
 * 這些是空間判斷，需要看得懂場景的人來決定。與其讓程式亂猜，
 * 不如把擺放交給老師。
 *
 * 操作：
 *   工具列 ✎  進入／離開編輯模式
 *   左側面板  選擇要放的東西（分成地面筆刷與各類物件）
 *   左鍵      放置；點在既有物件上會選取它
 *   拖曳      移動已選取的物件
 *   Delete    刪除已選取的物件
 *   右鍵      直接刪除游標下的物件
 *   Ctrl+S    存檔
 *
 * 編輯結果存成 data/map-<班級代碼>.json，下次開啟自動載入。
 * ===================================================================== */

const ED = {
  active: false,
  tool: 'place',        // place | ground | erase
  kind: 'tree',         // 目前選的物件種類
  index: 0,             // 該種類的第幾項
  brush: 0,             // 目前選的地面筆刷
  selected: null,       // 選取中的物件（map.objects 裡的那個物件本身）
  dragging: false,
  dragDX: 0,
  dragDY: 0,
  hoverCell: null,
  onChange: null,       // 資料變動時通知 main（重建貓、標記未存檔）
  onSave: null,
};

function mapEditActive() { return ED.active; }

/* ---------------------------------------------------------------------
 * 建立左側調色盤
 * ------------------------------------------------------------------- */
function initMapEdit(handlers) {
  ED.onChange = handlers.onChange;
  ED.onSave = handlers.onSave;
  ED.onRegenerate = handlers.onRegenerate;

  const root = document.getElementById('editor');

  document.getElementById('ed-close').addEventListener('click', () => setMapEdit(false));
  document.getElementById('ed-save').addEventListener('click', () => ED.onSave && ED.onSave());
  document.getElementById('ed-regen').addEventListener('click', () => {
    if (confirm('重新產生地圖會覆蓋目前的擺放，確定嗎？')) ED.onRegenerate && ED.onRegenerate();
  });

  buildPalette();
}

function paletteButton(canvasDraw, label, onClick, isActive) {
  const b = document.createElement('button');
  b.className = 'ed-item' + (isActive ? ' on' : '');
  const cv = document.createElement('canvas');
  cv.width = 44; cv.height = 44;
  canvasDraw(cv.getContext('2d'));
  b.appendChild(cv);
  const t = document.createElement('span');
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', onClick);
  return b;
}

/* 把圖集上的一塊畫進小方框，等比縮放置中。 */
function drawThumb(ctx, sheetName, sx, sy, sw, sh) {
  const img = S.bundle && S.bundle.tiles[sheetName];
  ctx.imageSmoothingEnabled = false;
  if (!img) { ctx.fillStyle = '#c49a6c'; ctx.fillRect(0, 0, 44, 44); return; }
  const k = Math.min(40 / sw, 40 / sh, 3);
  const w = Math.round(sw * k), h = Math.round(sh * k);
  ctx.drawImage(img, sx, sy, sw, sh, Math.round((44 - w) / 2), Math.round((44 - h) / 2), w, h);
}

function buildPalette() {
  const wrap = document.getElementById('ed-palette');
  wrap.innerHTML = '';

  // --- 地面筆刷 ---
  const gh = document.createElement('div');
  gh.className = 'ed-head';
  gh.textContent = '地面';
  wrap.appendChild(gh);

  const grow = document.createElement('div');
  grow.className = 'ed-row';
  GROUND_BRUSHES.forEach((b, i) => {
    grow.appendChild(paletteButton(
      (ctx) => drawThumb(ctx, b.sheet, b.pool[0][0] * 32, b.pool[0][1] * 32, 32, 32),
      b.label,
      () => { ED.tool = 'ground'; ED.brush = i; ED.selected = null; buildPalette(); },
      ED.tool === 'ground' && ED.brush === i
    ));
  });
  wrap.appendChild(grow);

  // --- 各類物件 ---
  for (const key of Object.keys(OBJECT_KINDS)) {
    const kind = OBJECT_KINDS[key];
    const list = OBJECT_LISTS[key];
    if (!list || !list.length) continue;

    const h = document.createElement('div');
    h.className = 'ed-head';
    h.textContent = kind.label;
    wrap.appendChild(h);

    const row = document.createElement('div');
    row.className = 'ed-row';
    list.forEach((it, i) => {
      const draw = kind.tiled
        ? (ctx) => drawThumb(ctx, kind.sheet, it.src[0] * 32, it.src[1] * 32, 32, 32)
        : (ctx) => drawThumb(ctx, kind.sheet, it.sx, it.sy, it.sw, it.sh);
      row.appendChild(paletteButton(
        draw,
        kind.tiled ? it.label : String(i + 1),
        () => { ED.tool = 'place'; ED.kind = key; ED.index = i; ED.selected = null; buildPalette(); },
        ED.tool === 'place' && ED.kind === key && ED.index === i
      ));
    });
    wrap.appendChild(row);
  }

  document.getElementById('ed-hint').textContent =
    ED.tool === 'ground'
      ? '左鍵拖曳塗地面'
      : '左鍵放置　·　點既有物件可選取並拖曳　·　右鍵或 Delete 刪除';
}

function setMapEdit(on) {
  ED.active = on;
  ED.selected = null;
  ED.dragging = false;
  document.getElementById('editor').hidden = !on;
  document.getElementById('app').classList.toggle('editing', on);
  document.getElementById('btn-mapedit').classList.toggle('on', on);
  if (on) {
    closePanel();
    buildPalette();
  }
}

/* ---------------------------------------------------------------------
 * 命中測試：找出游標下最上層的物件
 *
 * 由後往前找（overlays 已依繪製順序排好），取第一個涵蓋該格的，
 * 這樣點到的會是視覺上最前面那一個。
 * ------------------------------------------------------------------- */
function objectAtCell(map, c, r) {
  for (let i = map.overlays.length - 1; i >= 0; i--) {
    const o = map.overlays[i];
    if (o.sheet === 'shadowPlant') continue;
    if (c >= o.col && c < o.col + o.w && r >= o.row && r < o.row + o.h) return o.ref || null;
  }
  return null;
}

function cellFromEvent(e) {
  const rect = S.stage.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * S.stage.width;
  const y = (e.clientY - rect.top) / rect.height * S.stage.height;
  return { c: Math.floor(x / TILE_SIZE), r: Math.floor(y / TILE_SIZE) };
}

function paintGround(c, r) {
  const b = GROUND_BRUSHES[ED.brush];
  if (!b || c < 0 || r < 0 || c >= S.map.cols || r >= S.map.rows) return;
  const src = b.pool[Math.floor(Math.random() * b.pool.length)];
  S.map.ground[r][c] = { sheet: b.sheet, src: [src[0], src[1]] };
  ED.onChange && ED.onChange();
}

function placeObject(c, r) {
  const list = OBJECT_LISTS[ED.kind];
  const it = list && list[ED.index];
  if (!it) return;
  const w = it.w || 1, h = it.h || 1;
  if (c < 0 || r < 0 || c + w > S.map.cols || r + h > S.map.rows) return;
  S.map.objects.push({ t: ED.kind, i: ED.index, c, r });
  rebuildMap(S.map);
  ED.onChange && ED.onChange();
}

function deleteObject(obj) {
  const idx = S.map.objects.indexOf(obj);
  if (idx < 0) return;
  S.map.objects.splice(idx, 1);
  if (ED.selected === obj) ED.selected = null;
  rebuildMap(S.map);
  ED.onChange && ED.onChange();
}

/* ---------------------------------------------------------------------
 * 滑鼠事件（由 main.js 轉進來）
 * ------------------------------------------------------------------- */
function editPointerDown(e) {
  const { c, r } = cellFromEvent(e);

  if (e.button === 2) {                    // 右鍵：直接刪除
    const hit = objectAtCell(S.map, c, r);
    if (hit) deleteObject(hit);
    return;
  }

  if (ED.tool === 'ground') { paintGround(c, r); return; }

  const hit = objectAtCell(S.map, c, r);
  if (hit) {
    ED.selected = hit;
    ED.dragging = true;
    ED.dragDX = hit.c - c;
    ED.dragDY = hit.r - r;
    return;
  }
  placeObject(c, r);
}

function editPointerMove(e) {
  const cell = cellFromEvent(e);
  ED.hoverCell = cell;

  if (ED.dragging && ED.selected) {
    const nc = cell.c + ED.dragDX, nr = cell.r + ED.dragDY;
    if (nc !== ED.selected.c || nr !== ED.selected.r) {
      const list = OBJECT_LISTS[ED.selected.t];
      const it = list && list[ED.selected.i];
      const w = (it && it.w) || 1, h = (it && it.h) || 1;
      if (nc >= 0 && nr >= 0 && nc + w <= S.map.cols && nr + h <= S.map.rows) {
        ED.selected.c = nc;
        ED.selected.r = nr;
        rebuildMap(S.map);
        ED.onChange && ED.onChange();
      }
    }
    return;
  }

  // 地面筆刷：按著拖曳可以連續塗
  if (ED.tool === 'ground' && (e.buttons & 1)) paintGround(cell.c, cell.r);
}

function editPointerUp() { ED.dragging = false; }

function editKeyDown(e) {
  if (!ED.active) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (ED.selected) { deleteObject(ED.selected); e.preventDefault(); return true; }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    ED.onSave && ED.onSave();
    e.preventDefault();
    return true;
  }
  if (e.key === 'Escape') { setMapEdit(false); return true; }
  return false;
}

/* ---------------------------------------------------------------------
 * 編輯時畫在 UI 層上的輔助線
 * ------------------------------------------------------------------- */
function drawEditorOverlay(lctx, scale) {
  if (!ED.active || !S.map) return;
  const T = TILE_SIZE * scale;

  // 格線
  lctx.save();
  lctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  lctx.lineWidth = 1;
  lctx.beginPath();
  for (let c = 0; c <= S.map.cols; c++) { lctx.moveTo(c * T, 0); lctx.lineTo(c * T, S.map.rows * T); }
  for (let r = 0; r <= S.map.rows; r++) { lctx.moveTo(0, r * T); lctx.lineTo(S.map.cols * T, r * T); }
  lctx.stroke();

  // 游標所在格 + 將要放置的範圍
  if (ED.hoverCell) {
    let w = 1, h = 1;
    if (ED.tool === 'place') {
      const it = OBJECT_LISTS[ED.kind] && OBJECT_LISTS[ED.kind][ED.index];
      if (it) { w = it.w || 1; h = it.h || 1; }
    }
    lctx.strokeStyle = 'rgba(123, 216, 143, 0.9)';
    lctx.lineWidth = 2;
    lctx.strokeRect(ED.hoverCell.c * T + 1, ED.hoverCell.r * T + 1, w * T - 2, h * T - 2);
  }

  // 選取中的物件
  if (ED.selected) {
    const it = OBJECT_LISTS[ED.selected.t] && OBJECT_LISTS[ED.selected.t][ED.selected.i];
    const w = (it && it.w) || 1, h = (it && it.h) || 1;
    lctx.strokeStyle = '#ffd666';
    lctx.lineWidth = 3;
    lctx.setLineDash([6, 4]);
    lctx.strokeRect(ED.selected.c * T + 1, ED.selected.r * T + 1, w * T - 2, h * T - 2);
    lctx.setLineDash([]);
  }

  lctx.restore();
}
