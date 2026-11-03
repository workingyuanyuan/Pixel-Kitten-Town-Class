/* =====================================================================
 * weather.js — 天氣與風
 * =====================================================================
 *
 * 三種天氣：晴天、多雲、下雨。CONFIG.WEATHER 設成 'auto' 時會自己慢慢變，
 * 大部分時間是晴天；工具列的天氣按鈕可以直接指定。
 *
 * 天氣不是一個開關，而是幾個慢慢變化的數值，換天氣時會花十幾秒淡過去：
 *   sun    陽光有多強：影子多深、暖光、光束、浮塵
 *   cloud  雲有多厚：雲影多寡
 *   rain   雨有多大
 *   wind   風有多大：草叢、樹梢、落葉、雨絲的斜度
 *   wet    地面有多濕：雨停了還會濕一陣子，水窪慢慢退
 * ambience.js 依這些數值調整光影。
 *
 * 跟光影一樣，天氣**只改變地面**：下雨時變暗的是地面，貓不會變暗；
 * 落在空中的只有細細的雨絲。濺起的水花畫在地面層，被貓擋住就看不到。
 * ===================================================================== */

const WEATHER_KINDS = {
  sunny:  { label: '晴天', icon: '☀️', sun: 1,    cloud: 0.15, rain: 0, wind: 0.3 },
  cloudy: { label: '多雲', icon: '⛅', sun: 0.4,  cloud: 0.75, rain: 0, wind: 0.5 },
  rain:   { label: '下雨', icon: '🌧️', sun: 0.08, cloud: 1,    rain: 1, wind: 0.75 },
};
const WEATHER_MODES = ['auto', 'sunny', 'cloudy', 'rain'];

/* 自動模式下每種天氣持續多久（秒） */
const WEATHER_DURATION = { sunny: [480, 840], cloudy: [120, 240], rain: [90, 180] };

const WEATHER = {
  mode: 'auto',
  kind: 'sunny',
  prev: 'sunny',
  timer: 600,
  sun: 1, cloud: 0.15, rain: 0, wind: 0.3, wet: 0,
  t: 0,
  drops: [],
  splashes: [],
  rings: [],
  ringTimer: 0,
};

function weatherModeValid(m) { return WEATHER_MODES.includes(m); }

function initWeather() {
  let mode = weatherModeValid(CONFIG.WEATHER) ? CONFIG.WEATHER : 'auto';
  try {
    const saved = localStorage.getItem('pixel-town-weather');
    if (weatherModeValid(saved)) mode = saved;
  } catch (e) { /* 無痕視窗等情況讀不到，就用設定檔的 */ }
  setWeatherMode(mode, true);

  const btn = document.getElementById('btn-weather');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = WEATHER_MODES[(WEATHER_MODES.indexOf(WEATHER.mode) + 1) % WEATHER_MODES.length];
      setWeatherMode(next, false);
      try { localStorage.setItem('pixel-town-weather', next); } catch (e) { /* 存不了就算了 */ }
    });
  }
}

/* instant：一開頁面就直接是那種天氣，不要從晴天慢慢轉過去 */
function setWeatherMode(mode, instant) {
  WEATHER.mode = mode;
  if (mode !== 'auto') WEATHER.kind = mode;
  else if (instant) WEATHER.kind = 'sunny';
  WEATHER.timer = weatherDuration(WEATHER.kind);
  if (instant) {
    const k = WEATHER_KINDS[WEATHER.kind];
    WEATHER.sun = k.sun; WEATHER.cloud = k.cloud; WEATHER.rain = k.rain; WEATHER.wind = k.wind;
    WEATHER.wet = k.rain;
  }
  updateWeatherButton();
}

function updateWeatherButton() {
  const btn = document.getElementById('btn-weather');
  if (!btn) return;
  const k = WEATHER_KINDS[WEATHER.kind];
  btn.textContent = WEATHER.mode === 'auto' ? '🌤️' : k.icon;
  btn.title = WEATHER.mode === 'auto'
    ? `天氣：自動（現在${k.label}）—— 點一下切換`
    : `天氣：${k.label} —— 點一下切換`;
  btn.classList.toggle('on', WEATHER.mode !== 'auto');
}

function weatherDuration(kind) {
  const [a, b] = WEATHER_DURATION[kind];
  return a + Math.random() * (b - a);
}

/* 晴 → 多雲 → 有一半機會下雨 → 多雲 → 晴 */
function nextWeather() {
  const from = WEATHER.kind;
  let to;
  if (from === 'sunny') to = 'cloudy';
  else if (from === 'rain') to = 'cloudy';
  else to = (WEATHER.prev === 'sunny' && Math.random() < 0.5) ? 'rain' : 'sunny';
  WEATHER.prev = from;
  WEATHER.kind = to;
  WEATHER.timer = weatherDuration(to);
  updateWeatherButton();
}

/* 風：一陣一陣由左往右吹過去。傳回 0 到大約 1，給草叢、樹梢用。 */
function windAt(x) {
  const t = WEATHER.t;
  const g = 0.5 + 0.5 * Math.sin(t * 0.7 - x * 0.011);
  const g2 = 0.5 + 0.5 * Math.sin(t * 0.23 - x * 0.004 + 1.3);
  return WEATHER.wind * (0.35 + 1.1 * g * g2);
}

/* ---------------------------------------------------------------------
 * 每一格
 * ------------------------------------------------------------------- */
function updateWeather(dt, W, H, map) {
  WEATHER.t += dt;
  if (WEATHER.mode === 'auto') {
    WEATHER.timer -= dt;
    if (WEATHER.timer <= 0) nextWeather();
  }

  const k = WEATHER_KINDS[WEATHER.kind];
  const ease = (cur, target, tau) => cur + (target - cur) * Math.min(1, dt / tau);
  WEATHER.sun = ease(WEATHER.sun, k.sun, 6);
  WEATHER.cloud = ease(WEATHER.cloud, k.cloud, 6);
  WEATHER.wind = ease(WEATHER.wind, k.wind, 5);
  WEATHER.rain = ease(WEATHER.rain, k.rain, 4);
  // 地面濕得快、乾得慢
  if (WEATHER.rain > 0.5) WEATHER.wet = Math.min(1, WEATHER.wet + dt / 25);
  else WEATHER.wet = Math.max(0, WEATHER.wet - dt / 90);

  const live = CONFIG.SCENE_LIFE;
  updateRain(dt, W, H, live ? WEATHER.rain : 0, map);
}

function updateRain(dt, W, H, rain, map) {
  const want = Math.round(rain * 260);
  const vx = WEATHER.wind * 70;
  while (WEATHER.drops.length < want) WEATHER.drops.push(newDrop(W, H, vx, true));
  if (WEATHER.drops.length > want) WEATHER.drops.length = want;

  for (let i = 0; i < WEATHER.drops.length; i++) {
    const d = WEATHER.drops[i];
    d.y += d.v * dt;
    d.x += vx * dt;
    if (d.y < d.ty) continue;
    landDrop(Math.round(d.x), Math.round(d.ty), W, map);
    WEATHER.drops[i] = newDrop(W, H, vx, false);
  }
  WEATHER.splashes = WEATHER.splashes.filter((s) => (s.age += dt) < 0.2);

  // 水窪裡的漣漪
  if (rain > 0.3 && GROUND.puddleSpots.length && WEATHER.wet > 0.4) {
    WEATHER.ringTimer -= dt * rain;
    while (WEATHER.ringTimer <= 0) {
      WEATHER.ringTimer += 0.08;
      const [x, y, rx, ry] = GROUND.puddleSpots[Math.floor(Math.random() * GROUND.puddleSpots.length)];
      const a = Math.random() * 6.28, d = Math.random();
      WEATHER.rings.push({ x: Math.round(x + Math.cos(a) * rx * d), y: Math.round(y + Math.sin(a) * ry * d), age: 0, big: 2 });
    }
  }
  WEATHER.rings = WEATHER.rings.filter((r) => (r.age += dt) < 0.5);
}

/* 雨滴從落點的正上方掉下來（俯視角，越晚掉到的越「高」） */
function newDrop(W, H, vx, anywhere) {
  const ty = Math.random() * H;
  const fall = 70 + Math.random() * 110;
  const v = 280 + Math.random() * 80;
  const y = anywhere ? ty - Math.random() * fall : ty - fall;
  const x = Math.random() * (W + 60) - 30 - vx * (ty - y) / v;
  return { x, y, ty, v, len: 4 + Math.floor(Math.random() * 3) };
}

function landDrop(x, y, W, map) {
  if (x < 0 || x >= W || y < 0) return;
  // 落在水面上冒漣漪；橋下的水格可以通行（blocked 為 false），雨是打在橋板上
  const c = Math.floor(x / TILE_SIZE), r = Math.floor(y / TILE_SIZE);
  const open = map.blocked[r] && map.blocked[r][c];
  if (open && WATER.base && WATER.mask && WATER.mask[y * W + x]) {
    if (Math.random() < 0.5) WEATHER.rings.push({ x, y, age: 0, big: 3 });
    return;
  }
  if (Math.random() < 0.6) WEATHER.splashes.push({ x, y, age: 0 });
}

/* ---------------------------------------------------------------------
 * 繪製
 * ------------------------------------------------------------------- */
function weatherGround(ctx, map, dt) {
  if (!CONFIG.AMBIENCE) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  updateWeather(dt, W, H, map);

  ctx.save();
  // 濕掉的地面：路面暗很多、草地暗一點
  if (WEATHER.wet > 0.01 && GROUND.wet) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = WEATHER.wet * 0.9;
    ctx.drawImage(GROUND.wet, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  // 水窪：要濕到一定程度才開始積，雨停後慢慢退
  if (WEATHER.wet > 0.25 && GROUND.puddles) {
    ctx.globalAlpha = Math.min(1, (WEATHER.wet - 0.25) * 2);
    ctx.drawImage(GROUND.puddles, 0, 0);
  }

  ctx.fillStyle = 'rgb(214, 228, 236)';
  for (const s of WEATHER.splashes) {
    ctx.globalAlpha = 0.8;
    if (s.age < 0.1) {
      ctx.fillRect(s.x, s.y, 1, 1);
      ctx.fillRect(s.x - 1, s.y - 1, 1, 1);
      ctx.fillRect(s.x + 1, s.y - 1, 1, 1);
    } else {
      ctx.globalAlpha = 0.5;
      ctx.fillRect(s.x - 2, s.y - 1, 1, 1);
      ctx.fillRect(s.x + 2, s.y - 1, 1, 1);
    }
  }
  for (const r of WEATHER.rings) {
    const rad = 1 + (r.age / 0.5) * r.big;
    ctx.globalAlpha = (1 - r.age / 0.5) * 0.7;
    for (let a = 0; a < 10; a++) {
      const ang = a / 10 * Math.PI * 2;
      ctx.fillRect(Math.round(r.x + Math.cos(ang) * rad), Math.round(r.y + Math.sin(ang) * rad * 0.55), 1, 1);
    }
  }
  ctx.restore();
}

/* 雨絲畫在最上層：只有幾百個淡淡的像素，不會改變任何一隻貓的明暗 */
function weatherAir(ctx) {
  if (!CONFIG.AMBIENCE || !WEATHER.drops.length) return;
  const slant = WEATHER.wind > 0.45 ? 1 : 0;
  ctx.save();
  ctx.fillStyle = 'rgb(208, 222, 236)';
  ctx.globalAlpha = 0.5 + 0.25 * WEATHER.rain;
  for (const d of WEATHER.drops) {
    const x = Math.round(d.x), y = Math.round(d.y);
    ctx.fillRect(x - slant, y, 1, 2);
    ctx.fillRect(x, y + 2, 1, d.len - 2);
  }
  ctx.restore();
}
