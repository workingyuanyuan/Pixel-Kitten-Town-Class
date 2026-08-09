/* =====================================================================
 * main.js — 進入點與主迴圈
 * =====================================================================
 * 階段一 + 二：地圖、貓、座號標籤、姿勢階梯。
 * 這個階段全部唯讀，還不會寫任何檔案。
 * ===================================================================== */

const S = {
  stage: null, sctx: null,
  labels: null, lctx: null,
  bundle: null,
  map: null,
  cats: [],
  scale: 2,
  lastT: 0,
};

/* ---------------------------------------------------------------------
 * 縮放：取「塞得下」的最大整數倍率。小數倍率會讓像素糊掉。
 * ------------------------------------------------------------------- */
function computeScale() {
  const wrap = document.getElementById('stage-wrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  const mapW = CONFIG.MAP_COLS * TILE_SIZE;
  const mapH = CONFIG.MAP_ROWS * TILE_SIZE;
  const s = Math.min(Math.floor(availW / mapW), Math.floor(availH / mapH));
  return Math.max(1, s);
}

function layout() {
  const mapW = CONFIG.MAP_COLS * TILE_SIZE;
  const mapH = CONFIG.MAP_ROWS * TILE_SIZE;
  S.scale = computeScale();

  // 像素層：內部解析度 = 地圖原始像素，CSS 尺寸 = 整數倍放大
  S.stage.width = mapW;
  S.stage.height = mapH;
  S.stage.style.width = (mapW * S.scale) + 'px';
  S.stage.style.height = (mapH * S.scale) + 'px';

  // UI 層：內部解析度就是螢幕像素，字才會清楚
  S.labels.width = mapW * S.scale;
  S.labels.height = mapH * S.scale;
  S.labels.style.width = (mapW * S.scale) + 'px';
  S.labels.style.height = (mapH * S.scale) + 'px';

  S.sctx.imageSmoothingEnabled = false;
}

/* ---------------------------------------------------------------------
 * 學生資料
 *
 * 階段二只做唯讀載入。若讀不到範例檔，就依 config 產生座號假資料，
 * 讓地圖照樣跑得起來 —— 開發時不該因為缺一個 JSON 就整個開不了。
 * ------------------------------------------------------------------- */
async function loadStudents() {
  try {
    const res = await fetch(`data/${CONFIG.CLASS_ID}.example.json`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.students) && data.students.length) {
        return normalizeStudents(data.students);
      }
    }
  } catch (e) {
    // 讀不到就往下走，用假資料
  }

  console.info('找不到範例資料檔，改用座號假資料。這在階段一、二是正常的。');
  const n = CONFIG.PLACEHOLDER_STUDENT_COUNT;
  const out = [];
  for (let i = 0; i < n; i++) {
    // 分數刻意平均鋪滿 0..XP_MAX，讓 11 個等級的姿勢一次全部看得到
    const xp = Math.round((i / Math.max(1, n - 1)) * CONFIG.XP_MAX);
    out.push({ id: 's' + String(i + 1).padStart(3, '0'), seat: i + 1, name: '', xp: xp, note: '' });
  }
  return out;
}

/* 手改過的檔案可能缺欄位或型別錯誤，這裡補齊，不讓後面炸掉。 */
function normalizeStudents(list) {
  return list.map((s, i) => ({
    id: typeof s.id === 'string' && s.id ? s.id : 's' + String(i + 1).padStart(3, '0'),
    seat: Number.isFinite(s.seat) ? s.seat : i + 1,
    name: typeof s.name === 'string' ? s.name : '',
    xp: Math.max(0, Math.min(CONFIG.XP_MAX, Number.isFinite(s.xp) ? s.xp : 0)),
    note: typeof s.note === 'string' ? s.note : '',
  }));
}

/* ---------------------------------------------------------------------
 * 主迴圈
 * ------------------------------------------------------------------- */
function frame(t) {
  const dt = Math.min(0.05, (t - S.lastT) / 1000 || 0); // 切到別的分頁再切回來時會有超大 dt，夾住
  S.lastT = t;

  updateCats(S.cats, dt, S.map);

  const sctx = S.sctx;
  sctx.clearRect(0, 0, S.stage.width, S.stage.height);

  if (S.bundle.tiles.grass) {
    drawGround(sctx, S.map, S.bundle.tiles);
  } else {
    sctx.fillStyle = '#5d7a3a';
    sctx.fillRect(0, 0, S.stage.width, S.stage.height);
  }

  // 逐列交錯繪製植物與貓，讓前後遮擋正確
  for (let row = 0; row < S.map.rows; row++) {
    if (S.bundle.tiles.plant) drawOverlay(sctx, S.map, S.bundle.tiles, row);
    drawCatsInRow(sctx, S.cats, S.bundle, row);
  }

  const lctx = S.lctx;
  lctx.clearRect(0, 0, S.labels.width, S.labels.height);
  drawCatLabels(lctx, S.cats, S.scale);

  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------------
 * 啟動
 * ------------------------------------------------------------------- */
async function boot() {
  S.stage = document.getElementById('stage');
  S.sctx = S.stage.getContext('2d');
  S.labels = document.getElementById('labels');
  S.lctx = S.labels.getContext('2d');

  document.getElementById('title').textContent = CONFIG.TITLE || '';

  if (!window.showDirectoryPicker) {
    showBanner(
      '這個瀏覽器不支援本機檔案存取（File System Access API），加分將無法寫回檔案。\n' +
      '請改用最新版的 Chrome 或 Edge 開啟。目前仍可瀏覽畫面。'
    );
  }

  S.bundle = await loadAllAssets();
  const students = await loadStudents();

  S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
  layout();
  S.cats = createCats(students, S.map, S.bundle);

  document.getElementById('status').textContent =
    `${students.length} 位學生　·　地圖 ${CONFIG.MAP_COLS}×${CONFIG.MAP_ROWS}　·　放大 ${S.scale}x`;

  window.addEventListener('resize', () => {
    layout();
    document.getElementById('status').textContent =
      `${students.length} 位學生　·　地圖 ${CONFIG.MAP_COLS}×${CONFIG.MAP_ROWS}　·　放大 ${S.scale}x`;
  });

  S.lastT = performance.now();
  requestAnimationFrame(frame);
}

function showBanner(msg) {
  const b = document.getElementById('banner');
  b.textContent = msg;
  b.hidden = false;
}

window.addEventListener('DOMContentLoaded', boot);
