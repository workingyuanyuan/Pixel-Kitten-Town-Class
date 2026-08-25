/* =====================================================================
 * cats.js — 貓的位置分配、行為、繪製與命中測試
 * =====================================================================
 *
 * 設計原則（見實作計畫第 6、8 節）：
 *   - 同一個學生每次開啟都在同一位置、同一外觀。位置由 student.id 雜湊
 *     決定，與分數完全無關，不會出現「高分的貓聚在某一區」。
 *   - 貓只在自己的錨點周圍 WANDER_RADIUS 格內徘徊，走遠了會自己回來。
 *   - 姿勢由等級決定，且整條階梯只有正向差異：最低階是坐著理毛，
 *     不出現趴臥、睡覺、昏倒。禁用清單由 anims.js 的 assertAnimAllowed 把關。
 * ===================================================================== */

/* FNV-1a 32 位元雜湊。同一個字串永遠得到同一個數字。 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ---------------------------------------------------------------------
 * 位置分配
 *
 * 每個學生從自己 id 的雜湊算出一個起始候選格，若不合格（被擋住、
 * 離別人太近）就沿著一個同樣由雜湊決定的順序往下找。
 * 全程不使用 Math.random，因此結果完全可重現。
 * ------------------------------------------------------------------- */
function placeCats(students, mapData) {
  const placed = [];
  const cols = mapData.cols;
  const rows = mapData.rows;
  const minDist = CONFIG.MIN_SPACING;

  // 可站立的內部格子清單（固定順序，與雜湊無關）
  const cells = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!mapData.blocked[r][c]) cells.push([c, r]);
    }
  }

  // 依 id 排序，確保分配順序與 students 陣列的排列無關
  const ordered = students.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const s of ordered) {
    const h = hash32(s.id);
    const start = h % cells.length;
    // 步長取一個與 cells.length 互質的奇數，保證能走遍整個清單
    let step = 1 + (h >>> 8) % (cells.length - 1);
    while (gcd(step, cells.length) !== 1) step++;

    let chosen = null;
    let relaxed = minDist;
    // 先用要求的間距試一輪；真的塞不下就逐步放寬，寧可擠一點也不要沒位置
    while (chosen === null && relaxed >= 1) {
      for (let k = 0; k < cells.length; k++) {
        const [c, r] = cells[(start + k * step) % cells.length];
        let ok = true;
        for (const p of placed) {
          if (Math.max(Math.abs(p.col - c), Math.abs(p.row - r)) < relaxed) { ok = false; break; }
        }
        if (ok) { chosen = { col: c, row: r }; break; }
      }
      if (chosen === null) relaxed--;
    }

    if (chosen === null) {
      console.warn(`地圖放不下所有學生，${s.id} 沒有位置。請調大 MAP_COLS / MAP_ROWS 或調小 MIN_SPACING。`);
      chosen = { col: 1, row: 1 };
    }
    if (relaxed < minDist) {
      console.warn(`學生數偏多，間距已從 ${minDist} 放寬到 ${relaxed} 格。建議調大地圖。`);
    }
    placed.push({ id: s.id, col: chosen.col, row: chosen.row });
  }

  const byId = {};
  for (const p of placed) byId[p.id] = p;
  return byId;
}

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }

/* ---------------------------------------------------------------------
 * 建立貓
 * ------------------------------------------------------------------- */
function createCats(students, mapData, bundle) {
  const spots = placeCats(students, mapData);
  const cats = [];

  for (const s of students) {
    const h = hash32(s.id);
    const spot = spots[s.id];
    const cat = {
      student: s,
      anchorCol: spot.col,
      anchorRow: spot.row,
      // 畫面座標（像素，指向該 32x32 格的左上角）
      x: spot.col * TILE_SIZE,
      y: spot.row * TILE_SIZE,
      targetX: spot.col * TILE_SIZE,
      targetY: spot.row * TILE_SIZE,
      // 毛色與配件是兩個獨立的辨識維度，各自從雜湊的不同段取值
      baseIndex: h % CAT_BASES.length,
      // -1 代表不戴配件。讓「沒有配件」也佔一個名額，畫面才不會人人都掛東西。
      accIndex: ((h >>> 5) % (CAT_ACCESSORIES.length + 1)) - 1,
      // 原地動畫用的固定朝向。走路動畫本身有八方向，播放期間會暫時關閉翻轉。
      baseFlip: ((h >>> 16) & 1) === 1,
      flip: ((h >>> 16) & 1) === 1,
      anim: null,
      mode: 'idle',
      timer: 0.5 + ((h >>> 4) % 30) / 10,  // 錯開每隻貓的第一次換動作時間
      rng: mulberry32(h),
      // 表演用的計時器
      awardFx: 0,
      levelFx: 0,
      // 由 main.js 的 refreshDrowsy() 維護，見 poseOf()
      drowsy: false,
      floats: [],           // 飄字 { text, t }
      barShown: 0,          // 進度條顯示值，用來做緩動
    };
    cat.anim = makeAnimState(pickIdle(cat));
    cat.barShown = xpProgress(s.xp);
    cats.push(cat);
  }
  return cats;
}

/* 目前等級對應的姿勢設定。
 *
 * 唯一的例外是打瞌睡：當老師的登記次數超過加分次數時（cat.drowsy 由
 * main.js 的 refreshDrowsy() 依 model.js 的 isDrowsy() 設定），改用睡覺
 * 動畫池，並停止走動。這與分數高低無關 —— 分數再低也不會自己睡著，
 * 必須是老師實際登記過才會。滿級光環等等仍沿用原本等級的設定。 */
function poseOf(cat) {
  const base = POSE_LADDER[levelFromXp(cat.student.xp)];
  if (!cat.drowsy) return base;
  return {
    idle: DROWSY_IDLE,
    canWalk: false,
    walkChance: 0,
    sparkle: false,
    crown: base.crown,
  };
}

/* 從該等級的閒置動畫池裡抽一個。 */
function pickIdle(cat) {
  const pool = poseOf(cat).idle;
  return pool[Math.floor(cat.rng() * pool.length)];
}

/* 這隻貓現在是坐著還是站著？決定加分時要播哪一種喵叫。 */
function isSitting(cat) {
  return cat.anim && cat.anim.name.indexOf('_sit') !== -1;
}

/* 距離下一級的進度，0..1。滿級固定回 1。 */
function xpProgress(xp) {
  if (levelFromXp(xp) >= CONFIG.MAX_LEVEL) return 1;
  return (xp % CONFIG.XP_PER_LEVEL) / CONFIG.XP_PER_LEVEL;
}

/* ---------------------------------------------------------------------
 * 更新
 * ------------------------------------------------------------------- */
function updateCats(cats, dt, mapData) {
  for (const cat of cats) {
    updateAnim(cat.anim, dt);

    // 表演計時器
    if (cat.awardFx > 0) cat.awardFx = Math.max(0, cat.awardFx - dt);
    if (cat.levelFx > 0) cat.levelFx = Math.max(0, cat.levelFx - dt);
    for (let i = cat.floats.length - 1; i >= 0; i--) {
      cat.floats[i].t += dt;
      if (cat.floats[i].t > 1.2) cat.floats.splice(i, 1);
    }

    // 進度條緩動（約 0.6 秒追上目標值）
    const target = xpProgress(cat.student.xp);
    cat.barShown += (target - cat.barShown) * Math.min(1, dt / 0.6 * 2.5);

    if (cat.mode === 'walk') {
      const speed = 14; // 像素／秒，刻意很慢，不要看起來像在趕路
      const dx = cat.targetX - cat.x;
      const dy = cat.targetY - cat.y;
      const dist = Math.hypot(dx, dy);
      if (dist < speed * dt) {
        cat.x = cat.targetX;
        cat.y = cat.targetY;
        enterIdle(cat);
      } else {
        cat.x += (dx / dist) * speed * dt;
        cat.y += (dy / dist) * speed * dt;
      }
      continue;
    }

    cat.timer -= dt;
    if (cat.timer > 0) continue;

    const pose = poseOf(cat);
    if (pose.canWalk && cat.rng() < pose.walkChance) {
      startWalk(cat, mapData);
    } else {
      enterIdle(cat);
    }
  }
}

function enterIdle(cat) {
  cat.mode = 'idle';
  cat.flip = cat.baseFlip;   // 走完路要把原本的朝向還回來
  setAnim(cat.anim, pickIdle(cat));
  cat.timer = 2 + cat.rng() * 4;
}

function startWalk(cat, mapData) {
  const R = CONFIG.WANDER_RADIUS;
  if (R <= 0) { enterIdle(cat); return; }

  // 在錨點周圍隨機挑一格，必須可站立
  for (let attempt = 0; attempt < 8; attempt++) {
    const dc = Math.floor(cat.rng() * (R * 2 + 1)) - R;
    const dr = Math.floor(cat.rng() * (R * 2 + 1)) - R;
    const c = cat.anchorCol + dc;
    const r = cat.anchorRow + dr;
    if (c < 1 || r < 1 || c >= mapData.cols - 1 || r >= mapData.rows - 1) continue;
    if (mapData.blocked[r][c]) continue;
    if (c * TILE_SIZE === cat.x && r * TILE_SIZE === cat.y) continue;

    cat.targetX = c * TILE_SIZE;
    cat.targetY = r * TILE_SIZE;
    const sx = Math.sign(cat.targetX - cat.x);
    const sy = Math.sign(cat.targetY - cat.y);
    const animName = WALK_BY_DIR[`${sx},${sy}`];
    if (!animName) continue;
    setAnim(cat.anim, animName);
    cat.flip = false; // 走路動畫本身已有八方向，翻轉會讓朝向錯亂
    cat.mode = 'walk';
    return;
  }
  enterIdle(cat);
}

/* ---------------------------------------------------------------------
 * 加分與升級的表演
 * ------------------------------------------------------------------- */
function playAward(cat, delta) {
  cat.awardFx = 0.6;
  cat.floats.push({ text: `+${delta}`, t: 0 });
  cat.mode = 'idle';
  setAnim(cat.anim, isSitting(cat) ? AWARD_REACTION.sitting : AWARD_REACTION.standing);
  cat.timer = 0.8;
}

/* 登記當下的表演：打個呵欠，沒有任何負面表現，也沒有飄字。
 * 登記不扣分，所以畫面上不該出現任何像是被扣分的東西。 */
function playNote(cat) {
  cat.mode = 'idle';
  setAnim(cat.anim, isSitting(cat) ? NOTE_REACTION.sitting : NOTE_REACTION.standing);
  cat.timer = 1.2;
}

function playLevelUp(cat) {
  cat.levelFx = 2.0;
  setAnim(cat.anim, LEVELUP_ANIM);
  cat.timer = 1.2;
}

/* ---------------------------------------------------------------------
 * 繪製（像素層）
 *
 * 依貓所在的列呼叫，好讓貓與樹、灌木正確地互相遮擋。
 * ------------------------------------------------------------------- */
function drawCatsInRow(ctx, cats, bundle, row) {
  for (const cat of cats) {
    if (Math.floor(cat.y / TILE_SIZE) !== row) continue;

    const base = bundle.bases[cat.baseIndex];
    let dy = cat.y;

    // 加分時輕輕跳一下
    if (cat.awardFx > 0) {
      const p = 1 - cat.awardFx / 0.6;
      dy -= Math.sin(p * Math.PI) * 4;
    }

    if (!base) {
      // 素材缺失時畫佔位方塊，不要靜默失敗
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(cat.x + 8, dy + 8, 16, 16);
      continue;
    }

    const dx = Math.round(cat.x);
    const dyr = Math.round(dy);

    // 先畫整隻貓，再把配件疊上去。順序不能反。
    drawCatFrame(ctx, base, cat.anim, dx, dyr, cat.flip);

    if (cat.accIndex >= 0) {
      const acc = bundle.accessories[cat.accIndex];
      if (acc) drawCatFrame(ctx, acc, cat.anim, dx, dyr, cat.flip);
    }
  }
}

/* ---------------------------------------------------------------------
 * 繪製（高解析 UI 層）
 *
 * 名字、進度條、等級都畫在這一層。這一層是原生解析度、不做像素放大，
 * 所以中文字在投影機上才看得清楚。
 * scale 是像素層的放大倍率。
 * ------------------------------------------------------------------- */
function drawCatLabels(lctx, cats, scale) {
  /* 【重要】字級與進度條大小不跟著地圖縮放走。
   *
   * 標籤畫在原生解析度的那一層畫布上，如果字級乘上地圖倍率，地圖一放大
   * （倍率 1x）中文字就會縮到 9px，投影到教室後排完全看不見。
   * 地圖可以縮小換取更大的場景，但名字必須始終看得清楚 —— 那是這個
   * 工具存在的理由。 */
  const ui = Math.max(2, scale);
  const nameSize = Math.round(9 * ui);
  const lvSize = Math.round(6.5 * ui);
  const barW = 22 * ui;
  const barH = 4 * ui;

  lctx.textBaseline = 'alphabetic';
  lctx.lineJoin = 'round';

  for (const cat of cats) {
    const s = cat.student;
    const lv = levelFromXp(s.xp);
    const pose = POSE_LADDER[lv];
    const cx = (cat.x + TILE_SIZE / 2) * scale;
    const top = cat.y * scale;                  // 貓所在格子的上緣
    const mid = top + (TILE_SIZE / 2) * scale;  // 格子中心，光環以此為圓心

    // 編輯模式下滑鼠移過來時的高亮。刻意做得很輕，只是提示「這隻可以點」。
    if (cat.hovered) {
      lctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      lctx.beginPath();
      lctx.ellipse(cx, mid + 8 * scale, 15 * ui, 7 * ui, 0, 0, Math.PI * 2);
      lctx.fill();
      lctx.strokeStyle = 'rgba(123, 216, 143, 0.85)';
      lctx.lineWidth = Math.max(2, ui);
      lctx.stroke();
    }

    /* 整個標籤堆疊都排在格子上緣「之外」，絕不覆蓋貓本身：
     *   姓名 + 等級（同一行）
     *   進度條
     *   ── 格子上緣 ──
     *   貓
     */
    const barBottom = top - 3 * ui;
    const barY = barBottom - barH;
    const nameY = barY - 3 * ui;

    // --- 滿級光環（畫在最底層）---
    if (pose.crown) {
      const r = 20 * ui;
      const g = lctx.createRadialGradient(cx, mid, 0, cx, mid, r);
      g.addColorStop(0, 'rgba(255, 214, 102, 0.32)');
      g.addColorStop(1, 'rgba(255, 214, 102, 0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(cx, mid, r, 0, Math.PI * 2);
      lctx.fill();
    }

    // --- 升級光暈 ---
    if (cat.levelFx > 0) {
      const p = 1 - cat.levelFx / 2.0;
      lctx.strokeStyle = `rgba(255, 236, 160, ${(1 - p) * 0.9})`;
      lctx.lineWidth = 3 * ui * (1 - p) + 1;
      lctx.beginPath();
      lctx.arc(cx, mid, (10 + p * 26) * ui, 0, Math.PI * 2);
      lctx.stroke();
    }

    // --- 姓名 + 等級，排成一行並整體置中 ---
    // 沒有姓名時顯示座號，這是拿到真實名單之前的正常狀態。
    const nameText = s.name && s.name.trim() ? s.name : String(s.seat);
    const lvText = lv >= CONFIG.MAX_LEVEL ? 'MAX' : `Lv.${lv}`;

    const nameFont = `600 ${nameSize}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif`;
    const lvFont = `600 ${lvSize}px system-ui, sans-serif`;
    const gap = 5 * ui;

    lctx.font = nameFont;
    const nameW = lctx.measureText(nameText).width;
    lctx.font = lvFont;
    const lvW = lctx.measureText(lvText).width;

    const totalW = nameW + gap + lvW;
    let penX = cx - totalW / 2;

    lctx.textAlign = 'left';

    lctx.font = nameFont;
    lctx.strokeStyle = 'rgba(24, 20, 28, 0.92)';
    lctx.lineWidth = Math.max(3, nameSize * 0.34);
    lctx.strokeText(nameText, penX, nameY);
    lctx.fillStyle = pose.crown ? '#ffd666' : '#ffffff';
    lctx.fillText(nameText, penX, nameY);
    penX += nameW + gap;

    lctx.font = lvFont;
    lctx.lineWidth = Math.max(2, lvSize * 0.34);
    lctx.strokeText(lvText, penX, nameY);
    lctx.fillStyle = lv >= CONFIG.MAX_LEVEL ? '#ffd666' : 'rgba(255, 255, 255, 0.78)';
    lctx.fillText(lvText, penX, nameY);

    // --- 進度條 ---
    const bx = cx - barW / 2;

    lctx.fillStyle = 'rgba(24, 20, 28, 0.78)';
    lctx.fillRect(bx - ui, barY - ui, barW + ui * 2, barH + ui * 2);

    lctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    lctx.fillRect(bx, barY, barW, barH);

    // 條的顏色固定，不隨分數變化：避免在姿勢之外再加一條互相比較的視覺通道。
    // 也絕不使用紅色（見實作計畫第 8 節）。
    lctx.fillStyle = lv >= CONFIG.MAX_LEVEL ? '#ffd666' : '#7bd88f';
    lctx.fillRect(bx, barY, barW * Math.max(0, Math.min(1, cat.barShown)), barH);

    // --- 加分飄字 ---
    lctx.textAlign = 'center';
    for (const f of cat.floats) {
      const p = f.t / 1.2;
      const fy = nameY - 6 * ui - p * 16 * ui;
      lctx.globalAlpha = 1 - p;
      lctx.font = `700 ${Math.round(11 * ui)}px system-ui, sans-serif`;
      lctx.strokeStyle = 'rgba(24, 20, 28, 0.9)';
      lctx.lineWidth = 4;
      lctx.strokeText(f.text, cx, fy);
      lctx.fillStyle = '#ffe98a';
      lctx.fillText(f.text, cx, fy);
      lctx.globalAlpha = 1;
    }
  }
}

/* ---------------------------------------------------------------------
 * 命中測試
 *
 * 貓的圖形只有 16px 左右，直接用圖形範圍當點擊目標太難點。
 * 這裡用整格 32x32 當命中框，並在重疊時取最靠下（視覺上最前面）的那隻。
 * ------------------------------------------------------------------- */
function catAt(cats, mapX, mapY) {
  let best = null;
  for (const cat of cats) {
    if (mapX >= cat.x && mapX < cat.x + TILE_SIZE &&
        mapY >= cat.y && mapY < cat.y + TILE_SIZE) {
      if (!best || cat.y > best.y) best = cat;
    }
  }
  return best;
}
