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
  TITLE: '貓咪小鎮',

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


  /* ---------------- 登記（不扣分的佐證紀錄） ---------------- */

  // 「登記」是用來留下上課睡覺、吵鬧等事實佐證的。
  // 它只會在紀錄裡多一筆事由，不會動到任何分數。
  // 想關掉這個功能就改成 false，面板上的登記按鈕會消失。
  NOTE_ENABLED: true,

  // 登記事由最多幾個字。
  NOTE_MAX_LEN: 60,

  // 一鍵填入的常用事由。上課時打字很慢，點一下比較快。
  // 想改成自己班的狀況就直接改這串文字。
  NOTE_PRESETS: ['吵鬧', '趴睡', '擅自離座', '遲到'],

  // 當「登記次數」超過「加分次數」時，這位學生的貓會打瞌睡。
  // 這是給老師與學生看的視覺提醒，分數完全不受影響。
  // 不想要這個表現就改成 false。
  DROWSY_ENABLED: true,

  // 每一級的稱號。第一項是 0 級（還沒得分）的稱號。
  // 共要有 MAX_LEVEL + 1 項。文字可以隨意改。
  LEVEL_TITLES: [
    '新來的居民', // Lv 0
    '好奇的居民', // Lv 1
    '小鎮學徒',   // Lv 2
    '認真的居民', // Lv 3
    '熟練的居民', // Lv 4
    '可靠的居民', // Lv 5
    '厲害的居民', // Lv 6
    '資深的居民', // Lv 7
    '小鎮大師',   // Lv 8
    '傳說中的居民', // Lv 9
    '小鎮之光',   // Lv 10
  ],

  // 是否在進度條旁顯示數字（例如 7 / 30）。
  // 改成 false 就只看得到長度，看不到確切分數。
  SHOW_XP_NUMBERS: true,

  // 目前全班分數最高的學生，貓的身後會有金色光環、名字變成金色。
  // 同分的人一起有；全班都還是 0 分時誰都沒有。
  // 不想在畫面上出現這種比較就改成 false。
  TOP_HALO: true,

  // 今日之星：這節課（打開網頁之後）加分最多的學生，貓的頭上會有一顆星星。
  // 只算這次開著網頁時加的分，重新整理或重開網頁就從頭算，
  // 所以每節課每個人都有機會。同分的人一起有；還沒有人加分時誰都沒有。
  TODAY_STAR: true,

  // 全班共同目標：工具列右邊的長條，全班的分數加起來越多就越滿。
  // 長條上的圓圈還沒達到時是灰色，達到之後變彩色。
  //   at   全班滿分的幾成（0.25 = 四分之一）。全班滿分 = 人數 × XP_MAX，
  //        所以人多人少的班級難度一樣。
  //   icon 圓圈裡的圖示
  //   name 滑鼠移上去看到的名稱。可以改成班上約好的獎勵，例如「看一部影片」。
  // 不想要這條就改成 []。
  CLASS_GOAL: [
    { at: 0.1,  icon: '🌱', name: '新芽' },
    { at: 0.25, icon: '🌷', name: '花圃' },
    { at: 0.45, icon: '⛲', name: '噴泉' },
    { at: 0.7,  icon: '🌈', name: '彩虹' },
    { at: 1,    icon: '🎆', name: '煙火' },
  ],


  /* ---------------- 地圖 ---------------- */

  // 地圖大小（格數）。一格是 32 像素。
  //
  // 預設 40 x 22 = 1280 x 704 像素。地圖會放到視窗塞得下的最大尺寸，
  // 在 1080p 全螢幕上大約是 1.4 倍；視窗比例跟地圖不同時，多出來的邊緣補上郊外。
  //
  // 這是一個取捨：地圖大、有高低差與院落，場景比較豐富；代價是貓的圖
  // 比較小。名字與進度條不受影響 —— 它們畫在另一層原生解析度的畫布上，
  // 字級是固定的，不會跟著地圖縮小。
  //
  // 想要貓大一點的話，把這裡改成 30 x 14。
  MAP_COLS: 40,
  MAP_ROWS: 22,

  // 地圖放大的方式。
  //   false：放到塞得下的最大尺寸。不是整數倍時，像素邊緣會稍微柔一點。
  //   true ：只用整數倍（1 倍、2 倍…），每個像素都銳利，但地圖可能比較小，
  //          多出來的地方由郊外補滿。
  PIXEL_PERFECT: false,

  // 換這個數字就會產生一張完全不同、但同樣合理的地圖。
  // 同一個數字永遠產生一模一樣的地圖。
  MAP_SEED: 20260901,

  // 貓與貓之間至少要隔幾格。隔越多畫面越寬鬆，但能放的學生越少。
  MIN_SPACING: 3,

  // 貓可以離自己的位置走多遠（格）。
  // 設成 0 貓就完全不會移動，只會在原地做動作。
  WANDER_RADIUS: 1,


  /* ---------------- 光影與生氣 ---------------- */

  // 陽光、樹影、光束等光影效果。學校電腦跑不動時改成 false。
  // 陰影只落在地面上，不會讓任何一隻貓變暗。
  AMBIENCE: true,

  // 光影強度，0 到 1。投影機在開燈的教室裡看起來偏灰、偏暗時調低。
  LIGHT_STRENGTH: 0.7,

  // 樹梢擺動、蝴蝶、落葉、浮塵、雲影與飛鳥影子。
  // 只想要光影、不要這些會動的小東西就改成 false。
  SCENE_LIFE: true,

  // 天氣：'auto'（自己慢慢變，大部分時間晴天）、'sunny'、'cloudy'、'rain'。
  // 工具列的天氣按鈕也能切換，按過之後會記在這台電腦上，優先於這裡的設定。
  // 下雨時變暗的只有地面，貓不會變暗。
  WEATHER: 'auto',


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
 *   flourish   其他動物閒置時會不會穿插招牌動作（企鵝、鵝拍翅，兔子、青蛙原地跳）
 *
 * 身邊的特效（小芽、愛心、光圈…）另外寫在下面的 LEVEL_FX。
 * ------------------------------------------------------------------- */
const POSE_LADDER = [
  // Lv 0 —— 坐著。自在，不是頹廢。
  { idle: ['wash_sit', 'yawn_sit'],                         canWalk: false, walkChance: 0,    flourish: false },
  // Lv 1 —— 站起來了。第一次升級最明顯的變化。
  { idle: ['rest_2', 'wash_stand'],                         canWalk: false, walkChance: 0,    flourish: false },
  // Lv 2 —— 開始走動。
  { idle: ['rest_2', 'wash_stand', 'yawn_stand'],           canWalk: true,  walkChance: 0.25, flourish: false },
  // Lv 3–6 —— 會用後腳站起來，其他動物也開始拍翅、原地跳。
  { idle: ['rest_2', 'wash_stand', 'hind_legs'],            canWalk: true,  walkChance: 0.35, flourish: true  },
  { idle: ['rest_2', 'wash_stand', 'scratch_r', 'hind_legs'], canWalk: true, walkChance: 0.45, flourish: true },
  { idle: ['rest_2', 'wash_stand', 'scratch_r', 'hind_legs'], canWalk: true, walkChance: 0.50, flourish: true },
  { idle: ['rest_2', 'wash_stand', 'scratch_l', 'hind_legs'], canWalk: true, walkChance: 0.55, flourish: true },
  // Lv 7–10 —— 活潑。
  { idle: ['rest_2', 'scratch_r', 'hind_legs'],             canWalk: true,  walkChance: 0.60, flourish: true  },
  { idle: ['rest_2', 'scratch_l', 'hind_legs'],             canWalk: true,  walkChance: 0.65, flourish: true  },
  { idle: ['rest_2', 'scratch_r', 'hind_legs'],             canWalk: true,  walkChance: 0.70, flourish: true  },
  { idle: ['rest_2', 'hind_legs', 'scratch_l'],             canWalk: true,  walkChance: 0.70, flourish: true  },
];

/* ---------------------------------------------------------------------
 * 等級特效 —— 每升一級就多一樣東西，而且一直留在身邊
 *
 * 沒有只播一次的升級動畫：解鎖之後，這些效果會一直在地圖上（和面板裡）
 * 循環播放，學生隨時抬頭都看得到自己累積了什麼。貓與其他動物都一樣。
 * 畫法在 catfx.js；level 改了，解鎖順序就跟著改。
 *
 * 有幾項是前一項的升級版：
 *   flowers 取代 sprout、notes 讓 hearts 冒得更勤、
 *   butterflies 多一隻蝴蝶、goldStars 讓 stars 變多變金。
 *
 * 腳下只留影子：不在角色正下方畫光圈之類的東西，花園長在兩側。
 *
 * 打瞌睡（見下面的 DROWSY_IDLE）只改變動作，特效全部照樣留著 ——
 * 學生賺到的東西不會因為被登記而收走。
 *
 * 另外兩種光環不看等級：全班最高分（TOP_HALO）與今日之星（TODAY_STAR）。
 * ------------------------------------------------------------------- */
const LEVEL_FX = [
  { level: 1,  key: 'sprout',    label: '家門口冒出小芽' },
  { level: 2,  key: 'hearts',    label: '偶爾冒出愛心' },
  { level: 3,  key: 'flowers',   label: '小芽開花' },
  { level: 4,  key: 'notes',     label: '愛心和音符冒得更勤' },
  { level: 5,  key: 'sunflower', label: '家門口長出向日葵' },
  { level: 6,  key: 'stars',     label: '身邊閃爍的星星' },
  { level: 7,  key: 'butterfly', label: '蝴蝶相伴' },
  { level: 8,  key: 'butterflies', label: '第二隻蝴蝶' },
  { level: 9,  key: 'goldStars', label: '金色星星' },
  { level: 10, key: 'orbit',     label: '環繞的金色光點' },
];

/* ---------------------------------------------------------------------
 * 打瞌睡 —— 唯一合法使用睡覺動畫的地方
 *
 * 【務必看清楚這一段的界線】
 * 睡覺不在 POSE_LADDER 裡，也永遠不會因為分數低而出現。
 * 它只由「老師登記的次數 > 老師加分的次數」這個條件觸發，代表的是
 * 老師手動留下的佐證，不是程式拿分數去評價學生。
 * 只要老師之後多加一次分，條件就不成立，貓立刻恢復正常姿勢。
 *
 * 左右兩種朝向都放進池子，貓才不會全部朝同一邊躺。
 * ------------------------------------------------------------------- */
const DROWSY_IDLE = [
  'sleep_1_l', 'sleep_1_r',
  'sleep_2_l', 'sleep_2_r',
  'sleep_3_l', 'sleep_3_r',
  'sleep_4_l', 'sleep_4_r',
];

/* 登記當下的即時反應：打個呵欠。不用任何負面表現。 */
const NOTE_REACTION = { sitting: 'yawn_sit', standing: 'yawn_stand' };

/* 加分的即時反應動畫：依當下是坐姿還是站姿挑一個。 */
const AWARD_REACTION = { sitting: 'meow_sit', standing: 'meow_stand' };

/* 升級當下的招牌動作。Lv 3 起它也是閒置動作之一，不會只出現這一次。 */
const LEVELUP_ANIM = 'hind_legs';

/* ---------------------------------------------------------------------
 * 貓的外觀 —— 兩個圖層
 *
 * 【重要】素材分成兩種，不要搞混：
 *   CAT_BASES        完整的貓，三種毛色。每張都是整隻貓。
 *   CAT_ACCESSORIES  只有配件本身（蝴蝶結、帽子、翅膀…），
 *                    透明背景，必須疊在基底貓上面畫，單獨畫只會看到
 *                    一個孤零零的蝴蝶結浮在草地上。
 *
 * 兩者的格線與 53 列動畫完全對齊，直接用同一組座標畫兩次即可。
 * 少數配件在某些方向沒有圖（例如背對鏡頭時看不到眼鏡），那一列是空的，
 * 畫出來就是沒戴，這是正確的美術行為。
 *
 * 毛色 3 種 × 配件 15 種 + 不戴配件 = 48 種組合，
 * 依 student.id 雜湊分配，同一個學生永遠是同一隻。
 * ------------------------------------------------------------------- */
const CAT_BASES = [
  'assets/Free pack/cat 1.png',
  'assets/Free pack/cat 1.6.png',
  'assets/Free pack/cat 1.9.png',
];

const CAT_ACCESSORIES = [
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

/* 地圖素材路徑。stone 是實心鋪面，跟草地圖集裡的散落石板是兩回事。 */
const TILE_ASSETS = {
  grass: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Grass.png',
  stone: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Stone Ground.png',
  props: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Props.png',
  wall: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Wall.png',
  struct: 'assets/Pixel Art Top Down - Basic v1.2.3/Texture/TX Struct.png',
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
