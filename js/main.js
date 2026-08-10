/* =====================================================================
 * main.js — 進入點與主迴圈
 * =====================================================================
 * 階段一 + 二：地圖、貓、座號標籤、姿勢階梯。
 * 階段三：目錄授權、讀取、寫入、去抖動、備份、schema 容錯、唯讀保護。
 * ===================================================================== */

const S = {
  stage: null, sctx: null,
  labels: null, lctx: null,
  bundle: null,
  map: null,
  cats: [],
  scale: 2,
  lastT: 0,

  // --- 階段三 ---
  dirHandle: null,      // 已授權的 data/ 目錄
  pendingHandle: null,  // 授權還在但需要老師點一下確認
  data: null,           // 記憶體中的資料（檔案才是真相）
  lastRaw: null,        // 上次讀到／寫出的檔案內容，備份用
  readOnly: true,       // 尚未連接資料夾、或檔案壞掉時為 true
  dirty: false,         // 有尚未寫入的變更
  saveTimer: null,
  saving: false,
};

/* ---------------------------------------------------------------------
 * 縮放：取「塞得下」的最大整數倍率。小數倍率會讓像素糊掉。
 * ------------------------------------------------------------------- */
function computeScale() {
  const wrap = document.getElementById('stage-wrap');
  const mapW = CONFIG.MAP_COLS * TILE_SIZE;
  const mapH = CONFIG.MAP_ROWS * TILE_SIZE;
  const s = Math.min(Math.floor(wrap.clientWidth / mapW), Math.floor(wrap.clientHeight / mapH));
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
 * 資料載入
 * ------------------------------------------------------------------- */

/* 還沒連接資料夾時，用範例檔或座號假資料先把畫面撐起來，全程唯讀。 */
async function loadFallbackData() {
  S.readOnly = true;
  try {
    const res = await fetch(`data/${CONFIG.CLASS_ID}.example.json`, { cache: 'no-store' });
    if (res.ok) {
      const parsed = await res.json();
      S.data = normalizeData(parsed, CONFIG.CLASS_ID).data;
      return;
    }
  } catch (e) {
    // 讀不到就往下走
  }
  S.data = createFreshData(CONFIG.CLASS_ID, CONFIG.PLACEHOLDER_STUDENT_COUNT);
}

async function loadFromDisk() {
  const res = await readClassFile(S.dirHandle, CONFIG.CLASS_ID);

  if (res.status === 'ok') {
    const { data, warnings } = normalizeData(res.parsed, CONFIG.CLASS_ID);
    S.data = data;
    S.lastRaw = res.raw;
    S.readOnly = false;
    S.dirty = false;
    hideBanner();
    if (warnings.length) {
      showBanner(
        `資料檔有 ${warnings.length} 處格式問題，已在記憶體中自動修正（詳見瀏覽器主控台）。\n` +
        `下次加分時才會把修正後的內容寫回檔案。`, 'warn'
      );
    }
    return true;
  }

  if (res.status === 'missing') {
    // 真的沒有這個檔案才建立。這是安全的：不會覆蓋任何東西。
    S.data = createFreshData(CONFIG.CLASS_ID, CONFIG.PLACEHOLDER_STUDENT_COUNT);
    S.readOnly = false;
    S.lastRaw = null;
    await writeClassFile(S.dirHandle, CONFIG.CLASS_ID, S.data);
    S.lastRaw = JSON.stringify(S.data, null, 2);
    hideBanner();
    console.info(`找不到 ${res.name}，已建立新檔（${CONFIG.PLACEHOLDER_STUDENT_COUNT} 個座號）。`);
    return true;
  }

  if (res.status === 'corrupt') {
    // 【絕對不要寫檔】壞掉的 JSON 代表老師手改出錯，這時候寫入等於銷毀資料。
    S.readOnly = true;
    // 刻意用全 0 分的空白座號，不要退回範例資料 ——
    // 在老師面前顯示一堆不是他班上的分數，比顯示空白更危險。
    S.data = createFreshData(CONFIG.CLASS_ID, CONFIG.PLACEHOLDER_STUDENT_COUNT);
    showBanner(
      `無法解析 ${res.name}：${res.error && res.error.message}\n` +
      `已切換為唯讀狀態，不會寫入任何內容，你的檔案原封不動。\n` +
      `請用文字編輯器修好那個檔案，再按「重新載入檔案」。`, 'error'
    );
    return false;
  }

  S.readOnly = true;
  showBanner(`讀取 ${res.name} 失敗：${res.error && res.error.message}`, 'error');
  return false;
}

/* ---------------------------------------------------------------------
 * 寫入（去抖動）
 * ------------------------------------------------------------------- */
function scheduleSave() {
  if (S.readOnly || !S.dirHandle) return;
  S.dirty = true;
  setSaveState('未存檔…');
  if (S.saveTimer) clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => { S.saveTimer = null; doSave(); }, CONFIG.SAVE_DEBOUNCE_MS);
}

async function doSave() {
  if (S.readOnly || !S.dirHandle || !S.dirty || S.saving) return;
  S.saving = true;
  setSaveState('存檔中…');
  try {
    // 備份的是「寫入之前」的內容，不是新內容，這樣誤操作才救得回來
    await makeDailyBackup(S.dirHandle, CONFIG.CLASS_ID, S.lastRaw);
    await writeClassFile(S.dirHandle, CONFIG.CLASS_ID, S.data);
    S.lastRaw = JSON.stringify(S.data, null, 2);
    S.dirty = false;
    setSaveState('已存檔 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }));
  } catch (e) {
    console.error('寫入失敗', e);
    setSaveState('存檔失敗');
    showBanner('寫入檔案失敗：' + (e && e.message) + '\n變更仍在記憶體中，請重新連接資料夾後再試。', 'error');
  } finally {
    S.saving = false;
  }
}

/* 關頁前務必把還沒寫的變更擠出去。 */
function flushOnExit() {
  if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
  if (S.dirty) doSave();
}

/* ---------------------------------------------------------------------
 * 加分
 * ------------------------------------------------------------------- */
function award(studentId, delta) {
  if (S.readOnly) return;
  const result = awardXp(S.data, studentId, delta);
  const cat = S.cats.find((c) => c.student.id === studentId);

  if (!result.ok) {
    if (result.reason === 'maxed') setSaveState('已滿分，不再加分');
    return;
  }

  if (cat) {
    playAward(cat, result.applied);
    if (result.leveledUp) playLevelUp(cat);
  }
  scheduleSave();
  refreshControls();
}

/* ---------------------------------------------------------------------
 * 介面
 * ------------------------------------------------------------------- */
function setSaveState(text) {
  document.getElementById('save-state').textContent = text;
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function showBanner(msg, kind) {
  const b = document.getElementById('banner');
  b.textContent = msg;
  b.className = kind || '';
  b.hidden = false;
}

function hideBanner() {
  document.getElementById('banner').hidden = true;
}

function refreshControls() {
  const connected = !!S.dirHandle && !S.readOnly;
  document.getElementById('btn-connect').textContent =
    connected ? '已連接資料夾' : (S.pendingHandle ? '確認資料夾授權' : '連接資料夾');
  document.getElementById('btn-reload').disabled = !S.dirHandle;

  const debugBtn = document.getElementById('btn-debug-award');
  const s1 = S.data ? S.data.students.find((s) => s.seat === 1) : null;
  debugBtn.disabled = !connected || !s1 || isMaxed(s1);
  debugBtn.textContent = s1 && isMaxed(s1)
    ? '座號 1 已滿分'
    : '＋1 給座號 1（測試用）';

  setStatus(
    `${S.data ? S.data.students.length : 0} 位學生　·　` +
    `地圖 ${CONFIG.MAP_COLS}×${CONFIG.MAP_ROWS}　·　放大 ${S.scale}x` +
    (S.readOnly ? '　·　唯讀' : '')
  );
}

function rebuildCats() {
  S.cats = createCats(S.data.students, S.map, S.bundle);
}

/* ---------------------------------------------------------------------
 * 主迴圈
 * ------------------------------------------------------------------- */
function frame(t) {
  const dt = Math.min(0.05, (t - S.lastT) / 1000 || 0); // 切分頁再回來會有超大 dt，夾住
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

  S.bundle = await loadAllAssets();
  S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
  layout();

  if (!fsaSupported()) {
    showBanner(
      '這個瀏覽器不支援本機檔案存取（File System Access API），無法把分數寫回檔案。\n' +
      '請改用最新版的 Chrome 或 Edge 開啟。目前可以瀏覽畫面，但一切都是唯讀的。', 'error'
    );
    await loadFallbackData();
  } else {
    const { handle, needsGesture } = await restoreDataDir();
    if (handle && !needsGesture) {
      S.dirHandle = handle;
      await loadFromDisk();
    } else {
      if (handle) S.pendingHandle = handle;
      await loadFallbackData();
      setSaveState(handle ? '請按上方按鈕確認授權' : '尚未連接資料夾');
    }
  }

  rebuildCats();
  refreshControls();
  wireControls();

  S.lastT = performance.now();
  requestAnimationFrame(frame);
}

function wireControls() {
  document.getElementById('btn-connect').addEventListener('click', async () => {
    try {
      let handle;
      if (S.pendingHandle) {
        const ok = await confirmDataDir(S.pendingHandle);
        if (!ok) { setSaveState('未授權'); return; }
        handle = S.pendingHandle;
        S.pendingHandle = null;
      } else {
        handle = await pickDataDir();
      }
      S.dirHandle = handle;
      await loadFromDisk();
      rebuildCats();
      refreshControls();
      setSaveState(S.readOnly ? '唯讀' : '已連接');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 老師按了取消，不是錯誤
      console.error(e);
      showBanner('連接資料夾失敗：' + (e && e.message), 'error');
    }
  });

  document.getElementById('btn-reload').addEventListener('click', async () => {
    if (S.dirty) {
      const go = confirm('有尚未寫入的變更，重新載入會捨棄它們。要繼續嗎？');
      if (!go) return;
      S.dirty = false;
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    }
    await loadFromDisk();
    rebuildCats();
    refreshControls();
    setSaveState('已重新載入');
  });

  document.getElementById('btn-debug-award').addEventListener('click', () => {
    const s1 = S.data.students.find((s) => s.seat === 1);
    if (s1) award(s1.id, CONFIG.AWARD_VALUES[0]);
  });

  window.addEventListener('resize', () => { layout(); refreshControls(); });
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
  });
}

window.addEventListener('DOMContentLoaded', boot);
