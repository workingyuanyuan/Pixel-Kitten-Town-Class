const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = { console, Math, Date, Number, JSON, Array, Set, String, Object };
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/model.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^const /gm, 'var '), ctx);
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name);
  }
}

console.log('\n=== normalizeAppearance 獨立函式契約 ===');
check('normalizeAppearance 為全域函式', typeof ctx.normalizeAppearance === 'function');
check('absent (undefined) 回傳 null', ctx.normalizeAppearance(undefined) === null);
check('absent (null) 回傳 null', ctx.normalizeAppearance(null) === null);
check('absent (無參數) 回傳 null', ctx.normalizeAppearance() === null);
check('非物件 (字串) 回傳 null', ctx.normalizeAppearance('cat') === null);
check('非物件 (數字) 回傳 null', ctx.normalizeAppearance(123) === null);
check('非物件 (布林) 回傳 null', ctx.normalizeAppearance(true) === null);
check('陣列空值 回傳 null', ctx.normalizeAppearance([]) === null);
check('陣列含值 回傳 null', ctx.normalizeAppearance(['cat', 0, 1]) === null);
check('未知物種 (空物件) 回傳 null', ctx.normalizeAppearance({}) === null);
check('未知物種 (dog) 回傳 null', ctx.normalizeAppearance({ species: 'dog' }) === null);
check('未知物種 (dragon) 回傳 null', ctx.normalizeAppearance({ species: 'dragon' }) === null);
check('未知物種 (大小寫不符 CAT) 回傳 null', ctx.normalizeAppearance({ species: 'CAT' }) === null);
check('未知物種 (含空白) 回傳 null', ctx.normalizeAppearance({ species: 'cat ' }) === null);

console.log('\n=== 貓咪規格化與邊界 ===');
const catValid = ctx.normalizeAppearance({ species: 'cat', base: 1, accessory: 3 });
check('合法貓咪回傳正確物種', catValid && catValid.species === 'cat');
check('合法貓咪回傳正確 base', catValid && catValid.base === 1);
check('合法貓咪回傳正確 accessory', catValid && catValid.accessory === 3);

const rawCat = { species: 'cat', base: 2, accessory: 0, extraProp: 'ignoreMe' };
const normalizedCat = ctx.normalizeAppearance(rawCat);
check('回傳全新物件非原物件引用', normalizedCat !== rawCat);
check('多餘屬性被剔除', normalizedCat && Object.keys(normalizedCat).sort().join(',') === 'accessory,base,species');
check('不修改原輸入物件', rawCat.extraProp === 'ignoreMe');

const catDefault = ctx.normalizeAppearance({ species: 'cat' });
check('缺 base 預設為 0', catDefault && catDefault.base === 0);
check('缺 accessory 預設為 -1', catDefault && catDefault.accessory === -1);

const catMin = ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: -1 });
check('邊界最小值 (base:0, accessory:-1) 保留', catMin && catMin.base === 0 && catMin.accessory === -1);

const maxAccIdx = ctx.CAT_ACCESSORIES.length - 1;
const catMax = ctx.normalizeAppearance({ species: 'cat', base: ctx.CAT_BASES.length - 1, accessory: maxAccIdx });
check('邊界最大值保留', catMax && catMax.base === ctx.CAT_BASES.length - 1 && catMax.accessory === maxAccIdx);

check('base 超過上限重設為 0', ctx.normalizeAppearance({ species: 'cat', base: ctx.CAT_BASES.length, accessory: 0 }).base === 0);
check('base 小於 0 重設為 0', ctx.normalizeAppearance({ species: 'cat', base: -1, accessory: 0 }).base === 0);
check('base 浮點數重設為 0', ctx.normalizeAppearance({ species: 'cat', base: 1.5, accessory: 0 }).base === 0);
check('base 字串數字重設為 0', ctx.normalizeAppearance({ species: 'cat', base: '1', accessory: 0 }).base === 0);
check('base NaN 重設為 0', ctx.normalizeAppearance({ species: 'cat', base: NaN, accessory: 0 }).base === 0);

check('accessory 超過上限重設為 -1', ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: ctx.CAT_ACCESSORIES.length }).accessory === -1);
check('accessory 小於 -1 重設為 -1', ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: -2 }).accessory === -1);
check('accessory 浮點數重設為 -1', ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: 1.5 }).accessory === -1);
check('accessory 字串數字重設為 -1', ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: '2' }).accessory === -1);
check('accessory NaN 重設為 -1', ctx.normalizeAppearance({ species: 'cat', base: 0, accessory: NaN }).accessory === -1);

console.log('\n=== 非貓物種 (bunny, penguin) 規格化 ===');
const bunny = ctx.normalizeAppearance({ species: 'bunny' });
check('bunny 支援且 base 為 0', bunny && bunny.species === 'bunny' && bunny.base === 0);
check('bunny accessory 為 -1', bunny && bunny.accessory === -1);

const bunnyWithExtra = ctx.normalizeAppearance({ species: 'bunny', base: 2, accessory: 5, hat: 'gold' });
check('bunny 的 base 與 accessory 被剝除重設為 0 與 -1', bunnyWithExtra && bunnyWithExtra.base === 0 && bunnyWithExtra.accessory === -1);

const penguin = ctx.normalizeAppearance({ species: 'penguin' });
check('penguin 支援且 base 為 0', penguin && penguin.species === 'penguin' && penguin.base === 0);
check('penguin accessory 為 -1', penguin && penguin.accessory === -1);

const penguinWithExtra = ctx.normalizeAppearance({ species: 'penguin', base: 1, accessory: 10 });
check('penguin 的 base 與 accessory 被剝除重設為 0 與 -1', penguinWithExtra && penguinWithExtra.base === 0 && penguinWithExtra.accessory === -1);

console.log('\n=== normalizeData 整合與容錯 ===');
const mixedDataset = {
  version: 2,
  class_id: 'test-class',
  updated_at: '2026-09-01T00:00:00+08:00',
  students: [
    { id: 's101', seat: 1, name: 'S1', xp: 12, note: 'good' }, // 舊紀錄無外觀
    { id: 's102', seat: 2, name: 'S2', xp: 5, note: '', appearance: { species: 'cat', base: 2, accessory: 4 } }, // 合法貓咪
    { id: 's103', seat: 3, name: 'S3', xp: 8, note: '', appearance: { species: 'bunny', base: 1, accessory: 3 } }, // 兔子帶配件應被剝除
    { id: 's104', seat: 4, name: 'S4', xp: 0, note: '', appearance: { species: 'penguin' } }, // 合法企鵝
    { id: 's105', seat: 5, name: 'S5', xp: 3, note: '', appearance: 'invalid-string' }, // 字串異常
    { id: 's106', seat: 6, name: 'S6', xp: 6, note: '', appearance: ['cat'] }, // 陣列異常
    { id: 's107', seat: 7, name: 'S7', xp: 9, note: '', appearance: { species: 'dragon', base: 0, accessory: -1 } }, // 未知物種
    { id: 's108', seat: 8, name: 'S8', xp: 2, note: '', appearance: null }, // null 異常
  ],
  log: [
    { id: 'e1', ts: '2026-09-01T00:01:00+08:00', student_id: 's101', delta: 3, xp_after: 12, reason: '', undone: false },
    { id: 'e2', ts: '2026-09-01T00:02:00+08:00', student_id: 's102', delta: 1, xp_after: 5, reason: '', undone: false },
  ],
};

const { data: normData } = ctx.normalizeData(mixedDataset, 'test-class');

check('舊格式學生完全省略 appearance 欄位', !Object.prototype.hasOwnProperty.call(normData.students[0], 'appearance'));
check('舊格式學生 in 運算子不包含 appearance', !('appearance' in normData.students[0]));
check('合法貓咪外觀正確保留', normData.students[1].appearance && normData.students[1].appearance.species === 'cat' && normData.students[1].appearance.base === 2 && normData.students[1].appearance.accessory === 4);
check('兔子配件被正確剝除為 base:0, accessory:-1', normData.students[2].appearance && normData.students[2].appearance.species === 'bunny' && normData.students[2].appearance.base === 0 && normData.students[2].appearance.accessory === -1);
check('企鵝外觀正確保留', normData.students[3].appearance && normData.students[3].appearance.species === 'penguin' && normData.students[3].appearance.base === 0 && normData.students[3].appearance.accessory === -1);
check('字串異常外觀被省略', !('appearance' in normData.students[4]));
check('陣列異常外觀被省略', !('appearance' in normData.students[5]));
check('未知物種外觀被省略', !('appearance' in normData.students[6]));
check('null 外觀被省略', !('appearance' in normData.students[7]));

console.log('\n=== 資料完整性與加分/紀錄保留 ===');
check('學生總數保持一致', normData.students.length === mixedDataset.students.length);
check('學生基本欄位 (id, seat, name, xp, note) 保持不變', normData.students[0].id === 's101' && normData.students[0].seat === 1 && normData.students[0].xp === 12);
check('log 紀錄完全保留', normData.log.length === mixedDataset.log.length);
check('log 關聯 student_id 與 delta 正確', normData.log[0].student_id === 's101' && normData.log[0].delta === 3);
check('DATA_VERSION 仍為 2', normData.version === 2);

console.log('\n=== 運算操作 (awardXp, logNote) 與外觀共存 ===');
const awardRes = ctx.awardXp(normData, 's102', 1);
check('有外觀的學生加分成功', awardRes.ok === true && normData.students[1].xp === 6);
check('加分後外觀欄位完好無損', normData.students[1].appearance.species === 'cat' && normData.students[1].appearance.base === 2);

console.log('\n=== JSON 序列化 Roundtrip 驗證 ===');
const jsonString = JSON.stringify(normData);
check('JSON 序列化中舊學生不含 "appearance"', !jsonString.includes('"id":"s101","seat":1,"name":"S1","xp":12,"note":"good","appearance"'));
const reParsed = JSON.parse(jsonString);
const { data: roundtripData } = ctx.normalizeData(reParsed, 'test-class');

check('Roundtrip 後舊學生依舊無 appearance 欄位', !('appearance' in roundtripData.students[0]));
check('Roundtrip 後合法貓咪外觀一致', JSON.stringify(roundtripData.students[1].appearance) === JSON.stringify(normData.students[1].appearance));
check('Roundtrip 後兔子外觀一致', JSON.stringify(roundtripData.students[2].appearance) === JSON.stringify(normData.students[2].appearance));
check('Roundtrip 後企鵝外觀一致', JSON.stringify(roundtripData.students[3].appearance) === JSON.stringify(normData.students[3].appearance));
check('Roundtrip 後分數與紀錄一致', roundtripData.students[1].xp === 6 && roundtripData.log.length === normData.log.length);

for (const species of ['cow', 'goose', 'frog']) {
  const data = ctx.createFreshData('animals', 1);
  data.students[0].appearance = { species, base: 2, accessory: 5 };
  data.students[0].xp = 12;
  const restored = ctx.normalizeData(JSON.parse(JSON.stringify(data)), 'animals').data.students[0];
  check(`${species} 外觀讀取並移除配件`, restored.appearance.species === species && restored.appearance.base === 0 && restored.appearance.accessory === -1);
  check(`${species} 學生與分數完整保留`, restored.id === data.students[0].id && restored.xp === 12);
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
