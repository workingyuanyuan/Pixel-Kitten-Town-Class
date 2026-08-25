/* =====================================================================
 * anims.js — 貓 spritesheet 的權威幾何與動畫對照表
 * =====================================================================
 *
 * 這份表是由程式逐格掃描 assets/Free pack/cat 1.png 的透明度得出，
 * 並與素材作者附的 "cat 16x16 with text.png" 標註圖逐列交叉驗證過。
 *
 * 【重要】不要憑印象修改這張表。若要調整，請先用
 *        tools/spritesheet-viewer.html 開圖對格確認。
 *
 * 幾何：
 *   - 檔名寫 16x16 指的是「貓的畫面大小」，不是格子大小。
 *   - 實際 frame cell 是 32x32，圖檔 352x1696 = 11 欄 x 53 列，整除。
 *   - 32px 的格子與 Cainos 地圖 tile 完全對齊：一貓一格。
 *   - 貓的圖形置中偏下於格子內，腳底大約落在格子底部。
 *
 * 所有貓的 sheet（含配件版）排版完全相同，可共用這張表。
 * ===================================================================== */

const CAT_SHEET = {
  FRAME_W: 32,
  FRAME_H: 32,
  COLS: 11,
  ROWS: 53,
};

/* ---------------------------------------------------------------------
 * 動畫定義：名稱 -> { row: 列索引, frames: 該列有效格數, fps: 播放速率 }
 *
 * frames 是掃描出來的實際有效格數，每列不一樣，不要假設等長。
 * fps 是可調的表演參數，不是素材屬性。
 * ------------------------------------------------------------------- */
const CAT_ANIMS = {
  // --- REST 休息（原地，無位移）---
  rest_1:            { row: 0,  frames: 6,  fps: 5 },
  rest_2:            { row: 1,  frames: 8,  fps: 5 },
  rest_3:            { row: 2,  frames: 6,  fps: 4 },
  rest_4:            { row: 3,  frames: 10, fps: 4 },

  // --- WALK 走路（八方向）---
  walk_down:         { row: 4,  frames: 4,  fps: 8 },
  walk_up:           { row: 5,  frames: 4,  fps: 8 },
  walk_right:        { row: 6,  frames: 8,  fps: 10 },
  walk_left:         { row: 7,  frames: 8,  fps: 10 },
  walk_left_down:    { row: 8,  frames: 6,  fps: 9 },
  walk_right_down:   { row: 9,  frames: 6,  fps: 9 },
  walk_right_up:     { row: 10, frames: 6,  fps: 9 },
  walk_left_up:      { row: 11, frames: 6,  fps: 9 },

  // --- SLEEP 睡覺（12-19）---
  // 【條件解鎖】不以分數高低決定是否睡覺 —— 這一段永遠不會出現在
  //             POSE_LADDER 裡。它只在老師實際「登記」了上課睡覺 / 吵鬧等
  //             事由、且登記次數超過加分次數時才會啟用（見 DROWSY_IDLE）。
  //             也就是說，畫面上的瞌睡貓對應的是老師手動留下的佐證，
  //             不是程式拿低分去羞辱學生。
  sleep_1_l:         { row: 12, frames: 2,  fps: 2 },
  sleep_1_r:         { row: 13, frames: 2,  fps: 2 },
  sleep_2_l:         { row: 14, frames: 2,  fps: 2 },
  sleep_2_r:         { row: 15, frames: 2,  fps: 2 },
  sleep_3_l:         { row: 16, frames: 2,  fps: 2 },
  sleep_3_r:         { row: 17, frames: 2,  fps: 2 },
  sleep_4_l:         { row: 18, frames: 2,  fps: 2 },
  sleep_4_r:         { row: 19, frames: 2,  fps: 2 },

  // --- EAT 進食（八方向）---
  eat_down:          { row: 20, frames: 8,  fps: 8 },
  eat_up:            { row: 21, frames: 8,  fps: 8 },
  eat_left:          { row: 22, frames: 8,  fps: 8 },
  eat_right:         { row: 23, frames: 8,  fps: 8 },
  eat_right_down:    { row: 24, frames: 8,  fps: 8 },
  eat_left_down:     { row: 25, frames: 8,  fps: 8 },
  eat_right_up:      { row: 26, frames: 8,  fps: 8 },
  eat_left_up:       { row: 27, frames: 8,  fps: 8 },

  // --- MEOW 喵叫（加分反應用）---
  meow_sit:          { row: 28, frames: 3,  fps: 6 },
  meow_stand:        { row: 29, frames: 3,  fps: 6 },
  meow_sit_2:        { row: 30, frames: 3,  fps: 6 },
  meow_lie:          { row: 31, frames: 3,  fps: 6 },

  // --- YAWN 打呵欠（低等級的閒置小動作）---
  yawn_sit:          { row: 32, frames: 8,  fps: 6 },
  yawn_stand:        { row: 33, frames: 8,  fps: 6 },
  yawn_sit_2:        { row: 34, frames: 8,  fps: 6 },
  yawn_lie:          { row: 35, frames: 8,  fps: 6 },

  // --- WASH 理毛（閒置小動作）---
  wash_sit:          { row: 36, frames: 9,  fps: 8 },
  wash_stand:        { row: 37, frames: 9,  fps: 8 },
  wash_lie:          { row: 38, frames: 7,  fps: 8 },

  // --- SCRATCH 抓癢（閒置小動作）---
  scratch_l:         { row: 39, frames: 11, fps: 10 },
  scratch_r:         { row: 40, frames: 11, fps: 10 },

  // --- HISS 哈氣（41-42）---
  // 【禁用】看起來像生氣 / 敵意，不適合用在學生角色上。
  hiss_l:            { row: 41, frames: 2,  fps: 4 },
  hiss_r:            { row: 42, frames: 2,  fps: 4 },

  // --- 第 43 列：單格「昏倒」圖 ---
  // 【永久禁用】這正是實作計畫第 8 節要防的東西：不做任何死亡 / 淘汰 /
  //             昏厥的視覺表現。任何情況下都不得排進動畫或當作靜態圖。
  //             此處保留條目只是為了讓 viewer 能標示「這一列是什麼」。
  ko:                { row: 43, frames: 1,  fps: 1 },

  // --- PAW ATTACK 揮爪攻擊（44-51）---
  // 【禁用】攻擊語意，與「只獎勵不懲罰」的設計衝突。
  paw_down:          { row: 44, frames: 9,  fps: 10 },
  paw_up:            { row: 45, frames: 5,  fps: 10 },
  paw_left:          { row: 46, frames: 7,  fps: 10 },
  paw_right:         { row: 47, frames: 7,  fps: 10 },
  paw_right_down:    { row: 48, frames: 9,  fps: 10 },
  paw_left_down:     { row: 49, frames: 9,  fps: 10 },
  paw_right_up:      { row: 50, frames: 5,  fps: 10 },
  paw_left_up:       { row: 51, frames: 5,  fps: 10 },

  // --- 用後腳站立（升級 / 高等級的招牌動作）---
  hind_legs:         { row: 52, frames: 4,  fps: 6 },
};

/* ---------------------------------------------------------------------
 * 禁用清單 —— 這是安全設計，不是效能考量。
 *
 * 任何負責挑選動畫的程式（cats.js 的姿勢階梯、閒置動作抽選、
 * 加分與升級表演）都必須先通過 assertAnimAllowed()。
 * 若未來有人「順手」把昏倒或攻擊排進去，這裡會直接擋下並拋錯。
 *
 * 睡覺（12-19 列）已從這份清單移出，但它仍然不是自由使用的動畫：
 * 唯一合法的來源是 config.js 的 DROWSY_IDLE，而那個池子只有在老師
 * 登記次數超過加分次數時才會被 cats.js 的 poseOf() 選用。
 * 絕對不要把睡覺放進 POSE_LADDER。
 * ------------------------------------------------------------------- */
const FORBIDDEN_ANIMS = new Set([
  'hiss_l', 'hiss_r',
  'ko',
  'paw_down', 'paw_up', 'paw_left', 'paw_right',
  'paw_right_down', 'paw_left_down', 'paw_right_up', 'paw_left_up',
]);

function assertAnimAllowed(name) {
  if (!CAT_ANIMS[name]) {
    throw new Error(`未知的動畫名稱：${name}`);
  }
  if (FORBIDDEN_ANIMS.has(name)) {
    throw new Error(
      `動畫「${name}」屬於禁用清單（哈氣 / 昏倒 / 攻擊）。` +
      `這是刻意的安全設計，見實作計畫第 8 節。`
    );
  }
  return CAT_ANIMS[name];
}

/* 八方向走路：方向向量 -> 動畫名稱。dx/dy 各取 -1 / 0 / 1。 */
const WALK_BY_DIR = {
  '0,1':   'walk_down',
  '0,-1':  'walk_up',
  '1,0':   'walk_right',
  '-1,0':  'walk_left',
  '-1,1':  'walk_left_down',
  '1,1':   'walk_right_down',
  '1,-1':  'walk_right_up',
  '-1,-1': 'walk_left_up',
};
