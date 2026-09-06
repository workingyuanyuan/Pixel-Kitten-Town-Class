/* 選擇只更新草稿。原生 dialog 提供焦點圈限、背景隔離與 Escape。 */
const APPEARANCE = { dialog: null, draft: null, preview: null, student: null, action: 'idle' };
const CAT_BASE_NAMES = ['灰貓', '橘貓', '白貓'];
const CAT_ACCESSORY_NAMES = [
  '邱比特', '光環', '翅膀', '藍蝴蝶結', '金蝴蝶結', '金色愛心眼鏡',
  '綠蝴蝶結', '粉紅蝴蝶結', '粉紅蝴蝶結（大）', '紅蝴蝶結', '紅色愛心眼鏡',
  '聖誕帽', '聖誕帽（長）', '綠色馴鹿角', '紅色馴鹿角',
];

function initAppearanceEditor() {
  const a = APPEARANCE;
  a.dialog = document.getElementById('appearance-dialog');
  a.canvas = document.getElementById('appearance-preview');
  a.ctx = a.canvas.getContext('2d');
  document.getElementById('panel-appearance').addEventListener('click', openAppearanceEditor);
  for (const id of ['appearance-close', 'appearance-cancel']) {
    document.getElementById(id).addEventListener('click', closeAppearanceEditor);
  }
  a.dialog.addEventListener('close', () => {
    if (!a.dialog.open) { a.draft = null; a.preview = null; a.student = null; }
  });
  document.getElementById('appearance-apply').addEventListener('click', () => {
    if (!a.student || !a.draft || !P.onAppearance) return;
    if (P.onAppearance(a.student, a.draft)) closeAppearanceEditor();
    else refreshAppearanceOptions();
  });

  for (const [species, def] of Object.entries(ANIMAL_SPECIES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.species = species;
    button.setAttribute('aria-pressed', 'false');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = def.label;
    button.append(canvas, label);
    button.addEventListener('click', () => {
      if (a.draft.species === 'cat') a.catChoice = { ...a.draft };
      a.draft = species === 'cat' ? { ...a.catChoice } : { species, base: 0, accessory: -1 };
      resetAppearancePreview();
    });
    document.getElementById('appearance-species').appendChild(button);
  }
  CAT_BASES.forEach((_, base) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = CAT_BASE_NAMES[base] || `毛色 ${base + 1}`;
    button.dataset.base = String(base);
    button.addEventListener('click', () => { a.draft.base = base; resetAppearancePreview(); });
    document.getElementById('appearance-bases').appendChild(button);
  });
  const select = document.getElementById('appearance-accessory');
  for (let i = -1; i < CAT_ACCESSORIES.length; i++) {
    select.add(new Option(i < 0 ? '無配件' : (CAT_ACCESSORY_NAMES[i] || `配件 ${i + 1}`), String(i)));
  }
  select.addEventListener('change', () => { a.draft.accessory = Number(select.value); resetAppearancePreview(); });
  document.querySelectorAll('#appearance-actions button').forEach(button => {
    button.addEventListener('click', () => { a.action = button.dataset.action; resetAppearancePreview(); });
  });
}

function appearanceEditorOpen() { return !!APPEARANCE.dialog && APPEARANCE.dialog.open; }

function openAppearanceEditor() {
  if (!P.cat || !S.bundle || appearanceEditorOpen()) return;
  const a = APPEARANCE;
  a.student = P.cat.student;
  a.draft = { ...appearanceOf(a.student) };
  a.catChoice = a.draft.species === 'cat' ? { ...a.draft } : { species: 'cat', base: 0, accessory: -1 };
  a.action = 'idle';
  document.getElementById('appearance-who').textContent = studentLabel(a.student);
  a.dialog.showModal();
  resetAppearancePreview();
}

function closeAppearanceEditor() {
  if (appearanceEditorOpen()) APPEARANCE.dialog.close();
}

function resetAppearancePreview() {
  const a = APPEARANCE;
  if (a.draft.species === 'cat') a.catChoice = { ...a.draft };
  const def = ANIMAL_SPECIES[a.draft.species];
  const name = a.draft.species === 'cat'
    ? { idle: 'rest_1', walk: 'walk_left', celebrate: 'meow_stand' }[a.action]
    : def[a.action];
  a.preview = { student: a.student, flip: false, drowsy: false, anim: makeAnimState(name) };
  applyCharacterAppearance(a.preview, a.draft);
  refreshAppearanceOptions();
  updateAppearanceEditor(0);
}

function refreshAppearanceOptions() {
  const a = APPEARANCE;
  if (!a.draft) return;
  document.getElementById('appearance-cat-options').hidden = a.draft.species !== 'cat';
  document.querySelectorAll('#appearance-species button').forEach(button => {
    const species = button.dataset.species;
    button.setAttribute('aria-pressed', String(species === a.draft.species));
    const thumbnail = { species, baseIndex: a.catChoice.base, accIndex: -1, flip: false,
      anim: makeAnimState(species === 'cat' ? 'rest_1' : ANIMAL_SPECIES[species].idle) };
    const ctx = button.querySelector('canvas').getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    drawCharacter(ctx, thumbnail, S.bundle, 0, 0, 64);
  });
  document.querySelectorAll('#appearance-bases button').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.base) === a.draft.base));
  });
  document.getElementById('appearance-accessory').value = String(a.draft.accessory);
  document.querySelectorAll('#appearance-actions button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.action === a.action));
  });
  const available = appearanceAvailable(a.draft, S.bundle);
  document.getElementById('appearance-apply').disabled = S.readOnly || !S.dirHandle || !available;
  document.getElementById('appearance-status').textContent = S.readOnly || !S.dirHandle
    ? '可先預覽；連接資料夾後就能套用形象。'
    : !available ? '這個形象的素材未完整載入，請重新整理後再試。' : '按「套用形象」儲存你的選擇。';
}

function updateAppearanceEditor(dt) {
  const a = APPEARANCE;
  if (!appearanceEditorOpen() || !a.preview) return;
  // 尊重減少動態偏好，仍可切換各種動作查看首幀。
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) updateAnim(a.preview.anim, dt);
  a.ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
  drawCharacter(a.ctx, a.preview, S.bundle, 0, 0, a.canvas.width);
}
