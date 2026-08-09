/* =====================================================================
 * assets.js — 資材載入與貓咪動畫繪製核心模組
 * =====================================================================
 * 提供圖檔載入、資材包裹建立、貓咪動畫狀態管理與 Canvas 繪製功能。
 * 本檔案遵守純前端無模組架構（無 ES Module / 全域宣告）。
 * ===================================================================== */

/**
 * 載入單一圖片資源。
 * 成功時 Promise 解析為 HTMLImageElement，失敗時解析為 null（絕不 reject）。
 *
 * @param {string} path - 圖片檔案路徑
 * @returns {Promise<HTMLImageElement|null>}
 */
function loadImage(path) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

/**
 * 載入 TILE_ASSETS 與 CAT_SKINS 中的所有素材。
 * 缺失的素材不會導致程式崩潰，載入完成後若有缺失會集中印出單一 console.warn。
 *
 * @returns {Promise<{tiles: Object, skins: Array<HTMLImageElement|null>, missing: Array<string>}>}
 */
async function loadAllAssets() {
  const missing = [];

  // 1. 載入 Tileset 地圖素材
  const tileKeys = Object.keys(TILE_ASSETS);
  const tilePromises = tileKeys.map(key => loadImage(TILE_ASSETS[key]));
  const tileImages = await Promise.all(tilePromises);

  const tiles = {};
  tileKeys.forEach((key, index) => {
    const img = tileImages[index];
    tiles[key] = img;
    if (!img) {
      missing.push(TILE_ASSETS[key]);
    }
  });

  // 2. 載入貓的基底毛色（完整的貓）
  const bases = await Promise.all(CAT_BASES.map(path => loadImage(path)));
  bases.forEach((img, index) => {
    if (!img) missing.push(CAT_BASES[index]);
  });

  // 3. 載入配件圖層（只有配件本身，要疊在基底上畫）
  const accessories = await Promise.all(CAT_ACCESSORIES.map(path => loadImage(path)));
  accessories.forEach((img, index) => {
    if (!img) missing.push(CAT_ACCESSORIES[index]);
  });

  // 3. 若有缺失檔案，集中印出警告訊息（一次性印出所有缺失路徑）
  if (missing.length > 0) {
    console.warn(
      `[assets.js] 載入資材時有 ${missing.length} 個檔案缺失：\n` +
      missing.map(p => `  - ${p}`).join('\n')
    );
  }

  return {
    tiles: tiles,
    bases: bases,
    accessories: accessories,
    missing: missing
  };
}

/**
 * 建立貓咪動畫狀態物件。
 *
 * @param {string} animName - 動畫名稱
 * @returns {{name: string, frame: number, elapsed: number}}
 */
function makeAnimState(animName) {
  const name = animName || 'rest_1';
  assertAnimAllowed(name);
  return {
    name: name,
    frame: 0,
    elapsed: 0
  };
}

/**
 * 更新貓咪動畫狀態。依據 dtSeconds 與動畫自身的 fps 及 frames 推進。
 *
 * @param {{name: string, frame: number, elapsed: number}} state - 動畫狀態物件
 * @param {number} dtSeconds - 距上一影格的時間差（秒）
 * @returns {boolean} 若動畫在本影格剛好完成一次循環回 0 則傳回 true，否則傳回 false
 */
function updateAnim(state, dtSeconds) {
  if (!state || !state.name) return false;
  const anim = CAT_ANIMS[state.name];
  if (!anim || anim.frames <= 0 || anim.fps <= 0) return false;

  state.elapsed += dtSeconds;
  const frameDuration = 1 / anim.fps;
  let looped = false;

  while (state.elapsed >= frameDuration) {
    state.elapsed -= frameDuration;
    state.frame++;
    if (state.frame >= anim.frames) {
      state.frame = 0;
      looped = true;
    }
  }

  return looped;
}

/**
 * 切換貓咪播放的動畫。若目前正播放同名動畫則為無動作 (no-op)。
 * 會先呼叫 assertAnimAllowed(animName) 驗證是否為許可動畫。
 *
 * @param {{name: string, frame: number, elapsed: number}} state - 動畫狀態物件
 * @param {string} animName - 目標動畫名稱
 */
function setAnim(state, animName) {
  assertAnimAllowed(animName);
  if (state.name === animName) {
    return;
  }
  state.name = animName;
  state.frame = 0;
  state.elapsed = 0;
}

/**
 * 繪製單格 32x32 貓咪動畫影格至 Canvas 繪圖上下文。
 * 若 img 為 null 或載入失敗，會繪製洋紅色 (magenta) 32x32 佔位方塊。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D 上下文
 * @param {HTMLImageElement|null} img - 貓咪 Spritesheet 圖片物件
 * @param {{name: string, frame: number, elapsed: number}} state - 動畫狀態物件
 * @param {number} dx - 繪製目標 X 座標
 * @param {number} dy - 繪製目標 Y 座標
 * @param {boolean} [flipX=false] - 是否水平翻轉繪製
 */
function drawCatFrame(ctx, img, state, dx, dy, flipX) {
  ctx.imageSmoothingEnabled = false;

  if (!img) {
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(dx, dy, 32, 32);
    return;
  }

  const anim = CAT_ANIMS[state.name] || CAT_ANIMS.rest_1;
  const row = anim.row;
  const frame = state.frame % anim.frames;

  if (flipX) {
    ctx.save();
    ctx.translate(dx + 32, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, frame * 32, row * 32, 32, 32, 0, 0, 32, 32);
    ctx.restore();
  } else {
    ctx.drawImage(img, frame * 32, row * 32, 32, 32, dx, dy, 32, 32);
  }
}
