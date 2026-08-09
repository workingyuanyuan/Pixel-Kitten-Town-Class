/* =====================================================================
 * config.js — 老師唯一需要編輯的檔案
 * =====================================================================
 * 這裡的每一項都可以安全修改，改完存檔、重新整理網頁就會生效。
 * 不需要懂程式，照著註解改數字或文字即可。
 *
 * 唯一要注意的規則：
 *   - 數字不要加引號，文字要用單引號包起來
 *   - 每一行結尾的逗號不要刪掉
 * ===================================================================== */

const CONFIG = {

  /* ---------------- 基本 ---------------- */

  // 畫面左上角顯示的標題。留空字串就不顯示。
  TITLE: '像素小鎮',

  // 要載入哪一個班級的資料檔。
  // 程式會讀取 data/<這個名字>.json
  // 以後要帶第二個班，只要複製一份資料檔改名，再把這裡改掉就好。
  CLASS_ID: 'class-data',

  // 還沒拿到真實名單前，先產生幾隻貓（貓的名字會顯示座號 1、2、3…）。
  // 拿到名單、匯入真實學生之後，這個數字就不再有作用。
  PLACEHOLDER_STUDENT_COUNT: 30,


  /* ---------------- 分數與等級 ---------------- */

  // 一學期最多能累積幾分。到頂之後加分按鈕會變灰、不再計分。
  XP_MAX: 30,

  // 幾分升一級。
  XP_PER_LEVEL: 3,

  // 最高等級。等級同時就是學期末要加進平時成績的分數。
  // XP_MAX / XP_PER_LEVEL 應該要等於 MAX_LEVEL，改的時候三個要一起看。
  MAX_LEVEL: 10,

  // 加分按鈕的數值。想要多顆按鈕就填多個數字，例如 [1, 3, 5]。
  AWARD_VALUES: [1],

  // 每一級的稱號。第一項是 0 級（還沒得分）的稱號。
  // 共要有 MAX_LEVEL + 1 項。文字可以隨意改。
  LEVEL_TITLES: [
    '新來的貓',   // Lv 0
    '好奇的貓',   // Lv 1
    '學徒貓',     // Lv 2
    '認真的貓',   // Lv 3
    '熟練的貓',   // Lv 4
    '可靠的貓',   // Lv 5
    '厲害的貓',   // Lv 6
    '資深的貓',   // Lv 7
    '大師貓',     // Lv 8
    '傳說中的貓', // Lv 9
    '小鎮之光',   // Lv 10
  ],

  // 是否在進度條旁顯示數字（例如 7 / 30）。
  // 改成 false 就只看得到長度，看不到確切分數。
  SHOW_XP_NUMBERS: true,


  /* ---------------- 地圖 ---------------- */

  // 地圖大小（格數）。一格是 32 像素。
  // 預設 30 x 16 = 960 x 512 像素，放大兩倍剛好塞進 1920x1080 的投影畫面。
  // 調大的話要注意會不會超出螢幕而被迫縮小、字變看不清楚。
  MAP_COLS: 30,
  MAP_ROWS: 16,

  // 換這個數字就會產生一張完全不同、但同樣合理的地圖。
  // 同一個數字永遠產生一模一樣的地圖。
  MAP_SEED: 20260901,

  // 貓與貓之間至少要隔幾格。隔越多畫面越寬鬆，但能放的學生越少。
  MIN_SPACING: 3,

  // 貓可以離自己的位置走多遠（格）。
  // 設成 0 貓就完全不會移動，只會在原地做動作。
  WANDER_RADIUS: 1,


  /* ---------------- 存檔與備份 ---------------- */

  // 加分後隔幾毫秒才寫檔。連續加分只會寫一次，避免頻繁存取。
  SAVE_DEBOUNCE_MS: 1000,

  // 自動備份保留幾份，更舊的會自動刪掉。
  BACKUP_KEEP_DAYS: 30,
};


/* =====================================================================
 * 以下是程式內部使用的設定，除非你知道自己在做什麼，否則不用改。
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 姿勢階梯 —— 等級決定貓的姿態
 *
 * 設計原則（見實作計畫第 8 節「安全設計」）：
 *   1. 只有正向差異，沒有負向狀態。最低階是「坐著理毛」，看起來自在，
 *      不是沒精神。整條階梯不出現趴臥、睡覺、昏倒。
 *   2. 解鎖要早。Lv 1 就從坐姿變站姿，讓學生第一次升級就看得出來。
 *   3. 每一階都有循環動作，不會有靜止不動的貓。
 *
 * 欄位：
 *   idle       閒置時隨機抽選的動畫（權重相同）
 *   canWalk    是否會在錨點周圍走動
 *   walkChance 每次要換動作時，選擇「走一段」的機率
 *   sparkle    腳邊是否偶爾冒出小星星
 *   crown      頭上是否戴王冠
 * ------------------------------------------------------------------- */
const POSE_LADDER = [
  // Lv 0 —— 坐著。自在，不是頹廢。
  { idle: ['wash_sit', 'yawn_sit'],                     canWalk: false, walkChance: 0,    sparkle: false, crown: false },
  // Lv 1 —— 站起來了。第一次升級最明顯的變化。
  { idle: ['rest_2', 'wash_stand'],                     canWalk: false, walkChance: 0,    sparkle: false, crown: false },
  // Lv 2–3 —— 開始走動。
  { idle: ['rest_2', 'wash_stand', 'yawn_stand'],       canWalk: true,  walkChance: 0.25, sparkle: false, crown: false },
  { idle: ['rest_2', 'wash_stand', 'yawn_stand'],       canWalk: true,  walkChance: 0.35, sparkle: false, crown: false },
  // Lv 4–6 —— 走得更勤，多了抓癢等小動作。
  { idle: ['rest_2', 'wash_stand', 'scratch_r'],        canWalk: true,  walkChance: 0.45, sparkle: false, crown: false },
  { idle: ['rest_2', 'wash_stand', 'scratch_r'],        canWalk: true,  walkChance: 0.50, sparkle: false, crown: false },
  { idle: ['rest_2', 'wash_stand', 'scratch_l'],        canWalk: true,  walkChance: 0.55, sparkle: false, crown: false },
  // Lv 7–9 —— 活潑，腳邊開始冒小星星。
  { idle: ['rest_2', 'scratch_r', 'hind_legs'],         canWalk: true,  walkChance: 0.60, sparkle: true,  crown: false },
  { idle: ['rest_2', 'scratch_l', 'hind_legs'],         canWalk: true,  walkChance: 0.65, sparkle: true,  crown: false },
  { idle: ['rest_2', 'scratch_r', 'hind_legs'],         canWalk: true,  walkChance: 0.70, sparkle: true,  crown: false },
  // Lv 10 —— 滿級。王冠 + 持續微光。
  { idle: ['rest_2', 'hind_legs', 'scratch_l'],         canWalk: true,  walkChance: 0.70, sparkle: true,  crown: true  },
];

/* 加分的即時反應動畫：依當下是坐姿還是站姿挑一個。 */
const AWARD_REACTION = { sitting: 'meow_sit', standing: 'meow_stand' };

/* 升級的招牌動作。 */
const LEVELUP_ANIM = 'hind_legs';

/* 貓的外觀池。依 student.id 雜湊分配，同一個學生永遠是同一隻。
 * 全部 18 個 spritesheet 排版完全相同，可以直接混用。 */
const CAT_SKINS = [
  'assets/Free pack/cat 1.png',
  'assets/Free pack/cat 1.6.png',
  'assets/Free pack/cat 1.9.png',
  'assets/14 feb/cat 1 16x16 animation cupid.png',
  'assets/14 feb/cat 1 16x16 animation nimbus.png',
  'assets/14 feb/cat 1 16x16 animation wings.png',
  'assets/14 feb/cat 1 16x16 animation with blue bow 2.png',
  'assets/14 feb/cat 1 16x16 animation with gold bow.png',
  'assets/14 feb/cat 1 16x16 animation with gold glasses hearts.png',
  'assets/14 feb/cat 1 16x16 animation with green bow 2.png',
  'assets/14 feb/cat 1 16x16 animation with pink bow 2.png',
  'assets/14 feb/cat 1 16x16 animation with pink bow.png',
  'assets/14 feb/cat 1 16x16 animation with red bow.png',
  'assets/14 feb/cat 1 16x16 animation with red glasses hearts.png',
  'assets/Winter accessories/cat 1 16x16 animation with Santa hat 1.png',
  'assets/Winter accessories/cat 1 16x16 animation with Santa hat 2.png',
  'assets/Winter accessories/cat 1 16x16 animation with reindeer antler headband green.png',
  'assets/Winter accessories/cat 1 16x16 animation with reindeer antler headband red.png',
];

/* 地圖素材路徑。 */
const TILE_ASSETS = {
  grass: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Grass.png',
  stone: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Stone Ground.png',
  props: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Props.png',
  plant: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Plant.png',
  shadowPlant: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Shadow Plant.png',
};

/* 一格的像素大小。Cainos 素材是 32px，貓的 frame cell 也是 32px。 */
const TILE_SIZE = 32;

/* 由分數推導等級。這是全專案唯一的等級計算來源。 */
function levelFromXp(xp) {
  const lv = Math.floor(xp / CONFIG.XP_PER_LEVEL);
  return Math.max(0, Math.min(CONFIG.MAX_LEVEL, lv));
}
