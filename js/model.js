/* =====================================================================
 * model.js — 學生資料、schema 容錯、加分、異動紀錄
 * =====================================================================
 *
 * 這一層完全不碰檔案，也不碰畫面。純資料。
 * 檔案讀寫在 storage.js，畫面在 cats.js / panel.js。
 *
 * 紀錄（log）只能追加，不能刪除或修改。這是老師面對學生質疑時的依據。
 * 復原的做法是追加一筆相反的紀錄，並把原紀錄標記 undone —— 見階段五。
 * ===================================================================== */

const DATA_VERSION = 2;

/* ---------------------------------------------------------------------
 * 產生 id
 *
 * student.id 是永久的：它是決定貓的位置與外觀的雜湊來源。
 * 一旦改了，那個學生的貓就會換位置、換毛色。所以只在新增時產生，
 * 之後永遠不動。
 * ------------------------------------------------------------------- */
function newStudentId() {
  return 's' + Math.random().toString(16).slice(2, 10);
}

function newEventId(state) {
  const n = (state.log ? state.log.length : 0) + 1;
  return 'e' + String(n).padStart(4, '0') + '-' + Math.random().toString(16).slice(2, 6);
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`;
}

/* ---------------------------------------------------------------------
 * 建立全新的資料（第一次使用，還沒有真實名單）
 * 名字留空，畫面上會顯示座號。
 * ------------------------------------------------------------------- */
function createFreshData(classId, count) {
  const students = [];
  for (let i = 0; i < count; i++) {
    students.push({ id: newStudentId(), seat: i + 1, name: '', xp: 0, note: '' });
  }
  return {
    version: DATA_VERSION,
    class_id: classId,
    updated_at: nowIso(),
    students: students,
    log: [],
  };
}

/* ---------------------------------------------------------------------
 * Schema 容錯
 *
 * 老師會手改這個檔案，所以缺欄位要補預設值、型別錯誤要修正，
 * 但每一次修正都要在 console 講清楚改了什麼，不要默默吞掉。
 *
 * 注意這裡「修正」的只是記憶體中的副本。要不要寫回檔案是呼叫端決定的，
 * 而且只有在老師真的做了加分動作時才會寫。
 * ------------------------------------------------------------------- */
function normalizeData(parsed, classId) {
  const warnings = [];
  const src = (parsed && typeof parsed === 'object') ? parsed : {};

  if (!Array.isArray(src.students)) {
    warnings.push('students 不是陣列，已當成空名單處理。');
  }

  const rawStudents = Array.isArray(src.students) ? src.students : [];
  const seenIds = new Set();
  const students = [];

  rawStudents.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      warnings.push(`第 ${i + 1} 筆學生不是物件，已略過。`);
      return;
    }

    let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : null;
    if (!id) {
      id = newStudentId();
      warnings.push(`第 ${i + 1} 筆學生沒有 id，已自動產生 ${id}。`);
    }
    if (seenIds.has(id)) {
      const dup = id;
      id = newStudentId();
      warnings.push(`id 重複（${dup}），第 ${i + 1} 筆已改為 ${id}。`);
    }
    seenIds.add(id);

    let seat = Number(s.seat);
    if (!Number.isFinite(seat) || seat <= 0) {
      seat = i + 1;
      warnings.push(`第 ${i + 1} 筆學生的座號無效，已改為 ${seat}。`);
    }

    let xp = Number(s.xp);
    if (!Number.isFinite(xp)) {
      warnings.push(`座號 ${seat} 的分數不是數字，已當成 0。`);
      xp = 0;
    }
    if (xp < 0) {
      warnings.push(`座號 ${seat} 的分數是負數（${xp}），已改為 0。`);
      xp = 0;
    }
    if (xp > CONFIG.XP_MAX) {
      warnings.push(`座號 ${seat} 的分數 ${xp} 超過上限，已改為 ${CONFIG.XP_MAX}。`);
      xp = CONFIG.XP_MAX;
    }

    students.push({
      id: id,
      seat: Math.floor(seat),
      name: typeof s.name === 'string' ? s.name : '',
      xp: Math.floor(xp),
      note: typeof s.note === 'string' ? s.note : '',
    });
  });

  const rawLog = Array.isArray(src.log) ? src.log : [];
  if (!Array.isArray(src.log) && src.log !== undefined) {
    warnings.push('log 不是陣列，已當成空紀錄處理。');
  }

  // 紀錄一律原樣保留，只補最基本的欄位。絕不因為格式不完美就丟棄任何一筆。
  const log = rawLog.filter((e) => e && typeof e === 'object').map((e) => ({
    id: typeof e.id === 'string' ? e.id : 'e?' + Math.random().toString(16).slice(2, 6),
    ts: typeof e.ts === 'string' ? e.ts : '',
    student_id: typeof e.student_id === 'string' ? e.student_id : '',
    delta: Number.isFinite(Number(e.delta)) ? Number(e.delta) : 0,
    xp_after: Number.isFinite(Number(e.xp_after)) ? Number(e.xp_after) : 0,
    reason: typeof e.reason === 'string' ? e.reason : '',
    undone: e.undone === true,
  }));

  if (log.length !== rawLog.length) {
    warnings.push(`有 ${rawLog.length - log.length} 筆紀錄格式無法辨識，已略過。`);
  }

  const data = {
    version: DATA_VERSION,
    class_id: typeof src.class_id === 'string' && src.class_id ? src.class_id : classId,
    updated_at: typeof src.updated_at === 'string' ? src.updated_at : nowIso(),
    students: students,
    log: log,
  };

  if (warnings.length) {
    console.warn(
      `資料檔有 ${warnings.length} 處需要修正（已在記憶體中修好，尚未寫回檔案）：\n` +
      warnings.map((w) => '  · ' + w).join('\n')
    );
  }

  return { data, warnings };
}

/* ---------------------------------------------------------------------
 * 查詢
 * ------------------------------------------------------------------- */
function studentById(data, id) {
  return data.students.find((s) => s.id === id) || null;
}

/* 這名學生最近的幾筆紀錄，新的在前。 */
function recentLogFor(data, studentId, n) {
  const out = [];
  for (let i = data.log.length - 1; i >= 0 && out.length < n; i--) {
    if (data.log[i].student_id === studentId) out.push(data.log[i]);
  }
  return out;
}

/* ---------------------------------------------------------------------
 * 加分
 *
 * 回傳 { ok, reason, event, leveledUp, fromLevel, toLevel }
 * ok 為 false 時什麼都沒有改變。
 * ------------------------------------------------------------------- */
function awardXp(data, studentId, delta) {
  const s = studentById(data, studentId);
  if (!s) return { ok: false, reason: 'not-found' };

  const fromLevel = levelFromXp(s.xp);

  // 滿分之後不再累積、不寫紀錄。這是刻意的設計決定：
  // 介面上按鈕會變灰，不讓老師誤以為還在計分。
  if (s.xp >= CONFIG.XP_MAX) {
    return { ok: false, reason: 'maxed', fromLevel: fromLevel, toLevel: fromLevel };
  }

  const applied = Math.min(delta, CONFIG.XP_MAX - s.xp);
  s.xp += applied;

  const toLevel = levelFromXp(s.xp);
  const event = {
    id: newEventId(data),
    ts: nowIso(),
    student_id: s.id,
    delta: applied,
    xp_after: s.xp,
    reason: '',
    undone: false,
  };
  data.log.push(event);
  data.updated_at = event.ts;

  return {
    ok: true,
    event: event,
    applied: applied,
    leveledUp: toLevel > fromLevel,
    fromLevel: fromLevel,
    toLevel: toLevel,
  };
}

/* 是否已經滿分（介面用來把加分按鈕變灰）。 */
function isMaxed(student) {
  return student.xp >= CONFIG.XP_MAX;
}
