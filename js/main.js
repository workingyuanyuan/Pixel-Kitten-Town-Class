/* =====================================================================
 * main.js — 進入點與主迴圈
 * =====================================================================
 * 階段一 + 二：地圖、貓、座號標籤、姿勢階梯。
 * 階段三：目錄授權、讀取、寫入、去抖動、備份、schema 容錯、唯讀保護。
 * ===================================================================== */

const S = {
  stage: null, pctx: null,   // 畫面上看得到的畫布
  scene: null, sctx: null,   // 實際作畫的畫布，原始像素；每一格最後放大貼到 stage
  labels: null, lctx: null,
  bundle: null,
  map: null,
  cats: [],
  scale: 2,
  dpr: 1,
  lastT: 0,

  // 畫面 = 地圖加外圍的郊外（layout() 裡用 composeView 組出來）
  view: null,
  viewOf: null,                 // 組這個畫面時地圖的 overlays，地圖一改就會換掉
  wrapDev: null,                // 畫布區的螢幕像素尺寸
  origin: { x: 0, y: 0 },       // 地圖左上角在畫面像素層的位置
  labelOrigin: { x: 0, y: 0 },  // 地圖左上角在 UI 層的位置（螢幕像素）

  // 點貓開面板一律可用。加分仍然要在面板上再按一次，
  // 所以誤觸最多只是開了一個面板，不會改到分數。
  hoverCat: null,

  classId: null,     // 目前顯示的班級（對應 data/<classId>.json）
  classes: [],       // 資料夾裡找到的所有班級
  mapDirty: false,   // 地圖有未存檔的編輯

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

/* 地圖存在 data/map-<班級代碼>.json，跟成績檔分開。
 * 每個班級可以有自己的小鎮。 */
function mapFileId() { return 'map-' + currentClassId(); }

/* 載入這個班級的地圖：有存檔就用存檔，沒有就用程式產生的預設地圖。 */
async function loadMap() {
  if (S.dirHandle) {
    try {
      const res = await readClassFile(S.dirHandle, mapFileId());
      if (res.status === 'ok') {
        S.map = deserializeMap(res.parsed);
        S.mapDirty = false;
        return;
      }
      if (res.status === 'corrupt') {
        console.warn(`地圖檔 ${res.name} 解析失敗，改用預設地圖。你的檔案沒有被動過。`);
      }
    } catch (e) {
      console.warn('讀取地圖檔失敗，改用預設地圖。', e);
    }
  }
  S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
  S.mapDirty = false;
}

async function saveMap() {
  if (!S.dirHandle) {
    showBanner('尚未連接資料夾，無法儲存地圖。請先按工具列的「連接資料夾」。', 'warn');
    return;
  }
  try {
    const text = JSON.stringify(serializeMap(S.map), null, 2);
    await writeClassText(S.dirHandle, mapFileId(), text);
    S.mapDirty = false;
    setSaveState('地圖已儲存');
  } catch (e) {
    console.error('儲存地圖失敗', e);
    showBanner('儲存地圖失敗：' + (e && e.message), 'error');
  }
}

/* 目前正在操作哪一個班級。還沒選過就用設定檔裡的預設值。 */
function currentClassId() {
  return S.classId || CONFIG.CLASS_ID;
}

/* ---------------------------------------------------------------------
 * 版面：地圖整張塞進視窗，多出來的地方補上郊外（composeView），畫面不留白
 *
 * 倍率以「螢幕實際像素」計算，不是 CSS 像素。Windows 顯示比例 125%、
 * 瀏覽器放大縮小時，CSS 的 1px 不等於螢幕的 1 像素。
 *
 * 地圖放到塞得下的最大尺寸（CONFIG.PIXEL_PERFECT 時只取整數倍）：
 *   整數倍：直接用 pixelated 放大，像素銳利。
 *   小數倍：先用最近鄰放大到「大一號的整數倍」，再平滑縮到剛好的尺寸。
 *           直接用最近鄰縮放小數倍的話，像素會一格寬一格窄，草地的細節會閃；
 *           這樣做每個像素一樣大，只有邊緣柔一個螢幕像素。
 *   塞不下（視窗比地圖還小）：平滑縮小，免得整排像素消失。
 * 地圖本體永遠完整在畫面內，貓和名字不會被切掉；被裁掉的只有郊外。
 * ------------------------------------------------------------------- */
/* 名字要多少空間（螢幕像素）。
 * 地圖最外圈永遠不能走，貓最靠邊也在第二圈，所以名字可以先佔用最外圈那一格；
 * 不夠的部分才要在地圖外另外留。名字畫在貓頭上，從格子上緣往上大約 19 個 ui 高，
 * 左右各大約 44 個 ui 寬（含小老師星號、座號、四字姓名、等級；ui 見 cats.js 的 drawCatLabels）。 */
function labelRoom(s, dpr) {
  const ui = Math.max(2 * dpr, s);
  return {
    x: Math.max(0, 44 * ui - 1.5 * TILE_SIZE * s),
    y: Math.max(0, 19 * ui - TILE_SIZE * s),
  };
}

/* 留下名字的空間之後，地圖最大能放大幾倍。放得越大、要留的越少，所以用二分搜尋。 */
function largestFit(dev, mapW, mapH) {
  const ok = (s) => {
    const room = labelRoom(s, dev.dpr);
    return mapW * s + 2 * room.x <= dev.w && mapH * s + 2 * room.y <= dev.h;
  };
  let lo = 0.001, hi = Math.min(dev.w / mapW, dev.h / mapH);
  if (ok(hi)) return hi;
  // 視窗小到連名字的空間都留不下：至少讓整張地圖塞得下，名字切掉一點也沒辦法
  if (!ok(lo)) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function wrapDeviceSize() {
  const wrap = document.getElementById('stage-wrap');
  const dpr = window.devicePixelRatio || 1;
  // ResizeObserver 給的是精確的螢幕像素；還沒收到之前用 CSS 尺寸換算
  if (S.wrapDev && S.wrapDev.dpr === dpr) return S.wrapDev;
  return { w: Math.round(wrap.clientWidth * dpr), h: Math.round(wrap.clientHeight * dpr), dpr };
}

function layout() {
  if (!S.map) return;
  const T = TILE_SIZE;
  const mapW = S.map.cols * T, mapH = S.map.rows * T;
  const dev = wrapDeviceSize();
  // 地圖碰到視窗邊緣時，邊上那幾隻貓的名字會被切掉（名字畫在貓的上方、比貓寬），
  // 所以四周要留一點空間，留下來的地方一樣是郊外
  const fit = largestFit(dev, mapW, mapH);
  let s, k;   // s：地圖 1 像素 = 螢幕幾像素；k：先用最近鄰放大幾倍
  if (fit < 1) {
    s = Math.max(0.001, fit); k = 1;
  } else {
    const n = Math.floor(fit);
    // 離整數倍很近就乾脆用整數倍，少一點點尺寸換銳利
    s = (CONFIG.PIXEL_PERFECT || fit / n < 1.08) ? n : fit;
    k = s === n ? 1 : Math.ceil(s);
  }
  S.scale = s;
  S.dpr = dev.dpr;

  // 畫面要涵蓋整個視窗：左右、上下各補幾格郊外（地圖置中，兩邊一樣多）
  const padC = Math.max(0, Math.ceil((dev.w / s - mapW) / 2 / T));
  const padR = Math.max(0, Math.ceil((dev.h / s - mapH) / 2 / T));
  S.view = composeView(S.map, padC, padR);
  S.viewOf = S.map.overlays;
  S.origin = { x: padC * T, y: padR * T };

  // 作畫用的畫布 = 畫面（地圖加郊外）的原始像素；看得到的畫布 = 再放大 k 倍。
  // 顯示時放大成 s 倍並置中，超出視窗的部分裁掉
  const vw = S.view.cols * T, vh = S.view.rows * T;
  if (S.scene.width !== vw) S.scene.width = vw;
  if (S.scene.height !== vh) S.scene.height = vh;
  if (S.stage.width !== vw * k) S.stage.width = vw * k;
  if (S.stage.height !== vh * k) S.stage.height = vh * k;
  const left = Math.round((dev.w - vw * s) / 2), top = Math.round((dev.h - vh * s) / 2);
  S.stage.style.width = (vw * s / dev.dpr) + 'px';
  S.stage.style.height = (vh * s / dev.dpr) + 'px';
  S.stage.style.left = (left / dev.dpr) + 'px';
  S.stage.style.top = (top / dev.dpr) + 'px';
  S.stage.classList.toggle('smooth', s !== Math.floor(s));

  // UI 層：剛好蓋住整個視窗，內部解析度就是螢幕像素，字才會清楚
  if (S.labels.width !== dev.w) S.labels.width = dev.w;
  if (S.labels.height !== dev.h) S.labels.height = dev.h;
  S.labelOrigin = { x: left + S.origin.x * s, y: top + S.origin.y * s };

  S.sctx.imageSmoothingEnabled = false;
  S.pctx.imageSmoothingEnabled = false;
}

/* 拖曳視窗邊框時 resize 會連發，等停下來再重排：郊外的地面要重畫，不便宜 */
let layoutTimer = null;
function scheduleLayout() {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { layoutTimer = null; layout(); }, 120);
}

function watchStageSize() {
  const wrap = document.getElementById('stage-wrap');
  if (typeof ResizeObserver !== 'function') return;
  const ro = new ResizeObserver((entries) => {
    const e = entries[0];
    const box = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
    const dpr = window.devicePixelRatio || 1;
    S.wrapDev = box
      ? { w: box.inlineSize, h: box.blockSize, dpr }
      : { w: Math.round(e.contentRect.width * dpr), h: Math.round(e.contentRect.height * dpr), dpr };
    scheduleLayout();
  });
  try { ro.observe(wrap, { box: 'device-pixel-content-box' }); } catch (_) { ro.observe(wrap); }
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
      S.data = normalizeData(parsed, currentClassId()).data;
      return;
    }
  } catch (e) {
    // 讀不到就往下走
  }
  S.data = createFreshData(currentClassId(), CONFIG.PLACEHOLDER_STUDENT_COUNT);
}

async function loadFromDisk() {
  const res = await readClassFile(S.dirHandle, currentClassId());

  if (res.status === 'ok') {
    const { data, warnings } = normalizeData(res.parsed, currentClassId());
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
    S.data = createFreshData(currentClassId(), CONFIG.PLACEHOLDER_STUDENT_COUNT);
    S.readOnly = false;
    S.lastRaw = null;
    const text = JSON.stringify(S.data, null, 2);
    await writeClassText(S.dirHandle, currentClassId(), text);
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
    S.data = createFreshData(currentClassId(), CONFIG.PLACEHOLDER_STUDENT_COUNT);
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
      await makeDailyBackup(S.dirHandle, currentClassId(), S.lastRaw);
      await writeClassText(S.dirHandle, currentClassId(), text);

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
  // 加分會讓加分次數增加，可能剛好把瞌睡狀態解除掉
  refreshDrowsy(studentId);
  if (panelIsOpen() && panelCat() && panelCat().student.id === studentId) {
    refreshPanel();
    if (result.leveledUp) flashLevelUp(result.toLevel);
  }
  scheduleSave();
  refreshControls();
}

/* ---------------------------------------------------------------------
 * 登記
 *
 * 留下一筆有時間、有事由的佐證，完全不動分數。
 * 這是刻意與加分分開的第二條路徑：加分改分數，登記記事實。
 * ------------------------------------------------------------------- */
function logNoteFor(studentId, reason) {
  if (S.readOnly) return;
  const r = logNote(S.data, studentId, reason);
  if (!r.ok) return;

  const cat = S.cats.find((c) => c.student.id === studentId);
  if (cat) playNote(cat);

  refreshDrowsy(studentId);
  if (panelIsOpen() && panelCat() && panelCat().student.id === studentId) refreshPanel();

  const s = studentById(S.data, studentId);
  showToast(`已登記：${studentLabel(s)}　${r.event.reason}`, null, null);

  scheduleSave();
  refreshControls();
}

/* 撤銷一筆登記。與加分的復原一樣是追加紀錄，原紀錄永遠留在檔案裡。 */
function undoNoteFor(eventId) {
  if (S.readOnly) return;
  const r = undoNote(S.data, eventId);
  if (!r.ok) return;

  refreshDrowsy(r.student.id);
  afterMutation(r.student.id);
  showToast(`已撤銷登記：${studentLabel(r.student)}　${r.original.reason}`, null, null);
}

/* ---------------------------------------------------------------------
 * 瞌睡狀態
 *
 * 每一格畫面都去掃整份 log 太浪費，所以把結果快取在貓身上，
 * 只在資料有變動時重算。傳 studentId 只更新一隻，不傳就全部重算。
 *
 * 狀態真的改變時要立刻換動作，不然貓會維持原本的動畫直到計時器到期，
 * 老師按完登記卻看不到反應，會以為沒生效。
 * ------------------------------------------------------------------- */
function refreshDrowsy(studentId) {
  if (!S.data || !S.cats) return;
  for (const cat of S.cats) {
    if (studentId && cat.student.id !== studentId) continue;
    const next = isDrowsy(S.data, cat.student.id);
    if (next === cat.drowsy) continue;
    cat.drowsy = next;
    enterIdle(cat);
  }
}

function saveAppearance(student, raw) {
  if (S.readOnly || !S.dirHandle || !S.data.students.includes(student)) return false;
  const appearance = normalizeAppearance(raw);
  if (!appearance || !appearanceAvailable(appearance, S.bundle)) return false;
  if (JSON.stringify(appearanceOf(student)) === JSON.stringify(appearance)) return true;
  student.appearance = appearance;
  const cat = S.cats.find(c => c.student === student);
  if (cat) {
    applyCharacterAppearance(cat, appearance);
    enterIdle(cat);
  }
  S.data.updated_at = nowIso();
  scheduleSave();
  refreshPanel();
  showToast('已套用' + ANIMAL_SPECIES[appearance.species].label + '形象');
  return true;
}

/* ---------------------------------------------------------------------
 * 復原
 *
 * 復原不需要編輯模式，也不需要先點貓 —— 老師發現按錯的時候，
 * 通常已經在講下一件事了，這時候要能直接 Ctrl+Z。
 * ------------------------------------------------------------------- */
function studentLabel(s) {
  return s.name && s.name.trim() ? `${s.seat}號 ${s.name}` : '座號 ' + s.seat;
}

function doUndo() {
  if (S.readOnly) return;
  const target = lastUndoable(S.data);
  if (!target) {
    setSaveState('沒有可以復原的加分');
    return;
  }
  applyUndo(target.id);
}

/* 復原指定的一筆。面板裡每筆紀錄旁邊的復原鈕也走這裡，
 * 用來處理「加錯人」而不是「多加一次」。 */
function applyUndo(eventId) {
  if (S.readOnly) return;
  const r = undoEvent(S.data, eventId);
  if (!r.ok) return;

  afterMutation(r.student.id);
  showToast(
    `已復原：${studentLabel(r.student)} ＋${r.original.delta}`,
    '取消復原',
    () => {
      const c = cancelUndo(S.data, r.undoEvent.id);
      if (c.ok) {
        afterMutation(c.student.id);
        showToast(`已取消復原：${studentLabel(c.student)} ＋${c.cancelEvent.delta}`, null, null);
      }
    }
  );
}

/* 資料改動之後統一要做的事：更新畫面、面板、存檔。 */
function afterMutation(studentId) {
  const cat = S.cats.find((c) => c.student.id === studentId);
  // 降級不做任何懲罰表現，安靜地改數字就好（見實作計畫第 7 節）。
  if (cat) cat.levelFx = 0;
  refreshDrowsy(studentId);
  if (panelIsOpen() && panelCat() && panelCat().student.id === studentId) refreshPanel();
  scheduleSave();
  refreshControls();
}

let toastTimer = null;

function showToast(text, actionLabel, onAction) {
  const el = document.getElementById('toast');
  const btn = document.getElementById('toast-action');
  document.getElementById('toast-text').textContent = text;

  if (actionLabel && onAction) {
    btn.hidden = false;
    btn.textContent = actionLabel;
    btn.onclick = () => { hideToast(); onAction(); };
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }

  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3200);
}

function hideToast() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  document.getElementById('toast').hidden = true;
}

/* 面板平常從右邊滑出；點的貓在右邊、會被面板蓋住時改從左邊，
 * 老師才看得到那隻貓加分時的動畫。 */
function placePanelAwayFrom(cat) {
  const wrap = document.getElementById('stage-wrap').getBoundingClientRect();
  const x = wrap.left + (S.labelOrigin.x + (cat.x + TILE_SIZE / 2) * S.scale) / S.dpr;
  const panelW = Math.min(380, window.innerWidth * 0.92);
  document.getElementById('panel').classList.toggle('left', x > window.innerWidth - panelW - 60);
}

/* 螢幕座標 -> 地圖內部像素座標（扣掉外圍的郊外，地圖左上角是 0, 0） */
function toMapCoords(clientX, clientY) {
  const r = S.stage.getBoundingClientRect();
  return {
    x: (clientX - r.left) / r.width * S.scene.width - S.origin.x,
    y: (clientY - r.top) / r.height * S.scene.height - S.origin.y,
  };
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

  // 連上之後就不再顯示「連接資料夾」，改成班級下拉選單
  const connectBtn = document.getElementById('btn-connect');
  const classWrap = document.getElementById('class-wrap');
  const disconnectBtn = document.getElementById('btn-disconnect');
  connectBtn.hidden = connected;
  classWrap.hidden = !connected;
  disconnectBtn.hidden = !connected;
  if (!connected) {
    connectBtn.title = S.pendingHandle ? '確認資料夾授權' : '連接資料夾';
  }

  document.getElementById('btn-reload').disabled = !S.dirHandle;

  // 連線狀態改用一顆燈，不佔版面也不用讀字
  const light = document.getElementById('conn-light');
  light.className = 'light ' + (connected ? 'on' : (S.dirHandle ? 'warn' : 'off'));
  light.title = connected ? `已連接：${currentClassId()}`
    : (S.dirHandle ? '資料檔有問題，目前唯讀' : '尚未連接資料夾');

  setStatus(`${S.data ? S.data.students.length : 0} 位學生`);
}

/* 把資料夾裡找到的班級填進下拉選單。 */
function refreshClassList() {
  const sel = document.getElementById('class-select');
  sel.innerHTML = '';
  for (const id of S.classes) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === currentClassId()) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* 接上一個資料夾之後要做的事：掃出裡面有哪些班級、決定先看哪一班、載入。 */
async function adoptDirectory() {
  try {
    S.classes = await listClasses(S.dirHandle);
  } catch (e) {
    console.warn('列出班級失敗', e);
    S.classes = [];
  }

  // 設定檔指定的班級優先；沒有的話用資料夾裡的第一個；再沒有就建一個新的
  if (S.classes.includes(CONFIG.CLASS_ID)) S.classId = CONFIG.CLASS_ID;
  else if (S.classes.length) S.classId = S.classes[0];
  else S.classId = CONFIG.CLASS_ID;

  await loadFromDisk();
  await loadMap();
  if (!S.classes.includes(currentClassId())) S.classes.push(currentClassId());
  S.classes.sort();

  refreshClassList();
  rebuildCats();
  refreshControls();
}

/* 切換班級：先把還沒寫完的變更寫掉，再換檔案重建整張地圖。 */
async function switchClass(id) {
  if (id === currentClassId()) return;
  if (isDirty()) await doSave();
  closePanel();
  hideToast();
  S.classId = id;
  await loadFromDisk();
  await loadMap();
  rebuildCats();
  refreshControls();
  setSaveState('已切換到 ' + id);
}

function rebuildCats() {
  closePanel();
  S.cats = createCats(S.data.students, S.map, S.bundle);
  // 重建之後貓的 drowsy 都是 false，要照 log 重新算一次，
  // 不然換班或重新載入檔案後，該打瞌睡的貓會站得好好的。
  refreshDrowsy(null);
}

/* ---------------------------------------------------------------------
 * 主迴圈
 * ------------------------------------------------------------------- */
function frame(t) {
  const dt = Math.min(0.05, (t - S.lastT) / 1000 || 0); // 切分頁再回來會有超大 dt，夾住
  S.lastT = t;

  updateCats(S.cats, dt, S.map);
  updatePanel(dt);

  // 地圖改過（編輯、換班、重新產生）就重組外圍的郊外
  if (S.viewOf !== S.map.overlays) layout();
  const view = S.view;

  const sctx = S.sctx;
  sctx.clearRect(0, 0, S.scene.width, S.scene.height);

  // 地面、水、光影、天氣畫在整個畫面（地圖加郊外）上
  // 草地與小路是程式畫的（ground.js），不靠素材圖
  drawProceduralGround(sctx, view, S.bundle.tiles);
  drawGroundLife(sctx);

  drawWater(sctx, view, dt);
  drawFlats(sctx, view, S.bundle.tiles);

  // 天氣與光影只落在地面上，要在植物與貓之前畫
  weatherGround(sctx, view, dt);
  ambienceGround(sctx, view, S.bundle.tiles, dt);

  // 逐列交錯繪製植物與貓，讓前後遮擋正確。貓用的是地圖座標，要平移到畫面上的位置
  for (let row = 0; row <= view.lastRow; row++) {
    if (S.bundle.tiles.plant) drawOverlay(sctx, view, S.bundle.tiles, row);
    const mapRow = row - view.padR;
    if (mapRow < 0 || mapRow >= S.map.rows) continue;
    sctx.save();
    sctx.translate(S.origin.x, S.origin.y);
    drawCatsInRow(sctx, S.cats, S.bundle, mapRow);
    sctx.restore();
  }

  ambienceAir(sctx);
  weatherAir(sctx);

  // 貼到看得到的畫布：k 倍時用最近鄰放大，像素才不會糊
  S.pctx.drawImage(S.scene, 0, 0, S.stage.width, S.stage.height);

  const lctx = S.lctx;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, S.labels.width, S.labels.height);
  lctx.translate(S.labelOrigin.x, S.labelOrigin.y);
  // 字級至少是 CSS 的兩倍像素：瀏覽器放大時名字跟著變大，像素畫則維持銳利
  drawCatLabels(lctx, S.cats, S.scale, 2 * S.dpr);
  drawEditorOverlay(lctx, S.scale);

  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------------
 * 啟動
 * ------------------------------------------------------------------- */
async function boot() {
  S.stage = document.getElementById('stage');
  S.pctx = S.stage.getContext('2d');
  S.scene = document.createElement('canvas');
  S.sctx = S.scene.getContext('2d');
  S.labels = document.getElementById('labels');
  S.lctx = S.labels.getContext('2d');

  document.getElementById('title').textContent = CONFIG.TITLE || '';

  // 按鈕要最先接上。放在後面的話，只要前面任何一個 await 拋錯，
  // 按鈕就永遠不會有作用，而且症狀是「按了完全沒反應」，最難查。
  initPanel({
    onAward: (id, v) => award(id, v),
    onUndo: (eventId) => applyUndo(eventId),
    onNote: (id, reason) => logNoteFor(id, reason),
    onUndoNote: (eventId) => undoNoteFor(eventId),
    onAppearance: saveAppearance,
  });
  wireControls();
  initWeather();

  S.bundle = await loadAllAssets();
  S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
  layout();
  watchStageSize();
  initMapEdit({
    onChange: () => { S.mapDirty = true; rebuildCats(); setSaveState('地圖未存檔…'); },
    onSave: () => saveMap(),
    onRegenerate: () => {
      S.map = generateMap(Date.now() & 0x7fffffff, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
      S.mapDirty = true;
      rebuildCats();
      setSaveState('地圖未存檔…');
    },
  });

  if (!fsaSupported()) {
    showBanner(diagnoseNoPicker(), 'error');
    await loadFallbackData();
  } else {
    const { handle, needsGesture } = await restoreDataDir();
    if (handle && !needsGesture) {
      S.dirHandle = handle;
      await adoptDirectory();
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
      await adoptDirectory();
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

  document.getElementById('class-select').addEventListener('change', (e) => {
    switchClass(e.target.value);
  });

  /* --- 更換資料夾：清除目前的授權，讓老師重新選一個 --- */
  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    // 有未存檔的變更時先確認
    if (isDirty()) {
      const go = confirm('有尚未寫入的變更，更換資料夾會捨棄它們。要繼續嗎？');
      if (!go) return;
      S.savedSeq = S.dataSeq;
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    }

    // 清除 IndexedDB 裡記住的目錄 handle
    await idbDelete(IDB_KEY);

    // 重設連線狀態
    S.dirHandle = null;
    S.pendingHandle = null;
    S.classId = null;
    S.classes = [];
    S.readOnly = true;
    S.lastRaw = null;
    S.dataSeq = 0;
    S.savedSeq = 0;

    closePanel();
    hideToast();
    hideBanner();

    // 用假資料撐畫面
    await loadFallbackData();
    S.map = generateMap(CONFIG.MAP_SEED, CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
    S.mapDirty = false;
    rebuildCats();
    refreshControls();
    setSaveState('已斷開，請重新選擇資料夾');
  });

  /* --- 滑鼠移到貓上時輕微高亮，並把游標換成手指 --- */
  document.getElementById('btn-mapedit').addEventListener('click', () => setMapEdit(!mapEditActive()));

  S.stage.addEventListener('contextmenu', (e) => { if (mapEditActive()) e.preventDefault(); });
  S.stage.addEventListener('pointerdown', (e) => { if (mapEditActive()) editPointerDown(e); });
  window.addEventListener('pointerup', () => { if (mapEditActive()) editPointerUp(); });

  S.stage.addEventListener('pointermove', (e) => {
    if (mapEditActive()) { editPointerMove(e); return; }
    const { x, y } = toMapCoords(e.clientX, e.clientY);
    const hit = catAt(S.cats, x, y);
    if (hit !== S.hoverCat) {
      if (S.hoverCat) S.hoverCat.hovered = false;
      if (hit) hit.hovered = true;
      S.hoverCat = hit;
      S.stage.classList.toggle('on-cat', !!hit);
    }
  });

  S.stage.addEventListener('pointerleave', () => {
    if (S.hoverCat) { S.hoverCat.hovered = false; S.hoverCat = null; }
    S.stage.classList.remove('on-cat');
  });

  /* --- 點貓開面板。加分還要在面板上再按一次，所以誤觸不會改到分數。 --- */
  S.stage.addEventListener('click', (e) => {
    if (mapEditActive()) return;        // 編輯模式由 pointerdown 處理
    const { x, y } = toMapCoords(e.clientX, e.clientY);
    const hit = catAt(S.cats, x, y);
    if (hit) { placePanelAwayFrom(hit); openPanel(hit); }
    else closePanel();   // 點空白處關閉
  });

  /* --- 快捷鍵 --- */
  window.addEventListener('keydown', (e) => {
    // 原生 dialog 自行處理焦點、按鈕與 Escape；不可觸發背景加分快捷鍵。
    if (appearanceEditorOpen()) return;
    // 在輸入框裡打字時不要攔截
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // 登記對話框開著時，整個畫面的快捷鍵都停用。
    // 最怕的是焦點不在輸入框，結果空白鍵直接變成加分。
    if (noteModalOpen()) {
      if (e.key === 'Escape') closeNoteModal();
      e.preventDefault();
      return;
    }

    // 編輯模式的快捷鍵優先（Delete、Ctrl+S、Esc）
    if (editKeyDown(e)) return;

    // Ctrl/Cmd + Z：復原。刻意只在角色面板開著時有效 ——
    // 復原是針對某一位學生的操作，應該在看得到那隻貓的情況下才做。
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (panelIsOpen()) doUndo();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;  // 其他組合鍵不攔

    if (e.key === 'Escape') {
      hideToast();
      closePanel();
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && panelIsOpen()) {
      if (tag === 'BUTTON') return; // 讓聚焦按鈕執行自己的動作
      const cat = panelCat();
      if (cat && !S.readOnly) award(cat.student.id, CONFIG.AWARD_VALUES[0]);
      e.preventDefault();
    }
  });

  window.addEventListener('resize', () => { scheduleLayout(); refreshControls(); });
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
