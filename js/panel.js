/* =====================================================================
 * panel.js — 角色面板
 * =====================================================================
 *
 * 設計重點（見實作計畫第 7 節）：
 *   - 點貓不會直接加分。必須先開編輯模式，再點貓開面板，再按面板上的
 *     加分鈕。三道手續是刻意的，投影時最怕的就是誤觸。
 *   - 加分按鈕由 CONFIG.AWARD_VALUES 產生。老師之後想要 [1, 3, 5]，
 *     改設定就會多出對應按鈕，不用改程式。
 *   - 滿分後按鈕變灰，不再計分。
 *   - 升級有慶祝，降級沒有懲罰表現。
 * ===================================================================== */

const P = {
  root: null,
  cat: null,          // 目前顯示的貓（null 代表面板關著）
  catCanvas: null,
  cctx: null,
  onAward: null,      // 由 main.js 注入
  levelPop: 0,        // 等級數字彈跳的計時器
  lastLevel: null,
};

function initPanel(handlers) {
  P.root = document.getElementById('panel');
  P.catCanvas = document.getElementById('panel-cat');
  P.cctx = P.catCanvas.getContext('2d');
  P.cctx.imageSmoothingEnabled = false;
  P.onAward = handlers.onAward;
  P.onUndo = handlers.onUndo;

  document.getElementById('panel-close').addEventListener('click', closePanel);

  // 點面板外面就關掉
  document.getElementById('stage-wrap').addEventListener('pointerdown', (e) => {
    if (P.cat && !P.root.contains(e.target)) {
      // 實際的關閉交給 main.js 的點擊處理，這裡只處理「點空白處」
    }
  });
}

function panelIsOpen() {
  return P.cat !== null;
}

function panelCat() {
  return P.cat;
}

function openPanel(cat) {
  P.cat = cat;
  P.lastLevel = levelFromXp(cat.student.xp);
  P.levelPop = 0;
  P.root.hidden = false;
  // 強制重排，讓瀏覽器先套用 hidden=false 的狀態，接著加上 open 才會播滑入動畫。
  // 這裡刻意不用 requestAnimationFrame —— 分頁在背景時 rAF 不會觸發，
  // 面板就會卡在畫面外打不開。
  void P.root.offsetWidth;
  P.root.classList.add('open');
  buildAwardButtons();
  refreshPanel();
}

function closePanel() {
  if (!P.cat) return;
  P.cat = null;
  P.root.classList.remove('open');
  // 等滑出動畫結束再真的藏起來
  setTimeout(() => { if (!P.cat) P.root.hidden = true; }, 220);
}

/* ---------------------------------------------------------------------
 * 加分按鈕：依 CONFIG.AWARD_VALUES 產生，不寫死
 * ------------------------------------------------------------------- */
function buildAwardButtons() {
  const wrap = document.getElementById('panel-awards');
  wrap.innerHTML = '';
  CONFIG.AWARD_VALUES.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'award-btn' + (i === 0 ? ' award-primary' : '');
    b.dataset.value = String(v);
    b.textContent = '＋' + v;
    b.addEventListener('click', () => {
      if (P.cat && P.onAward) P.onAward(P.cat.student.id, v);
    });
    wrap.appendChild(b);
  });
}

/* ---------------------------------------------------------------------
 * 重畫面板上的文字、進度條、紀錄
 * ------------------------------------------------------------------- */
function refreshPanel() {
  if (!P.cat) return;
  const s = P.cat.student;
  const lv = levelFromXp(s.xp);
  const maxed = isMaxed(s);

  // 升級時讓等級數字彈一下。降級（復原造成）不做任何表現，安靜改數字就好。
  if (P.lastLevel !== null && lv > P.lastLevel) P.levelPop = 0.6;
  P.lastLevel = lv;

  document.getElementById('panel-name').textContent =
    s.name && s.name.trim() ? s.name : '座號 ' + s.seat;
  document.getElementById('panel-seat').textContent =
    s.name && s.name.trim() ? '座號 ' + s.seat : '';

  document.getElementById('panel-level').textContent = maxed ? 'MAX' : 'Lv.' + lv;
  document.getElementById('panel-title').textContent = CONFIG.LEVEL_TITLES[lv] || '';

  // 進度條：顯示距離下一級還差多少
  const inLevel = maxed ? CONFIG.XP_PER_LEVEL : s.xp % CONFIG.XP_PER_LEVEL;
  const pct = maxed ? 100 : (inLevel / CONFIG.XP_PER_LEVEL) * 100;
  const fill = document.getElementById('panel-bar-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('maxed', maxed);

  document.getElementById('panel-xp').textContent =
    CONFIG.SHOW_XP_NUMBERS ? `${s.xp} / ${CONFIG.XP_MAX}` : '';
  document.getElementById('panel-next').textContent = maxed
    ? '已達最高等級'
    : `再 ${CONFIG.XP_PER_LEVEL - inLevel} 分升到 Lv.${lv + 1}`;

  // 加分按鈕：滿分、或還沒連接資料夾（唯讀）都要變灰。
  // 唯讀時讓人按下去卻寫不進檔案，比按鈕變灰更糟。
  document.querySelectorAll('#panel-awards .award-btn').forEach((b) => {
    b.disabled = maxed || S.readOnly;
  });
  document.getElementById('panel-maxed-note').hidden = !maxed;
  if (S.readOnly) {
    document.getElementById('panel-maxed-note').hidden = false;
    document.getElementById('panel-maxed-note').textContent = '尚未連接資料夾，目前無法加分。';
  } else if (maxed) {
    document.getElementById('panel-maxed-note').textContent = '已達最高等級，不再累積分數。';
  }

  renderLog(s);
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderLog(student) {
  const ul = document.getElementById('panel-log');
  ul.innerHTML = '';
  const rows = recentLogFor(S.data, student.id, 10);

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'log-empty';
    li.textContent = '還沒有紀錄';
    ul.appendChild(li);
    return;
  }

  for (const e of rows) {
    const li = document.createElement('li');
    li.className = 'log-row' + (e.undone ? ' undone' : '');

    const delta = document.createElement('span');
    delta.className = 'log-delta';
    delta.textContent = (e.delta > 0 ? '＋' : '') + e.delta;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = fmtTime(e.ts);

    li.appendChild(delta);
    li.appendChild(time);

    if (e.undone) {
      const tag = document.createElement('span');
      tag.className = 'log-tag';
      tag.textContent = '已復原';
      li.appendChild(tag);
    } else if (e.undo_of) {
      // 這一筆本身就是復原（或取消復原）的紀錄，不提供再復原
      const tag = document.createElement('span');
      tag.className = 'log-tag';
      tag.textContent = e.delta < 0 ? '復原紀錄' : '取消復原';
      li.appendChild(tag);
    } else if (isUndoable(e) && !S.readOnly) {
      // 針對單筆的復原鈕，用來處理「加錯人」而不是「多加一次」
      const btn = document.createElement('button');
      btn.className = 'log-undo';
      btn.textContent = '復原';
      btn.title = '復原這一筆';
      btn.addEventListener('click', () => { if (P.onUndo) P.onUndo(e.id); });
      li.appendChild(btn);
    }

    ul.appendChild(li);
  }
}

/* ---------------------------------------------------------------------
 * 面板上的大貓
 *
 * 直接沿用地圖上那隻貓的動畫狀態，兩邊的動作才會同步。
 * 4 倍放大，這是面板的視覺主角。
 * ------------------------------------------------------------------- */
function updatePanel(dt) {
  if (!P.cat) return;

  if (P.levelPop > 0) {
    P.levelPop = Math.max(0, P.levelPop - dt);
    const el = document.getElementById('panel-level');
    const p = 1 - P.levelPop / 0.6;
    el.style.transform = `scale(${1 + Math.sin(p * Math.PI) * 0.35})`;
    if (P.levelPop === 0) el.style.transform = '';
  }

  const ctx = P.cctx;
  const size = P.catCanvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  const cat = P.cat;
  const anim = CAT_ANIMS[cat.anim.name];
  if (!anim) return;

  const scale = size / CAT_SHEET.FRAME_W;   // 128 / 32 = 4
  const sx = (cat.anim.frame % anim.frames) * CAT_SHEET.FRAME_W;
  const sy = anim.row * CAT_SHEET.FRAME_H;

  const draw = (img) => {
    if (!img) return;
    if (cat.flip) {
      ctx.save();
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, CAT_SHEET.FRAME_W, CAT_SHEET.FRAME_H, 0, 0, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, CAT_SHEET.FRAME_W, CAT_SHEET.FRAME_H, 0, 0, size, size);
    }
  };

  draw(S.bundle.bases[cat.baseIndex]);
  if (cat.accIndex >= 0) draw(S.bundle.accessories[cat.accIndex]);

  // 滿級的光暈，跟地圖上一致
  if (POSE_LADDER[levelFromXp(cat.student.xp)].crown) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 214, 102, 0.22)');
    g.addColorStop(1, 'rgba(255, 214, 102, 0)');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* 升級時面板上短暫顯示的字樣 */
function flashLevelUp(lv) {
  const el = document.getElementById('panel-levelup');
  el.textContent = `升級！ Lv.${lv}　${CONFIG.LEVEL_TITLES[lv] || ''}`;
  el.classList.remove('show');
  void el.offsetWidth;   // 強制重排，讓動畫可以重播
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}
