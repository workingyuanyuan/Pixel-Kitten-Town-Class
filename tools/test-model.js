const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = { console, Math, Date, Number, JSON, Array, Set, String, Object };
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/model.js']) {
  // vm 的 sandbox 不會暴露 const 宣告，改成 var 才能從外面取用
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^const /gm, 'var '), ctx);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n=== 等級推導 ===');
check('xp 0 -> Lv 0', ctx.levelFromXp(0) === 0);
check('xp 2 -> Lv 0（未滿 3 分不升級）', ctx.levelFromXp(2) === 0);
check('xp 3 -> Lv 1', ctx.levelFromXp(3) === 1);
check('xp 29 -> Lv 9', ctx.levelFromXp(29) === 9);
check('xp 30 -> Lv 10', ctx.levelFromXp(30) === 10);
check('xp 999 仍夾在 Lv 10', ctx.levelFromXp(999) === 10);
check('LEVEL_TITLES 有 MAX_LEVEL+1 項', ctx.CONFIG.LEVEL_TITLES.length === ctx.CONFIG.MAX_LEVEL + 1, ctx.CONFIG.LEVEL_TITLES.length);
check('XP_MAX / XP_PER_LEVEL === MAX_LEVEL', ctx.CONFIG.XP_MAX / ctx.CONFIG.XP_PER_LEVEL === ctx.CONFIG.MAX_LEVEL);

console.log('\n=== 加分 ===');
let d = ctx.createFreshData('t', 3);
const id = d.students[0].id;
let r = ctx.awardXp(d, id, 1);
check('加分成功', r.ok === true);
check('xp 變成 1', d.students[0].xp === 1);
check('log 追加一筆', d.log.length === 1);
check('log 記錄 xp_after', d.log[0].xp_after === 1);
check('第一次加分不算升級', r.leveledUp === false);
ctx.awardXp(d, id, 1);
r = ctx.awardXp(d, id, 1);
check('第三次加分觸發升級', r.leveledUp === true && r.toLevel === 1, r);
check('log 累積三筆', d.log.length === 3);

console.log('\n=== 滿分封頂 ===');
d = ctx.createFreshData('t', 1);
const id2 = d.students[0].id;
for (let i = 0; i < 40; i++) ctx.awardXp(d, id2, 1);
check('xp 停在 XP_MAX', d.students[0].xp === ctx.CONFIG.XP_MAX, d.students[0].xp);
check('等級停在 MAX_LEVEL', ctx.levelFromXp(d.students[0].xp) === ctx.CONFIG.MAX_LEVEL);
check('log 只有 XP_MAX 筆（封頂後不再寫紀錄）', d.log.length === ctx.CONFIG.XP_MAX, d.log.length);
r = ctx.awardXp(d, id2, 1);
check('封頂後回傳 maxed 且不改變資料', r.ok === false && r.reason === 'maxed');
check('isMaxed 為 true', ctx.isMaxed(d.students[0]) === true);

console.log('\n=== schema 容錯 ===');
const messy = {
  students: [
    { name: '甲', xp: 5 },                        // 缺 id / seat
    { id: 'dup', seat: 2, name: '乙', xp: '7' },  // xp 是字串
    { id: 'dup', seat: 3, name: '丙', xp: -4 },   // id 重複 + 負分
    { id: 'x4', seat: 4, name: '丁', xp: 999 },   // 超過上限
    'not an object',
  ],
  log: [
    { id: 'e1', student_id: 'x4', delta: 1, xp_after: 1 },
    null,
  ],
};
const { data: nd, warnings } = ctx.normalizeData(messy, 'cls');
check('略過非物件的學生', nd.students.length === 4, nd.students.length);
check('自動補 id', !!nd.students[0].id);
check('自動補 seat', nd.students[0].seat === 1);
check('字串分數轉成數字', nd.students[1].xp === 7);
check('負分修正為 0', nd.students[2].xp === 0);
check('超過上限夾到 XP_MAX', nd.students[3].xp === ctx.CONFIG.XP_MAX);
check('重複 id 被改掉', nd.students[1].id !== nd.students[2].id);
check('有效紀錄保留', nd.log.length === 1, nd.log.length);
check('有發出警告', warnings.length >= 5, warnings.length);
check('version 標成 2', nd.version === 2);

console.log('\n=== 紀錄只增不減 ===');
d = ctx.createFreshData('t', 2);
const a = d.students[0].id, b = d.students[1].id;
ctx.awardXp(d, a, 1); ctx.awardXp(d, b, 1); ctx.awardXp(d, a, 1);
check('recentLogFor 只取該學生', ctx.recentLogFor(d, a, 10).length === 2);
check('recentLogFor 新的在前', ctx.recentLogFor(d, a, 10)[0].xp_after === 2);
check('log 全域仍有 3 筆', d.log.length === 3);
const ids = new Set(d.log.map(e => e.id));
check('每筆 log 的 id 唯一', ids.size === 3);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
