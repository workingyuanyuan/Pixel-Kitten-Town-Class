/* =====================================================================
 * storage.js — 檔案讀寫、目錄授權、備份
 * =====================================================================
 *
 * 鐵則（見實作計畫第 3、10 節）：
 *
 *   1. 檔案是唯一真相。記憶體只是當次的快取。任何情況下都不要拿瀏覽器裡
 *      的資料去覆蓋檔案裡比較新的資料。
 *
 *   2. 成績絕對不存在瀏覽器儲存中。IndexedDB 在本專案只有一個合法用途：
 *      記住老師選的資料夾，讓下次開啟不用重選。除此之外一律不准寫入。
 *
 *   3. 解析失敗時絕對不寫檔。壞掉的 JSON 代表老師手改出錯，這時候寫入
 *      等於把他原本的資料銷毀。正確做法是停在唯讀狀態、顯示錯誤、讓他
 *      自己去修檔案。
 * ===================================================================== */

const IDB_NAME = 'pixel-town';
const IDB_STORE = 'handles';
const IDB_KEY = 'data-dir';

/* ---------------------------------------------------------------------
 * IndexedDB —— 只用來存目錄 handle，不存任何成績資料
 * ------------------------------------------------------------------- */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('無法記住資料夾授權，下次開啟需要重新選擇。', e);
  }
}

/* ---------------------------------------------------------------------
 * 目錄授權
 * ------------------------------------------------------------------- */

function fsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/* 老師手動選資料夾。必須由使用者的點擊觸發，不能自動呼叫。
 *
 * 參數刻意維持最精簡。startIn 曾經指定為 'documents'，但那個目錄在某些
 * 環境（例如被 OneDrive 接管）會讓選擇器開不起來，而且它只是個方便性選項。
 * id 用來讓 Chrome 記住上次選過的位置。 */
async function pickDataDir() {
  const handle = await window.showDirectoryPicker({
    id: 'pixel-town-data',
    mode: 'readwrite',
  });
  await idbSet(IDB_KEY, handle);
  return handle;
}

/* 嘗試沿用上次的資料夾。
 * 回傳 { handle, needsGesture }：
 *   needsGesture 為 true 代表授權還在但要老師點一下確認，
 *   這是瀏覽器的規定，不是程式的問題。 */
async function restoreDataDir() {
  const handle = await idbGet(IDB_KEY);
  if (!handle) return { handle: null, needsGesture: false };

  try {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state === 'granted') return { handle, needsGesture: false };
    return { handle, needsGesture: true };
  } catch (e) {
    return { handle: null, needsGesture: false };
  }
}

/* 由點擊觸發，向瀏覽器重新請求授權。 */
async function confirmDataDir(handle) {
  const state = await handle.requestPermission({ mode: 'readwrite' });
  return state === 'granted';
}

/* ---------------------------------------------------------------------
 * 讀取
 *
 * 回傳形狀固定，呼叫端一律看 status：
 *   'ok'        正常讀到並解析成功
 *   'missing'   檔案不存在（第一次使用，可以建立新檔）
 *   'corrupt'   檔案在但 JSON 壞掉 —— 進唯讀狀態，絕對不要寫
 *   'error'     其他讀取錯誤
 * ------------------------------------------------------------------- */
async function readClassFile(dirHandle, classId) {
  const name = `${classId}.json`;
  let fileHandle;

  try {
    fileHandle = await dirHandle.getFileHandle(name, { create: false });
  } catch (e) {
    if (e && e.name === 'NotFoundError') {
      return { status: 'missing', name };
    }
    return { status: 'error', name, error: e };
  }

  let text;
  try {
    const file = await fileHandle.getFile();
    text = await file.text();
  } catch (e) {
    return { status: 'error', name, error: e };
  }

  if (!text.trim()) {
    return { status: 'corrupt', name, raw: text, error: new Error('檔案是空的') };
  }

  try {
    const parsed = JSON.parse(text);
    return { status: 'ok', name, raw: text, parsed };
  } catch (e) {
    return { status: 'corrupt', name, raw: text, error: e };
  }
}

/* ---------------------------------------------------------------------
 * 寫入
 *
 * createWritable() 依規格是寫進暫存檔、close() 時才原子性地取代原檔，
 * 所以寫到一半被中斷不會留下半截的壞檔案。
 * ------------------------------------------------------------------- */
/* 收的是「已經序列化好的字串」而不是物件。
 * 這一點很重要：序列化必須由呼叫端在同步的那一瞬間完成並記下版本，
 * 才能判斷寫入期間有沒有新的變更被漏掉。 */
async function writeClassText(dirHandle, classId, text) {
  const name = `${classId}.json`;
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/* ---------------------------------------------------------------------
 * 備份
 *
 * 每天第一次寫入時，把「當時檔案裡的內容」複製一份到 backups/。
 * 備份的是寫入前的舊內容，不是新內容 —— 這樣誤操作才救得回來。
 * ------------------------------------------------------------------- */
function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function makeDailyBackup(dirHandle, classId, rawTextBeforeWrite) {
  if (!rawTextBeforeWrite) return false;

  const backupsDir = await dirHandle.getDirectoryHandle('backups', { create: true });
  const name = `${classId}-${todayStamp()}.json`;

  // 今天已經備份過就不再重複
  try {
    await backupsDir.getFileHandle(name, { create: false });
    return false;
  } catch (e) {
    if (!e || e.name !== 'NotFoundError') throw e;
  }

  const fh = await backupsDir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(rawTextBeforeWrite);
  } finally {
    await w.close();
  }

  await pruneBackups(backupsDir, classId, CONFIG.BACKUP_KEEP_DAYS);
  return true;
}

async function pruneBackups(backupsDir, classId, keep) {
  const prefix = `${classId}-`;
  const names = [];
  for await (const [name, handle] of backupsDir.entries()) {
    if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith('.json')) {
      names.push(name);
    }
  }
  // 檔名含 YYYY-MM-DD，字串排序就等於日期排序
  names.sort();
  const excess = names.length - keep;
  for (let i = 0; i < excess; i++) {
    try {
      await backupsDir.removeEntry(names[i]);
    } catch (e) {
      console.warn('刪除舊備份失敗：' + names[i], e);
    }
  }
}
