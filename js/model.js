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
    // 這一筆是在復原哪一筆。加分紀錄沒有這個欄位；
    // 復原紀錄指向被復原的加分，取消復原的紀錄指向那筆復原。
    undo_of: typeof e.undo_of === 'string' ? e.undo_of : undefined,
    // 紀錄種類。舊檔案沒有這個欄位，一律當成加分紀錄（undefined）。
    // 目前只有 'note'（登記）與 'note_undo'（撤銷登記）兩種。
    kind: (e.kind === 'note' || e.kind === 'note_undo') ? e.kind : undefined,
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

/* =====================================================================
 * 登記
 * =====================================================================
 *
 * 登記是「留下事實佐證」，不是處罰。老師遇到上課睡覺、吵鬧的時候，
 * 需要的是一筆有時間、有事由的紀錄，好在期末被質疑時拿得出來。
 *
 * 【鐵則】登記絕對不動分數。delta 永遠是 0，xp_after 就是當下的分數。
 *         這個系統從頭到尾只有一個扣分途徑，就是復原加分。
 *
 * 登記紀錄與加分紀錄放在同一個 log 陣列裡，靠 kind === 'note' 分辨。
 * 一樣只能追加，不能刪除。
 * ------------------------------------------------------------------- */

function isNote(e) {
  return e.kind === 'note';
}

function isNoteUndo(e) {
  return e.kind === 'note_undo';
}

/* 登記一筆事由。
 * 回傳 { ok, reason, event }。事由是空字串時不會留下任何紀錄。 */
function logNote(data, studentId, reason) {
  const s = studentById(data, studentId);
  if (!s) return { ok: false, reason: 'not-found' };

  const max = CONFIG.NOTE_MAX_LEN || 60;
  const text = String(reason == null ? '' : reason).trim().slice(0, max);
  if (!text) return { ok: false, reason: 'empty' };

  const event = {
    id: newEventId(data),
    ts: nowIso(),
    student_id: s.id,
    delta: 0,          // 永遠是 0
    xp_after: s.xp,    // 當下分數，登記前後不變
    reason: text,
    undone: false,
    kind: 'note',
  };
  data.log.push(event);
  data.updated_at = event.ts;

  return { ok: true, event: event };
}

/* 登記錯人、或事由打錯了。
 * 做法與加分的復原一致：追加一筆撤銷紀錄，把原本那筆標記 undone，
 * 兩筆都留在檔案裡。 */
function undoNote(data, eventId) {
  const original = eventById(data, eventId);
  if (!original || !isNote(original) || original.undone) {
    return { ok: false, reason: 'not-undoable' };
  }
  const student = studentById(data, original.student_id);
  if (!student) return { ok: false, reason: 'student-missing' };

  const rec = {
    id: newEventId(data),
    ts: nowIso(),
    student_id: student.id,
    delta: 0,
    xp_after: student.xp,
    reason: original.reason,
    undone: false,
    kind: 'note_undo',
    undo_of: original.id,
  };
  data.log.push(rec);
  original.undone = true;
  data.updated_at = rec.ts;

  return { ok: true, student: student, original: original, undoEvent: rec };
}

/* 這位學生目前有效的登記筆數（撤銷掉的不算）。 */
function noteCountFor(data, studentId) {
  let n = 0;
  for (const e of data.log) {
    if (e.student_id === studentId && isNote(e) && !e.undone) n++;
  }
  return n;
}

/* 這位學生目前有效的加分筆數。
 * 注意算的是「次數」不是「分數」—— 加 3 分的一筆只算一次。
 * 被復原的加分不算，復原與取消復原本身也不算。 */
function awardCountFor(data, studentId) {
  let n = 0;
  for (const e of data.log) {
    if (e.student_id === studentId && e.delta > 0 && !e.undo_of && !e.undone) n++;
  }
  return n;
}

/* 登記次數超過加分次數 —— 這隻貓會打瞌睡。
 * 這是 cats.js 唯一會去挑睡覺動畫的條件。 */
function isDrowsy(data, studentId) {
  if (!CONFIG.DROWSY_ENABLED) return false;
  return noteCountFor(data, studentId) > awardCountFor(data, studentId);
}

/* =====================================================================
 * 復原
 * =====================================================================
 *
 * 老師會按錯，這是必然。所以復原必須好用、而且要能跨天。
 *
 * 【最重要的規則】紀錄只能追加，永遠不刪。
 * 復原的做法是「再寫一筆相反的紀錄」，並把原本那筆標記成已復原。
 * 學生來問「老師你什麼時候扣我分」的時候，完整的來龍去脈都在檔案裡。
 *
 * 三種紀錄，靠 undo_of 欄位分辨：
 *   加分      delta > 0，沒有 undo_of
 *   復原      delta < 0，undo_of 指向被復原的那筆加分
 *   取消復原  delta > 0，undo_of 指向那筆復原
 *
 * 復原堆疊完全由 log 推導，不另外存狀態，所以關掉網頁重開仍然有效。
 * ===================================================================== */

/* 這筆加分現在可以被復原嗎。 */
function isUndoable(e) {
  return e.delta > 0 && !e.undo_of && !e.undone;
}

/* 最後一筆還沒被復原的加分。找不到就回 null。 */
function lastUndoable(data) {
  for (let i = data.log.length - 1; i >= 0; i--) {
    if (isUndoable(data.log[i])) return data.log[i];
  }
  return null;
}

function eventById(data, id) {
  return data.log.find((e) => e.id === id) || null;
}

/* 復原某一筆加分。
 * 回傳 { ok, reason, student, original, undoEvent, fromLevel, toLevel } */
function undoEvent(data, eventId) {
  const original = eventById(data, eventId);
  if (!original) return { ok: false, reason: 'not-found' };
  if (!isUndoable(original)) return { ok: false, reason: 'not-undoable' };

  const student = studentById(data, original.student_id);
  if (!student) return { ok: false, reason: 'student-missing' };

  const fromLevel = levelFromXp(student.xp);
  student.xp = Math.max(0, student.xp - original.delta);
  const toLevel = levelFromXp(student.xp);

  const rec = {
    id: newEventId(data),
    ts: nowIso(),
    student_id: student.id,
    delta: -original.delta,
    xp_after: student.xp,
    reason: '',
    undone: false,
    undo_of: original.id,
  };
  data.log.push(rec);
  original.undone = true;      // 標記，不是刪除
  data.updated_at = rec.ts;

  return { ok: true, student, original, undoEvent: rec, fromLevel, toLevel };
}

/* 取消剛剛那次復原（老師改變主意）。
 * 同樣是追加一筆，不是把復原紀錄刪掉。 */
function cancelUndo(data, undoEventId) {
  const undoRec = eventById(data, undoEventId);
  if (!undoRec || !undoRec.undo_of || undoRec.undone) {
    return { ok: false, reason: 'not-cancellable' };
  }
  const original = eventById(data, undoRec.undo_of);
  if (!original) return { ok: false, reason: 'original-missing' };

  const student = studentById(data, undoRec.student_id);
  if (!student) return { ok: false, reason: 'student-missing' };

  const amount = -undoRec.delta;   // 復原是負的，取回來就是正的
  const fromLevel = levelFromXp(student.xp);
  student.xp = Math.min(CONFIG.XP_MAX, student.xp + amount);
  const toLevel = levelFromXp(student.xp);

  const rec = {
    id: newEventId(data),
    ts: nowIso(),
    student_id: student.id,
    delta: amount,
    xp_after: student.xp,
    reason: '',
    undone: false,
    undo_of: undoRec.id,
  };
  data.log.push(rec);
  undoRec.undone = true;   // 這次復原被取消了
  original.undone = false; // 原本那筆加分重新生效，之後還能再被復原
  data.updated_at = rec.ts;

  return { ok: true, student, original, cancelEvent: rec, fromLevel, toLevel };
}
