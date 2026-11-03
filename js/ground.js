/* =====================================================================
 * ground.js — 程式繪製的草地與小路
 * =====================================================================
 *
 * 【為什麼不用原本的草地圖塊】
 * Cainos 的草地是一整片單色（#72751b），重複鋪滿 880 格，遠看像一張綠紙。
 * 這裡改用程式一個像素一個像素畫：深淺不一的草色斑塊、草葉、苜蓿、
 * 小花、會隨風擺動的草叢；小路是踩實的泥土，有碎石、踏腳石、貓腳印，
 * 邊緣不規則，草會長進路面一點點。
 *
 * 【存檔格式沒變】
 * 每一格還是記成原本的 Cainos 地磚（例如 grass:0,4），這裡只是換一種畫法：
 *   草地 / 草叢地 / 花草地   草、草叢多、花多
 *   石板(密 / 中 / 疏)        小路的「路心 / 路緣 / 草裡的踏腳石」
 *   水                         底下照樣畫草，water.js 再把水疊上去
 *   石地板與其他               直接貼原本的圖塊
 * 路的邊界不是照格子切的：每格有一個「路的濃度」，在格子之間平滑內插，
 * 再加上雜訊，所以路緣是自然的曲線。
 *
 * 【只重畫改到的地方】
 * 整張地面算好存在離屏畫布上。每一格比對一次每格的材質，地圖編輯器塗了
 * 哪幾格，就只重算那幾格和周圍一圈（路的濃度會影響到隔壁格）。
 * 所有細節都由「像素座標的雜湊值」決定，局部重算跟整張重算的結果一模一樣。
 *
 * 陽光從左上來（跟 ambience.js 一致）：草葉的亮面朝左上，小路北側的
 * 草緣在路面投下一道暗邊，南側的路面則被照亮。
 * ===================================================================== */

const GROUND_COLORS = {
  // 草色由暗到亮五階，冷暖兩組依大範圍雜訊混合。中間那階就是 Cainos 的草色。
  grassCool: ['#59631a', '#636e1d', '#6e7821', '#7a8427', '#86902f'],
  grassWarm: ['#5e5e14', '#6a6a17', '#77751c', '#838122', '#8f8c2a'],
  blade: '#91932d',
  bladeDark: '#4e5512',
  clover: '#5b6c1f',
  cloverLight: '#7b8c2d',
  flowerShadow: '#4b5212',
  flowers: [
    ['#e4dfca', '#d8b946'],   // 白花黃心
    ['#d8b946', '#f0dc84'],   // 黃花
    ['#d99aae', '#f3d0d6'],   // 粉花
    ['#a9bddb', '#e4ecf4'],   // 藍花
  ],
  // 小路由暗到亮：路緣暗邊、暗、底色、亮、受光的南緣
  path: ['#5e4d30', '#776443', '#8a7650', '#988560', '#a8956e'],
  pebble: '#b2ad9d',
  pebbleDark: '#77725f',
  slab: '#8f8c7e',
  slabLight: '#a6a396',
  slabDark: '#625d4e',
  moss: '#6d7a24',
  paw: '#72603e',
  puddle: '#7f8c8c',
  puddleEdge: '#5d6663',
  puddleLight: '#b9c4c2',
  tuft: ['#4e5512', '#6c731c', '#93952f'],
};

/* 地面的材質代碼。'g' 草地、't' 草叢地、'f' 花草地、'p' 路心、'm' 路緣、
 * 'e' 草裡的踏腳石、'w' 水、'x' 直接貼圖塊（石地板等） */
const GROUND_MATERIAL_WEIGHT = { p: 1, m: 0.45, e: 0.16 };

/* 像素的分類，供路緣、細節判斷 */
const CLS_GRASS = 0, CLS_PATH = 1, CLS_TILE = 2;

const GROUND = {
  canvas: null,     // 整張地面
  img: null,        // 同一張的 ImageData，局部重算時改它再貼回去
  cls: null,        // Uint8Array：每個像素是草、路還是圖塊
  wet: null,        // 下雨時要變暗的部分（路面比草地暗得多）
  puddles: null,    // 雨後路面的水窪
  puddleSpots: [],  // 水窪中心，下雨時在這裡冒漣漪
  tufts: [],        // 會隨風擺動的草叢
  tuftSheet: null,
  mats: null,       // 上次畫的時候每一格的材質
  weights: null,    // 每一格「路的濃度」
  cols: 0, rows: 0, W: 0, H: 0,
  tileData: {},     // 圖塊來源圖的像素
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* 材質對照表：Cainos 草地圖集是 8x8 格，用 欄*8+列 查 */
const GRASS_MATERIAL = (() => {
  const t = new Array(64).fill('g');
  const mark = (list, m) => { for (const [x, y] of list) t[x * 8 + y] = m; };
  mark(GRASS.TUFT, 't');
  mark(GRASS.FLOWER, 'f');
  mark(GRASS.BLEND_DENSE, 'p');
  mark(GRASS.BLEND_MEDIUM, 'm');
  mark(GRASS.BLEND_SPARSE, 'e');
  return t;
})();

function groundMaterialOf(g) {
  if (!g) return 'g';
  if (g.sheet === 'water') return 'w';
  if (g.sheet !== 'grass') return 'x';
  const [x, y] = g.src;
  return (x >= 0 && x < 8 && y >= 0 && y < 8) ? GRASS_MATERIAL[x * 8 + y] : 'g';
}

/* ---------------------------------------------------------------------
 * 進入點
 * ------------------------------------------------------------------- */
function drawProceduralGround(ctx, map, images) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ensureGround(map, images, W, H);
  ctx.drawImage(GROUND.canvas, 0, 0);
}

function ensureGround(map, images, W, H) {
  const n = map.cols * map.rows;
  const mats = new Array(n);
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) mats[r * map.cols + c] = groundMaterialOf(map.ground[r][c]);
  }

  const sameSize = GROUND.canvas && GROUND.W === W && GROUND.H === H &&
    GROUND.cols === map.cols && GROUND.rows === map.rows;
  if (!sameSize) {
    buildGround(map, images, mats, W, H);
    return;
  }

  // 石地板等圖塊的格子要比對 src，換了另一塊石板也要重畫
  const dirty = [];
  for (let i = 0; i < n; i++) {
    if (mats[i] !== GROUND.mats[i]) { dirty.push(i); continue; }
    if (mats[i] === 'x') {
      const g = map.ground[Math.floor(i / map.cols)][i % map.cols];
      const k = `${g.sheet}:${g.src[0]},${g.src[1]}`;
      if (GROUND.tileKeys[i] !== k) dirty.push(i);
    }
  }
  if (!dirty.length) return;
  if (dirty.length > 40) { buildGround(map, images, mats, W, H); return; }

  GROUND.mats = mats;
  setGroundWeights(map, mats);
  const T = TILE_SIZE;
  for (const i of dirty) {
    const c = i % map.cols, r = Math.floor(i / map.cols);
    renderGroundRect(map, images, (c - 1) * T - 4, (r - 1) * T - 4, (c + 2) * T + 4, (r + 2) * T + 4);
  }
  buildTufts(map);
}

function buildGround(map, images, mats, W, H) {
  GROUND.W = W; GROUND.H = H;
  GROUND.cols = map.cols; GROUND.rows = map.rows;
  GROUND.mats = mats;
  GROUND.tileKeys = new Array(map.cols * map.rows);
  GROUND.canvas = makeGroundCanvas(W, H);
  GROUND.img = GROUND.canvas.getContext('2d').createImageData(W, H);
  GROUND.cls = new Uint8Array(W * H);
  GROUND.wet = makeGroundCanvas(W, H);
  GROUND.wetImg = GROUND.wet.getContext('2d').createImageData(W, H);
  GROUND.puddles = makeGroundCanvas(W, H);
  if (!GROUND.tuftSheet) GROUND.tuftSheet = buildTuftSheet();
  setGroundWeights(map, mats);
  renderGroundRect(map, images, 0, 0, W, H);
  buildTufts(map);
}

function makeGroundCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function setGroundWeights(map, mats) {
  const w = new Float32Array(map.cols * map.rows);
  for (let i = 0; i < w.length; i++) w[i] = GROUND_MATERIAL_WEIGHT[mats[i]] || 0;
  GROUND.weights = w;
}

/* 像素 (x, y) 的「路的濃度」：四個最近的格子中心平滑內插 */
function pathField(x, y) {
  const T = TILE_SIZE, cols = GROUND.cols, rows = GROUND.rows, w = GROUND.weights;
  const u = (x + 0.5) / T - 0.5, v = (y + 0.5) / T - 0.5;
  const c0 = Math.floor(u), r0 = Math.floor(v);
  let fx = u - c0, fy = v - r0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const at = (c, r) => w[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
  const a = at(c0, r0) + (at(c0 + 1, r0) - at(c0, r0)) * fx;
  const b = at(c0, r0 + 1) + (at(c0 + 1, r0 + 1) - at(c0, r0 + 1)) * fx;
  return a + (b - a) * fy;
}

/* ---------------------------------------------------------------------
 * 畫一塊矩形範圍（像素座標，含左上、不含右下）
 * ------------------------------------------------------------------- */
function renderGroundRect(map, images, x0, y0, x1, y1) {
  const W = GROUND.W, H = GROUND.H, T = TILE_SIZE;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(W, x1); y1 = Math.min(H, y1);
  if (x1 <= x0 || y1 <= y0) return;

  const data = GROUND.img.data, cls = GROUND.cls, wet = GROUND.wetImg.data;
  const cool = GROUND_COLORS.grassCool.map(hexRgb), warm = GROUND_COLORS.grassWarm.map(hexRgb);
  const pathCols = GROUND_COLORS.path.map(hexRgb);

  // 1. 底色與分類（多算一圈，路緣判斷要看上下左右的像素）
  const ex0 = Math.max(0, x0 - 2), ey0 = Math.max(0, y0 - 2);
  const ex1 = Math.min(W, x1 + 2), ey1 = Math.min(H, y1 + 2);
  for (let y = ey0; y < ey1; y++) {
    const r = Math.floor(y / T);
    for (let x = ex0; x < ex1; x++) {
      const c = Math.floor(x / T);
      // 畫布比地圖大（例如讀進一張比較小的地圖）時，地圖外面當草地
      const m = (c < GROUND.cols && r < GROUND.rows) ? GROUND.mats[r * GROUND.cols + c] : 'g';
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      let isPath = false;
      if (m !== 'w') {
        const f = pathField(x, y);
        if (f > 0.2) {
          const thr = 0.5 + (valueNoise(x, y, 9) - 0.5) * 0.3 + (valueNoise(x + 31, y + 17, 3) - 0.5) * 0.12;
          const d = f - thr;
          // 路緣內側零星留幾根草，草像是長進路面
          isPath = d > 0 && !(d < 0.035 && pixelHash(x, y) % 4 === 0);
        }
      }
      if (m === 'x') isPath = false;
      cls[y * W + x] = m === 'x' ? CLS_TILE : (isPath ? CLS_PATH : CLS_GRASS);
      if (!inside) continue;

      const b = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * 0.06;
      let rgb;
      if (isPath) {
        const v = valueNoise(x, y, 18) * 0.6 + valueNoise(x + 7, y + 3, 5) * 0.4 + b;
        const h = pixelHash(x, y);
        let k = v < 0.36 ? 1 : (v < 0.68 ? 2 : 3);
        if (h % 37 === 0) k = 1;              // 土裡的小黑點
        else if (h % 43 === 0) k = 4;         // 亮的砂粒
        rgb = pathCols[k];
      } else {
        // 大片的明暗只是若有似無，細碎的變化多一點，才不會像迷彩
        const v = valueNoise(x, y, 64) * 0.35 + valueNoise(x + 101, y + 7, 14) * 0.35 +
          valueNoise(x + 3, y + 59, 4) * 0.3 + b;
        const k = v < 0.24 ? 0 : (v < 0.37 ? 1 : (v < 0.63 ? 2 : (v < 0.75 ? 3 : 4)));
        const hue = valueNoise(x + 500, y + 300, 90);
        const a = cool[k], z = warm[k];
        rgb = [a[0] + (z[0] - a[0]) * hue, a[1] + (z[1] - a[1]) * hue, a[2] + (z[2] - a[2]) * hue];
      }
      const i = (y * W + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
      // 下雨時：路面濕了暗很多，草地只暗一點
      const wv = isPath ? 168 : 224;
      wet[i] = wv; wet[i + 1] = wv + 4; wet[i + 2] = wv + 10; wet[i + 3] = 255;
    }
  }

  const inRect = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const put = (x, y, rgb) => {
    if (!inRect(x, y)) return;
    const i = (y * W + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
  };
  const clsAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? CLS_GRASS : cls[y * W + x];

  // 2. 路緣：北側的草在路面投下暗邊，南側的路面受光，草緣亮一階
  const grassEdge = hexRgb(GROUND_COLORS.blade);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = cls[y * W + x];
      if (k === CLS_PATH) {
        if (clsAt(x, y - 1) === CLS_GRASS) put(x, y, pathCols[0]);
        else if (clsAt(x, y - 2) === CLS_GRASS || clsAt(x - 1, y - 1) === CLS_GRASS) put(x, y, pathCols[1]);
        else if (clsAt(x, y + 1) === CLS_GRASS) put(x, y, pathCols[4]);
      } else if (k === CLS_GRASS && clsAt(x, y + 1) === CLS_PATH && pixelHash(x, y) % 3) {
        put(x, y, grassEdge);
      }
    }
  }

  // 3. 圖塊（石地板等）照原樣貼上
  const T0 = Math.floor(y0 / T), T1 = Math.min(GROUND.rows, Math.ceil(y1 / T));
  const C0 = Math.floor(x0 / T), C1 = Math.min(GROUND.cols, Math.ceil(x1 / T));
  for (let r = T0; r < T1; r++) {
    for (let c = C0; c < C1; c++) {
      const idx = r * GROUND.cols + c;
      if (GROUND.mats[idx] !== 'x') continue;
      const g = map.ground[r][c];
      GROUND.tileKeys[idx] = `${g.sheet}:${g.src[0]},${g.src[1]}`;
      const src = tilePixels(images, g.sheet);
      for (let y = r * T; y < (r + 1) * T; y++) {
        for (let x = c * T; x < (c + 1) * T; x++) {
          if (!inRect(x, y)) continue;
          const i = (y * W + x) * 4;
          if (src) {
            const sx = g.src[0] * T + (x - c * T), sy = g.src[1] * T + (y - r * T);
            if (sx < src.width && sy < src.height) {
              const j = (sy * src.width + sx) * 4;
              data[i] = src.data[j]; data[i + 1] = src.data[j + 1]; data[i + 2] = src.data[j + 2];
              continue;
            }
          }
          data[i] = 0x87; data[i + 1] = 0x85; data[i + 2] = 0x79;
        }
      }
    }
  }

  // 4. 細節：每一格各自用固定的亂數撒草葉、花、碎石……
  //    周圍一圈的格子也要算，它們的草葉可能伸進這個範圍
  const pctx = GROUND.puddles.getContext('2d');
  pctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  GROUND.puddleSpots = GROUND.puddleSpots.filter((p) => !inRect(p[0], p[1]));
  for (let r = Math.max(0, T0 - 1); r < Math.min(GROUND.rows, T1 + 1); r++) {
    for (let c = Math.max(0, C0 - 1); c < Math.min(GROUND.cols, C1 + 1); c++) {
      stampCell(c, r, put, clsAt, pctx, inRect);
    }
  }

  const gctx = GROUND.canvas.getContext('2d');
  gctx.putImageData(GROUND.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  GROUND.wet.getContext('2d').putImageData(GROUND.wetImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
}

function tilePixels(images, sheet) {
  if (sheet in GROUND.tileData) return GROUND.tileData[sheet];
  const img = images[sheet];
  let d = null;
  if (img && img.width) {
    const c = makeGroundCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    d = ctx.getImageData(0, 0, img.width, img.height);
  }
  GROUND.tileData[sheet] = d;
  return d;
}

/* ---------------------------------------------------------------------
 * 一格的細節
 * ------------------------------------------------------------------- */
function stampCell(c, r, put, clsAt, pctx, inRect) {
  const T = TILE_SIZE, C = GROUND_COLORS;
  const m = GROUND.mats[r * GROUND.cols + c];
  if (m === 'w' || m === 'x') return;
  const rand = mulberry32(pixelHash(c * 7 + 3, r * 13 + 5));
  const rx = () => c * T + Math.floor(rand() * T);
  const ry = () => r * T + Math.floor(rand() * T);
  const grass = (x, y) => clsAt(x, y) === CLS_GRASS;
  const path = (x, y) => clsAt(x, y) === CLS_PATH;

  const blade = hexRgb(C.blade), dark = hexRgb(C.bladeDark);

  // 草葉：亮的葉尖朝上，底下一點暗
  const blades = m === 't' ? 34 : (m === 'f' ? 22 : 26);
  for (let i = 0; i < blades; i++) {
    const x = rx(), y = ry();
    if (!grass(x, y)) continue;
    const kind = rand();
    if (kind < 0.45) {
      put(x, y, blade); if (grass(x, y + 1)) put(x, y + 1, dark);
    } else if (kind < 0.8) {
      put(x, y, blade);
      if (grass(x - 1, y + 1)) put(x - 1, y + 1, dark);
      if (grass(x + 1, y + 1)) put(x + 1, y + 1, dark);
    } else {
      put(x, y, dark);
    }
  }

  // 苜蓿：一小片一小片聚在一起
  if (m !== 'e' && valueNoise(c * T, r * T, 70) > 0.62) {
    const clover = hexRgb(C.clover), light = hexRgb(C.cloverLight);
    const n = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const x = rx(), y = ry();
      if (!grass(x, y) || !grass(x + 1, y + 1)) continue;
      put(x, y, clover); put(x + 1, y, clover); put(x, y + 1, clover);
      put(x + 1, y + 1, light);
      if (grass(x + 2, y + 1)) put(x + 2, y + 1, clover);
    }
  }

  // 小花：花草地很多，普通草地只在少數幾片
  let flowers = 0;
  if (m === 'f') flowers = 6 + Math.floor(rand() * 4);
  else if (m === 'g' && valueNoise(c * T + 40, r * T, 120) > 0.64) flowers = 1 + Math.floor(rand() * 3);
  else if (m === 't' && rand() < 0.3) flowers = 1;
  const kindHere = Math.floor(valueNoise(c * T, r * T + 900, 150) * C.flowers.length * 0.999);
  for (let i = 0; i < flowers; i++) {
    const x = rx(), y = ry();
    if (!grass(x, y) || !grass(x + 1, y + 1)) continue;
    // 同一片花圃大多是同一種花，偶爾混一朵別的
    const [petal, core] = C.flowers[rand() < 0.75 ? kindHere : Math.floor(rand() * C.flowers.length)].map(hexRgb);
    if (rand() < 0.4) {
      put(x + 1, y + 1, hexRgb(C.flowerShadow));
      put(x - 1, y, petal); put(x + 1, y, petal); put(x, y - 1, petal); put(x, y + 1, petal);
      put(x, y, core);
    } else {
      put(x + 1, y + 1, hexRgb(C.flowerShadow));
      put(x, y, petal); put(x + 1, y, core);
    }
  }

  // 碎石：路面上散落
  const pebbles = m === 'p' ? 5 : (m === 'm' ? 3 : 1);
  const pebble = hexRgb(C.pebble), pebbleDark = hexRgb(C.pebbleDark);
  for (let i = 0; i < pebbles; i++) {
    const x = rx(), y = ry();
    if (!path(x, y) || !path(x + 1, y + 1)) continue;
    put(x, y, pebble);
    if (rand() < 0.5) { put(x + 1, y, pebble); put(x + 1, y + 1, pebbleDark); }
    put(x, y + 1, pebbleDark);
  }

  // 踏腳石：路心偶爾一塊；「石板(疏)」那格就是草裡的一塊踏腳石
  if ((m === 'p' && rand() < 0.3) || m === 'e') {
    stampSlab(c, r, rand, put, clsAt, m === 'e');
  }

  // 貓腳印：路心偶爾一串
  if (m === 'p' && rand() < 0.14) {
    const paw = hexRgb(C.paw);
    let x = c * T + 6 + Math.floor(rand() * 16), y = r * T + 6 + Math.floor(rand() * 16);
    const dx = rand() < 0.5 ? 5 : -5, dy = rand() < 0.5 ? 2 : -2;
    for (let s = 0; s < 3; s++, x += dx, y += dy) {
      const ox = s % 2 ? 2 : 0;
      const px = x + ox, py = y;
      if (!path(px, py) || !path(px + 2, py - 2)) continue;
      put(px, py, paw); put(px + 1, py, paw);
      put(px - 1, py - 2, paw); put(px + 1, py - 3, paw); put(px + 2, py - 2, paw);
    }
  }

  // 水窪：路心有些地方是凹下去的，雨下久了才會積水（畫在另一張畫布上）
  if (m === 'p' && pixelHash(c, r + 4000) % 5 === 0) {
    stampPuddle(c, r, rand, clsAt, pctx, inRect);
  }
}

function stampSlab(c, r, rand, put, clsAt, inGrass) {
  const T = TILE_SIZE, C = GROUND_COLORS;
  const w = 7 + Math.floor(rand() * 5), h = 5 + Math.floor(rand() * 3);
  const x0 = c * T + 3 + Math.floor(rand() * (T - w - 6));
  const y0 = r * T + 3 + Math.floor(rand() * (T - h - 6));
  const ok = (x, y) => {
    const k = clsAt(x, y);
    return inGrass ? k !== CLS_TILE : k === CLS_PATH;
  };
  // 整塊都要落在允許的地方，不然就不放
  for (let y = y0; y <= y0 + h; y++) for (let x = x0; x <= x0 + w; x++) if (!ok(x, y)) return;

  const cx = x0 + w / 2, cy = y0 + h / 2;
  const inside = (x, y) => {
    const dx = (x + 0.5 - cx) / (w / 2), dy = (y + 0.5 - cy) / (h / 2);
    return dx * dx + dy * dy + (pixelHash(x, y) % 5) * 0.04 < 1;
  };
  const slab = hexRgb(C.slab), light = hexRgb(C.slabLight), dark = hexRgb(C.slabDark);
  const moss = hexRgb(C.moss), shadow = hexRgb(inGrass ? C.bladeDark : C.path[0]);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue;
      // 石頭底下一圈影子（右下）
      if (!inside(x + 1, y + 1)) put(x + 1, y + 1, shadow);
    }
  }
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue;
      let col = slab;
      if (!inside(x, y - 1) || !inside(x - 1, y)) col = light;          // 受光的左上緣
      else if (!inside(x, y + 1) || !inside(x + 1, y)) col = dark;      // 背光的右下緣
      else if (pixelHash(x, y) % 11 === 0) col = dark;                  // 表面的小坑
      if (inGrass && col === slab && pixelHash(x + 5, y) % 9 === 0) col = moss;
      put(x, y, col);
    }
  }
  // 草裡的石頭：草葉伸到石頭邊上
  if (inGrass) {
    const blade = hexRgb(C.blade);
    for (let x = x0; x < x0 + w; x++) {
      if (pixelHash(x, y0) % 3 === 0) {
        for (let y = y0 + h; y >= y0; y--) if (inside(x, y)) { put(x, y, blade); break; }
      }
    }
  }
}

function stampPuddle(c, r, rand, clsAt, pctx, inRect) {
  const T = TILE_SIZE, C = GROUND_COLORS;
  // 兩個橢圓疊在一起，形狀才不會像一顆膠囊
  const rx = 6 + rand() * 6, ry = 3 + rand() * 2.5;
  const cx = c * T + 12 + rand() * 8, cy = r * T + 10 + rand() * 12;
  const ox = (rand() - 0.5) * rx, oy = (rand() - 0.5) * ry, k2 = 0.5 + rand() * 0.3;
  const pts = [];
  for (let y = Math.floor(cy - ry - 3); y <= Math.ceil(cy + ry + 3); y++) {
    for (let x = Math.floor(cx - rx - 4); x <= Math.ceil(cx + rx + 4); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const ex = (x + 0.5 - cx - ox) / (rx * k2), ey = (y + 0.5 - cy - oy - ry * 0.6) / (ry * k2);
      const wob = (valueNoise(x, y, 4) - 0.5) * 0.6;
      if (Math.min(dx * dx + dy * dy, ex * ex + ey * ey) + wob >= 1) continue;
      if (clsAt(x, y) !== CLS_PATH) return;   // 碰到草就整個不放
      pts.push([x, y]);
    }
  }
  if (pts.length < 12) return;
  const set = new Set(pts.map(([x, y]) => x + ',' + y));
  const has = (x, y) => set.has(x + ',' + y);
  for (const [x, y] of pts) {
    if (!inRect(x, y)) continue;
    let col = C.puddle;
    if (!has(x, y - 1)) col = C.puddleEdge;                         // 北緣：坑的內壁在陰影裡
    else if (!has(x, y + 1) || (y === Math.round(cy) - 1 && pixelHash(x, y) % 2)) col = C.puddleLight; // 天光反射
    pctx.fillStyle = col;
    pctx.fillRect(x, y, 1, 1);
  }
  if (inRect(Math.round(cx), Math.round(cy))) GROUND.puddleSpots.push([Math.round(cx), Math.round(cy), rx * 0.7, ry * 0.7]);
}

/* ---------------------------------------------------------------------
 * 會隨風擺的草叢
 * ------------------------------------------------------------------- */
const TUFT_W = 9, TUFT_H = 7;

/* 兩種草叢 x 三個彎度（直、微彎、彎）。每根草從底部長出來，越往上偏越多。 */
function buildTuftSheet() {
  const shapes = [
    [[1, 4], [3, 6], [4, 5], [5, 7], [7, 4]],     // [底部 x, 高度]
    [[2, 5], [3, 7], [5, 6], [6, 4]],
  ];
  const [dark, mid, light] = GROUND_COLORS.tuft;
  const c = makeGroundCanvas(TUFT_W * 3, TUFT_H * shapes.length);
  const ctx = c.getContext('2d');
  shapes.forEach((blades, s) => {
    for (let lean = 0; lean < 3; lean++) {
      const ox = lean * TUFT_W, oy = s * TUFT_H;
      for (const [bx, h] of blades) {
        for (let k = 0; k < h; k++) {
          const y = TUFT_H - 1 - k;
          const x = bx + Math.round(lean * (k / TUFT_H) * 1.6);
          ctx.fillStyle = k === 0 ? dark : (k >= h - 2 ? light : mid);
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }
  });
  return c;
}

function buildTufts(map) {
  const T = TILE_SIZE, W = GROUND.W;
  GROUND.tufts = [];
  for (let r = 1; r < map.rows - 1; r++) {
    for (let c = 1; c < map.cols - 1; c++) {
      const m = GROUND.mats[r * map.cols + c];
      const h = pixelHash(c + 900, r + 77);
      const n = m === 't' ? 3 : ((m === 'g' || m === 'f') && h % 5 === 0 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const hh = pixelHash(c * 31 + i, r * 17 + i);
        const x = c * T + 2 + hh % (T - TUFT_W - 4), y = r * T + 2 + (hh >>> 8) % (T - TUFT_H - 4);
        const base = (y + TUFT_H) * W + x + 4;
        if (GROUND.cls[base] !== CLS_GRASS) continue;
        GROUND.tufts.push({ x, y, s: (hh >>> 16) % 2, p: ((hh >>> 4) % 100) / 100 });
      }
    }
  }
}

function drawGroundLife(ctx) {
  if (!GROUND.tuftSheet || !GROUND.tufts.length) return;
  const live = CONFIG.AMBIENCE && CONFIG.SCENE_LIFE;
  for (const t of GROUND.tufts) {
    let lean = 0;
    if (live) {
      const g = windAt(t.x + t.p * 40);
      lean = g > 0.62 ? 2 : (g > 0.32 ? 1 : 0);
    }
    ctx.drawImage(GROUND.tuftSheet, lean * TUFT_W, t.s * TUFT_H, TUFT_W, TUFT_H, t.x, t.y, TUFT_W, TUFT_H);
  }
}
