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
  saveTimer: null,
  saving: false,

  /* 存檔的版本序號。
   *
   * 這兩個數字是防資料遺失的關鍵。寫檔中間有好幾個 await，老師在那段時間
   * 完全可能又按了一次加分。如果只用一個 dirty 布林旗標，寫完之後把它清成
   * false，就會把寫入期間進來的變更一起清掉 —— 畫面上分數有變、檔案裡卻沒有，
   * 重整之後那一分就消失了。
   *
   * 改法：每次變更 dataSeq +1；寫入前記下當下的序號，寫完才把 savedSeq 設成
   * 那個值。只要 savedSeq 還沒追上 dataSeq，就代表有東西還沒寫，再寫一輪。 */
  dataSeq: 0,
  savedSeq: 0,
};

/* 還有沒有東西沒寫進檔案。由序號推導，不另外存旗標。 */
function isDirty() {
  return S.savedSeq !== S.dataSeq;
}

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
    S.savedSeq = S.dataSeq;   // 剛從檔案讀進來，記憶體與檔案一致
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
    const text = JSON.stringify(S.data, null, 2);
    await writeClassText(S.dirHandle, CONFIG.CLASS_ID, text);
    S.lastRaw = text;
    S.savedSeq = S.dataSeq;
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
  S.dataSeq++;
  setSaveState('未存檔…');
  if (S.saveTimer) clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => { S.saveTimer = null; doSave(); }, CONFIG.SAVE_DEBOUNCE_MS);
}

async function doSave() {
  if (S.readOnly || !S.dirHandle) return;

  // 已經有一輪寫入在跑了。不要平行寫同一個檔案，也不要就這樣算了 ——
  // 那一輪結束前會自己再檢查一次序號，把這次的變更一併寫掉。
  if (S.saving) return;
  if (!isDirty()) return;

  S.saving = true;
  setSaveState('存檔中…');
  try {
    // 只要序號還沒追上就繼續寫。老師在寫入過程中又按了加分時，
    // 這個迴圈會再跑一輪，不會漏掉。
    while (isDirty()) {
      const seq = S.dataSeq;
      // 在同步的這一瞬間定版，之後 S.data 再怎麼變都跟這次寫入無關
      const text = JSON.stringify(S.data, null, 2);

      // 備份的是「寫入之前」的內容，不是新內容，這樣誤操作才救得回來
      await makeDailyBackup(S.dirHandle, CONFIG.CLASS_ID, S.lastRaw);
      await writeClassText(S.dirHandle, CONFIG.CLASS_ID, text);

      S.lastRaw = text;
      S.savedSeq = seq;   // 只認這次寫出去的版本，不是「現在」的版本
    }
    setSaveState('已存檔 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }));
  } catch (e) {
    console.error('寫入失敗', e);
    setSaveState('存檔失敗');
    showBanner('寫入檔案失敗：' + (e && e.message) +
      '\n變更仍在記憶體中，尚未寫入檔案。請重新連接資料夾後再試一次。', 'error');
  } finally {
    S.saving = false;
  }
}

/* 關頁前務必把還沒寫的變更擠出去。 */
function flushOnExit() {
  if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
  if (isDirty()) doSave();
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

/* ---------------------------------------------------------------------
 * 為什麼叫不出資料夾選擇視窗？
 *
 * 這個功能有兩個硬性前提，缺一個都會讓按鈕毫無反應：
 *   1. 瀏覽器必須是 Chrome 系列（Firefox、Safari 都沒有這個 API）
 *   2. 網頁必須從 http://localhost 開啟，不能是直接雙擊 index.html
 *
 * 與其讓老師對著沒反應的按鈕發呆，不如直接告訴他是哪一個前提沒滿足。
 * ------------------------------------------------------------------- */
function diagnoseNoPicker() {
  const ua = navigator.userAgent;
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  const proto = location.protocol;

  let why;
  if (proto === 'file:') {
    why = '你是直接雙擊 index.html 打開的（網址列開頭是 file://）。\n' +
          '這樣瀏覽器不允許存取檔案。請關掉這個分頁，改成雙擊「啟動.bat」。';
  } else if (isFirefox) {
    why = '目前這個瀏覽器是 Firefox，它沒有這個功能。\n請改用 Chrome 或 Edge 開啟。';
  } else if (isSafari) {
    why = '目前這個瀏覽器是 Safari，它沒有這個功能。\n請改用 Chrome 或 Edge 開啟。';
  } else if (!window.isSecureContext) {
    why = `目前的網址（${location.origin}）不是安全來源，瀏覽器因此禁止存取檔案。\n` +
          '請用「啟動.bat」開啟，網址應該是 http://localhost:8173 這樣的形式。';
  } else {
    why = '這個瀏覽器沒有提供 File System Access API。\n請改用最新版的 Chrome 或 Edge。';
  }

  return '無法開啟資料夾選擇視窗。\n\n' + why +
         `\n\n技術資訊：網址 ${proto}//${location.host}　·　瀏覽器 ${ua.slice(0, 90)}`;
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

  // 按鈕要最先接上。放在後面的話，只要前面任何一個 await 拋錯，
  // 按鈕就永遠不會有作用，而且症狀是「按了完全沒反應」，最難查。
  wireControls();

  S.bundle = await loadAllAssets();
  S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
  layout();

  if (!fsaSupported()) {
    showBanner(diagnoseNoPicker(), 'error');
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

  S.lastT = performance.now();
  requestAnimationFrame(frame);
}

function wireControls() {
  document.getElementById('btn-connect').addEventListener('click', async () => {
    // 這裡不能靜靜地失敗。老師按了按鈕卻什麼都沒發生，是最難查的狀況。
    if (!fsaSupported()) {
      showBanner(diagnoseNoPicker(), 'error');
      return;
    }
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
      console.error('連接資料夾失敗', e);
      const name = (e && e.name) || '未知錯誤';

      if (name === 'AbortError') {
        // 【不要靜靜吞掉】AbortError 有兩種來源：老師自己按取消，
        // 或是選擇器根本沒開起來（被瀏覽器政策、擴充功能或環境阻擋）。
        // 兩者無法從錯誤本身分辨，所以一律給回饋，否則按鈕看起來像壞掉。
        setSaveState('選擇已取消');
        showBanner(
          '資料夾選擇視窗被取消，或是根本沒有開起來。\n\n' +
          '如果你剛才有看到選擇視窗並按了取消，那這是正常的，忽略這則訊息即可。\n' +
          '如果你完全沒看到任何視窗，請依序檢查：\n' +
          '  1. 視窗可能開在 Chrome 後面或另一個螢幕，看一下工作列\n' +
          '  2. 用無痕視窗（Ctrl+Shift+N）開 ' + location.origin + ' 再試一次，\n' +
          '     可以排除擴充功能干擾\n' +
          '  3. 網址列輸入 chrome://policy 看有沒有檔案存取相關的限制\n\n' +
          '技術資訊：' + name + '　·　' + (e && e.message), 'warn'
        );
        return;
      }

      setSaveState('連接失敗');
      showBanner(
        '連接資料夾失敗。\n\n' +
        '技術資訊：' + name + '　·　' + (e && e.message), 'error'
      );
    }
  });

  document.getElementById('btn-reload').addEventListener('click', async () => {
    if (isDirty()) {
      const go = confirm('有尚未寫入的變更，重新載入會捨棄它們。要繼續嗎？');
      if (!go) return;
      S.savedSeq = S.dataSeq;   // 明確捨棄
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    }
    await loadFromDisk();
    rebuildCats();
    refreshControls();
    setSaveState('已重新載入');
  });

  document.getElementById('btn-debug-award').addEventListener('click', () => {
    if (!S.data) return;
    const s1 = S.data.students.find((s) => s.seat === 1);
    if (s1) award(s1.id, CONFIG.AWARD_VALUES[0]);
  });

  window.addEventListener('resize', () => { layout(); refreshControls(); });
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((e) => {
    // 啟動失敗一定要看得見，不要只留在主控台
    console.error('啟動失敗', e);
    showBanner('程式啟動時發生錯誤：' + (e && e.message) +
      '\n請把這行訊息告訴開發者。', 'error');
  });
});
