/* 動物素材保持原始 64px 格線；固定裁切 32px 視窗，腳底對齊 y=28。
 * 不逐格自動置中，以免跳躍、呼吸時角色抖動。來源見 CREDITS.md。 */
const ANIMAL_ANIMS = {
  bunny_idle: { path: 'assets/animals/bunny/Idle.png', frames: 2, fps: 2, cropY: 12 },
  bunny_walk: { path: 'assets/animals/bunny/Walk.png', frames: 4, fps: 6, cropY: 12 },
  penguin_idle: { path: 'assets/animals/penguin/Idle.png', frames: 2, fps: 2, cropY: 4 },
  penguin_walk: { path: 'assets/animals/penguin/Walk.png', frames: 6, fps: 6, cropY: 4 },
  penguin_flap: { path: 'assets/animals/penguin/Flap.png', frames: 2, fps: 5, cropY: 4 },
  cow_idle: { path: 'assets/animals/cow/Idle.png', frames: 6, fps: 4, cropY: 4 },
  cow_walk: { path: 'assets/animals/cow/Walk.png', frames: 6, fps: 6, cropY: 4 },
  goose_idle: { path: 'assets/animals/goose/Idle.png', frames: 2, fps: 2, cropX: 18, cropY: 4 },
  goose_walk: { path: 'assets/animals/goose/Walk.png', frames: 4, fps: 6, cropX: 18, cropY: 4 },
  goose_flap: { path: 'assets/animals/goose/Flap.png', frames: 4, fps: 6, cropX: 18, cropY: 4 },
  // Idle 的第二列是重複影格，只播放第一列。
  frog_idle: { path: 'assets/animals/frog/Idle.png', frames: 2, fps: 3, cropY: 12, sheetRows: 2 },
  frog_jump: { path: 'assets/animals/frog/Jump.png', frames: 1, fps: 10, cropY: 12 },
  frog_fall: { path: 'assets/animals/frog/Fall.png', frames: 1, fps: 10, cropY: 12 },
  frog_land: { path: 'assets/animals/frog/Land.png', frames: 2, fps: 10, cropY: 12 },
  // 同一時間軸驅動影格、離地高度與水平位移；落地時停止平移。
  frog_hop: { frames: 8, fps: 10, sequence: [
    { anim: 'frog_idle', frame: 0, lift: 0, travel: 0 },
    { anim: 'frog_jump', frame: 0, lift: 3, travel: 1 },
    { anim: 'frog_jump', frame: 0, lift: 6, travel: 2 },
    { anim: 'frog_fall', frame: 0, lift: 7, travel: 2 },
    { anim: 'frog_fall', frame: 0, lift: 6, travel: 2 },
    { anim: 'frog_fall', frame: 0, lift: 3, travel: 1 },
    { anim: 'frog_land', frame: 0, lift: 0, travel: 0 },
    { anim: 'frog_land', frame: 1, lift: 0, travel: 0 },
  ] },
};

const ANIMAL_SPECIES = {
  cat: { label: '貓咪' },
  bunny: { label: '兔子', idle: 'bunny_idle', walk: 'bunny_walk', celebrate: 'bunny_walk', flourish: 'bunny_walk', speed: 16 },
  penguin: { label: '企鵝', idle: 'penguin_idle', walk: 'penguin_walk', celebrate: 'penguin_flap', flourish: 'penguin_flap', speed: 14 },
  // 牛的素材只有待機與走路，招牌動作靠 LEVEL_FX 的特效補上
  cow: { label: '牛', idle: 'cow_idle', walk: 'cow_walk', celebrate: 'cow_idle', speed: 12, facing: 'right' },
  goose: { label: '鵝', idle: 'goose_idle', walk: 'goose_walk', celebrate: 'goose_flap', flourish: 'goose_flap', speed: 14, facing: 'right' },
  frog: { label: '青蛙', idle: 'frog_idle', walk: 'frog_hop', celebrate: 'frog_hop', flourish: 'frog_hop', speed: 16 },
};
/* flourish：Lv 3 起穿插在待機之間的招牌動作（見 config.js 的 POSE_LADDER）。
 * 待機時不會位移，兔子、青蛙就是原地跳。 */

function animalFrame(state) {
  const animation = ANIMAL_ANIMS[state.name];
  if (!animation) return null;
  const frame = state.frame % animation.frames;
  return animation.sequence ? animation.sequence[frame] : { anim: state.name, frame, lift: 0, travel: 1 };
}

function animalAnimationAvailable(name, bundle) {
  const anim = ANIMAL_ANIMS[name];
  if (!anim) return false;
  return anim.sequence
    ? anim.sequence.every(step => !!bundle.animals[step.anim])
    : !!bundle.animals[name];
}

function appearanceOf(student) {
  const saved = normalizeAppearance(student.appearance);
  if (saved) return saved;
  const h = hash32(student.id);
  return { species: 'cat', base: h % CAT_BASES.length,
    accessory: ((h >>> 5) % (CAT_ACCESSORIES.length + 1)) - 1 };
}

function applyCharacterAppearance(cat, appearance) {
  cat.species = appearance.species;
  cat.baseIndex = appearance.base;
  cat.accIndex = appearance.species === 'cat' ? appearance.accessory : -1;
}

function animalDefinition(cat) {
  return cat.species && cat.species !== 'cat' ? ANIMAL_SPECIES[cat.species] : null;
}

function appearanceAvailable(appearance, bundle) {
  if (!bundle) return false;
  if (appearance.species === 'cat') {
    return !!bundle.bases[appearance.base] &&
      (appearance.accessory < 0 || !!bundle.accessories[appearance.accessory]);
  }
  const def = ANIMAL_SPECIES[appearance.species];
  return !!def && [def.idle, def.walk, def.celebrate].every(name => animalAnimationAvailable(name, bundle));
}

/* 地圖、角色面板及編輯器共用同一條繪製路徑。配件只屬於貓咪。 */
function drawCharacter(ctx, cat, bundle, x, y, size = 32) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  ctx.imageSmoothingEnabled = false;
  const def = animalDefinition(cat);
  if (!def) {
    drawCatFrame(ctx, bundle.bases[cat.baseIndex], cat.anim, 0, 0, cat.flip);
    if (cat.accIndex >= 0 && bundle.accessories[cat.accIndex]) {
      drawCatFrame(ctx, bundle.accessories[cat.accIndex], cat.anim, 0, 0, cat.flip);
    }
  } else {
    const name = ANIMAL_ANIMS[cat.anim.name] ? cat.anim.name : def.idle;
    const step = animalFrame({ name, frame: cat.anim.frame });
    const anim = ANIMAL_ANIMS[step.anim];
    const img = bundle.animals[step.anim];
    if (img) {
      ctx.save();
      if (cat.flip) { ctx.translate(32, 0); ctx.scale(-1, 1); }
      ctx.drawImage(img, step.frame * 64 + (anim.cropX ?? 16), anim.cropY,
        32, 32, 0, -step.lift, 32, 32);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(8, 8, 16, 16);
    }
    // 素材沒有睡覺動畫，使用共用狀態提示，仍由登記規則觸發。
    if (cat.drowsy) {
      ctx.font = 'bold 7px monospace';
      ctx.fillStyle = '#f3e5c2';
      ctx.strokeStyle = '#4a3b34';
      ctx.lineWidth = 2;
      const zx = cat.species === 'goose' ? (cat.flip ? 25 : 1) : 22;
      ctx.strokeText('z', zx, 8);
      ctx.fillText('z', zx, 8);
    }
  }
  ctx.restore();
}
