/* node tools/test-animals.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console });
for (const name of ['config', 'anims', 'animals', 'assets', 'model', 'map', 'cats']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx);
}
const run = code => vm.runInContext(code, ctx);
run(`
  const testMap = { cols: 12, rows: 8, blocked: Array.from({length:8}, () => Array(12).fill(false)) };
  const testStudents = ['cat','bunny','penguin','cow','goose','frog'].map((species,i) => ({
    id: 'test-'+i, seat: i+1, name:'', xp:15, appearance:{species,base:1,accessory:3}
  }));
  const testCats = createCats(testStudents, testMap, {});
`);
assert.equal(run('testCats[0].accIndex'), 3);
assert.equal(run('testCats[1].accIndex'), -1);
assert.equal(run('testCats[2].accIndex'), -1);
assert.equal(run('testCats[1].anim.name'), 'bunny_idle');
assert.equal(run('testCats[2].anim.name'), 'penguin_idle');
for (const i of [1, 2, 3, 4, 5]) {
  assert.equal(run(`testCats[${i}].accIndex`), -1);
  run(`for(let n=0;n<100 && testCats[${i}].mode!=='walk';n++) startWalk(testCats[${i}],testMap)`);
  assert.equal(run(`testCats[${i}].mode`), 'walk');
  assert.equal(run(`testCats[${i}].targetY === testCats[${i}].y`), true);
  assert.equal(run(`testCats[${i}].flip === (testCats[${i}].targetX > testCats[${i}].x)`), ![3,4].includes(i));
  const initialY = run(`testCats[${i}].y`);
  run(`for(let n=0;n<500;n++) updateCats([testCats[${i}]],1/60,testMap)`);
  assert.equal(run(`testCats[${i}].y`), initialY);
  run(`testCats[${i}].drowsy=true; enterIdle(testCats[${i}]);`);
  const x = run(`testCats[${i}].x`);
  run(`for(let n=0;n<500;n++) updateCats([testCats[${i}]],1/60,testMap)`);
  assert.equal(run(`testCats[${i}].x`), x);
  run(`playAward(testCats[${i}],1); playLevelUp(testCats[${i}]);`);
  assert.equal(run(`testCats[${i}].anim.name`), ['','bunny_walk','penguin_flap','cow_idle','goose_flap','frog_hop'][i]);
  run(`playNote(testCats[${i}]);`);
  assert.equal(run(`testCats[${i}].anim.name`), ['','bunny_idle','penguin_idle','cow_idle','goose_idle','frog_idle'][i]);
}
run(`
  const blockedMap = { ...testMap, blocked: Array.from({length:8}, () => Array(12).fill(true)) };
  testCats[1].drowsy=false; startWalk(testCats[1],blockedMap);
`);
assert.equal(run('testCats[1].mode'), 'idle');
// Source sheet geometry and all animation references must be valid PNG frames.
for (const anim of run('Object.values(ANIMAL_ANIMS)')) {
  if (anim.sequence) {
    assert.equal(anim.sequence.length, anim.frames);
    for (const step of anim.sequence) assert.ok(run(`ANIMAL_ANIMS['${step.anim}'].frames`) > step.frame);
    continue;
  }
  const png = fs.readFileSync(path.join(root, anim.path));
  assert.equal(png.readUInt32BE(16), anim.frames * 64);
  assert.equal(png.readUInt32BE(20), 64 * (anim.sheetRows || 1));
}
assert.throws(() => run("makeAnimState('ko')"), /禁用/);
assert.throws(() => run("makeAnimState('penguin_death')"), /未知/);
run("const testAnim=makeAnimState('penguin_walk');updateAnim(testAnim,1)");
assert.equal(run('testAnim.frame'), 0);
// Renderer must never draw accessory images for noncats, even with a stale index.
const draws = [];
ctx.mockCtx = { save(){}, restore(){}, translate(){}, scale(){}, drawImage(...args){draws.push(args)}, fillRect(){} };
run(`const testBundle={bases:['cat'],accessories:['hat'],animals:{bunny_idle:'bunny'}};
  drawCharacter(mockCtx,{species:'bunny',baseIndex:0,accIndex:0,anim:makeAnimState('bunny_idle')},testBundle,0,0);`);
assert.equal(draws.length, 1);
assert.equal(draws[0][0], 'bunny');
assert.deepEqual(draws[0].slice(1, 5), [16, 12, 32, 32]);
run(`
  const frog=testCats[5];frog.drowsy=false;frog.mode='walk';
  frog.anim=makeAnimState('frog_hop');frog.anim.frame=2;
  frog.targetX=frog.x+0.01;frog.targetY=frog.y;
  updateCats([frog],0.01,testMap);
`);
assert.equal(run('frog.mode'), 'walk', 'finish airborne phase after reaching destination');
run('frog.anim.frame=6;updateCats([frog],0.01,testMap)');
assert.equal(run('frog.mode'), 'walk', 'show first landing pose');
run('frog.anim.frame=7;updateCats([frog],0.01,testMap)');
assert.equal(run('frog.mode'), 'walk', 'show second landing pose');
run('frog.anim.frame=0;updateCats([frog],0.01,testMap)');
assert.equal(run('frog.mode'), 'idle');
run("frog.mode='walk';frog.anim=makeAnimState('frog_hop');frog.anim.frame=6;frog.targetX=frog.x+32;");
const groundedX = run('frog.x');
run('updateCats([frog],0.01,testMap)');
assert.equal(run('frog.x'), groundedX, 'no horizontal travel during landing');
run("playLevelUp(frog)");
assert.equal(run('frog.anim.frame'), 0);
assert.equal(run('frog.timer'), 0.8);
console.log('Animal movement, reactions, blocked paths, frame geometry and accessory isolation passed.');
