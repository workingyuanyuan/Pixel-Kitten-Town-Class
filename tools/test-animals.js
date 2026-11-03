/* node tools/test-animals.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console });
for (const name of ['config', 'anims', 'animals', 'assets', 'model', 'map', 'cats', 'catfx']) {
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
// Top-scorer halo: ties share it, nobody has it while everyone is at 0, and it follows score changes.
run(`
  const topCats = createCats([0, 0, 0].map((xp, i) => ({ id: 'top-' + i, seat: i + 1, name: '', xp })), testMap, {});
  updateCats(topCats, 0.01, testMap);
`);
assert.equal(run('JSON.stringify(topCats.map(c => c.isTop))'), JSON.stringify([false, false, false]));
run('topCats[0].student.xp = 4; topCats[2].student.xp = 4; updateCats(topCats, 0.01, testMap)');
assert.equal(run('JSON.stringify(topCats.map(c => c.isTop))'), JSON.stringify([true, false, true]));
run('topCats[1].student.xp = 5; updateCats(topCats, 0.01, testMap)');
assert.equal(run('JSON.stringify(topCats.map(c => c.isTop))'), JSON.stringify([false, true, false]));
run('CONFIG.TOP_HALO = false; updateCats(topCats, 0.01, testMap)');
assert.equal(run('JSON.stringify(topCats.map(c => c.isTop))'), JSON.stringify([false, false, false]));
run('CONFIG.TOP_HALO = true');
// Every level from 1 up unlocks exactly one persistent effect, in level order.
assert.equal(run('JSON.stringify(LEVEL_FX.map(f => f.level))'), JSON.stringify(Array.from({ length: run('CONFIG.MAX_LEVEL') }, (_, i) => i + 1)));
assert.equal(run("hasLevelFx(0, 'sprout')"), false);
assert.equal(run("hasLevelFx(1, 'sprout')"), true);
assert.equal(run("hasLevelFx(4, 'sunflower')"), false);
assert.equal(run("nextLevelFx(4).key"), 'sunflower');
assert.equal(run('nextLevelFx(10)'), null);
// Animals mix their flourish into idle from Lv3, never below.
run(`
  const penguin = testCats[2]; penguin.drowsy = false;
  penguin.student.xp = 6;  // Lv2
  var lowPicks = new Set(); for (let n = 0; n < 60; n++) lowPicks.add(pickIdle(penguin));
  penguin.student.xp = 9;  // Lv3
  var highPicks = new Set(); for (let n = 0; n < 60; n++) highPicks.add(pickIdle(penguin));
  penguin.drowsy = true;
  var sleepyPicks = new Set(); for (let n = 0; n < 60; n++) sleepyPicks.add(pickIdle(penguin));
`);
assert.deepEqual(Array.from(run('[...lowPicks]')), ['penguin_idle']);
assert.deepEqual(Array.from(run('[...highPicks].sort()')), ['penguin_flap', 'penguin_idle']);
assert.deepEqual(Array.from(run('[...sleepyPicks]')), ['penguin_idle']);
// An idle frog flourish finishes its landing before the next idle pick.
run(`
  const idleFrog = testCats[5]; idleFrog.drowsy = false; idleFrog.mode = 'idle';
  idleFrog.anim = makeAnimState('frog_hop'); idleFrog.anim.frame = 3; idleFrog.timer = 0;
  updateCats([idleFrog], 0.001, testMap);
`);
assert.equal(run('idleFrog.anim.name'), 'frog_hop', 'idle hop must not snap to the ground mid-air');
// Effect renderers run for every level and species without touching unknown canvas APIs.
const fxCtx = { save(){}, restore(){}, fillRect(){}, beginPath(){}, ellipse(){}, arc(){}, fill(){}, moveTo(){}, lineTo(){},
  createRadialGradient(){ return { addColorStop(){} }; }, globalAlpha: 1, fillStyle: '' };
ctx.fxCtx = fxCtx;
for (let xp = 0; xp <= 30; xp += 3) {
  run(`for (const c of testCats) { c.student.xp = ${xp}; c.isTop = true; c.isStar = ${xp % 9 === 0}; c.drowsy = ${xp % 6 === 0};
    drawCatGarden(fxCtx, c, 0, 0); drawCatFxBack(fxCtx, c, 0, 0); drawCatFxFront(fxCtx, c, 0, 0); }`);
}
// Nothing but the shadow belongs right under the feet: no effect pixel lands there.
const feetHits = [];
const probe = { ...fxCtx, fillRect(px, py) { if (px >= 9 && px <= 23 && py >= 27 && py <= 32) feetHits.push([px, py]); },
  arc(cx, cy, r) { if (cy + r >= 27) feetHits.push(['arc', cx, cy, r]); } };
ctx.probe = probe;
for (let xp = 0; xp <= 30; xp += 3) {
  for (let step = 0; step < 40; step++) {
    run(`CAT_FX.t = ${step * 0.37}; for (const c of testCats) { c.student.xp = ${xp}; c.isTop = true; c.isStar = true;
      drawCatGarden(probe, c, 0, 0); drawCatFxBack(probe, c, 0, 0); drawCatFxFront(probe, c, 0, 0); }`);
  }
}
assert.deepEqual(feetHits, [], 'effects must leave the feet area to the shadow');
console.log('Animal movement, reactions, blocked paths, frame geometry, accessory isolation, level effects and top halo passed.');
