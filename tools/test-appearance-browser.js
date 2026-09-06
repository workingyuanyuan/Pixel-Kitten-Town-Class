/* Requires Playwright (npm install playwright in a temporary directory).
 * PLAYWRIGHT_MODULE may point to that directory's node_modules/playwright.
 * Uses installed Chrome, or BROWSER_EXECUTABLE. All class files are synthetic
 * and held in a test-only memory filesystem. No classroom files are read/written.
 * Optional TEST_SCREENSHOTS directory receives desktop/mobile screenshots.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const initial = { version:2, class_id:'class-data', students:[
  {id:'fixture-1',seat:1,name:'測試居民',xp:0,note:''},
  {id:'fixture-2',seat:2,name:'兔子居民',xp:15,note:'',appearance:{species:'bunny',base:0,accessory:-1}},
  {id:'fixture-3',seat:3,name:'企鵝居民',xp:30,note:'',appearance:{species:'penguin',base:0,accessory:-1}},
], log:[] };
const files = new Map([['class-data.json', JSON.stringify(initial)],
  ['other-class.json', JSON.stringify({...initial,class_id:'other-class'})]]);
let failWrites = false;
const server = http.createServer((req,res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/data/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(initial)); return; }
  const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403);res.end();return; }
  fs.readFile(file,(err,body) => {
    res.writeHead(err ? 404 : 200, {'Content-Type': {'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'}[path.extname(file)] || 'text/plain'});
    res.end(err ? '' : body);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE
    ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'chrome'})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.exposeFunction('__fixtureRead', name => files.get(name) ?? null);
    await page.exposeFunction('__fixtureWrite', (name,text) => {
      if (failWrites) throw new Error('Simulated write failure');
      files.set(name,text);
    });
    await page.exposeFunction('__fixtureList', prefix => [...files.keys()].filter(n=>n.startsWith(prefix)).map(n=>n.slice(prefix.length)));
    await page.addInitScript(() => {
      function dir(prefix='') {
        return {kind:'directory',name:'test-only',
          async queryPermission(){return 'granted'},async requestPermission(){return 'granted'},
          async *entries(){for(const name of await window.__fixtureList(prefix)) if(!name.includes('/')) yield [name,{kind:'file'}]},
          async getDirectoryHandle(name){return dir(prefix+name+'/')},
          async getFileHandle(name,options={}) {
            const key=prefix+name;
            if(await window.__fixtureRead(key)===null && !options.create) throw new DOMException('Missing','NotFoundError');
            return {kind:'file',name,
              async getFile(){const text=await window.__fixtureRead(key);return {async text(){return text}}},
              async createWritable(){let text;return {async write(value){text=value},async close(){await window.__fixtureWrite(key,text)}}}
            };
          }
        };
      }
      window.showDirectoryPicker = async () => dir();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => S.cats.length===3 && S.bundle);
    const open = async () => {
      await page.evaluate(() => openPanel(S.cats[0]));
      assert.equal(await page.evaluate(() => document.getElementById('panel').lastElementChild.id), 'panel-footer');
      await page.getByRole('button',{name:'編輯形象',exact:true}).click();
    };
    await open();
    assert.equal(await page.getByRole('button',{name:'套用形象',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'兔子',exact:true}).click();
    assert.equal(await page.locator('#appearance-cat-options').isVisible(),false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => S.data.students[0].appearance),undefined);
    await page.locator('#panel-close').click();
    await page.locator('#btn-connect').click();
    await page.waitForFunction(() => !S.readOnly);
    await open();
    await page.getByRole('button',{name:'貓咪',exact:true}).click();
    await page.getByRole('button',{name:'橘貓',exact:true}).click();
    await page.locator('#appearance-accessory').selectOption('3');
    await page.getByRole('button',{name:'走路',exact:true}).click();
    if(process.env.TEST_SCREENSHOTS) {
      fs.mkdirSync(process.env.TEST_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,'appearance-cat.png')});
    }
    await page.getByRole('button',{name:'套用形象',exact:true}).click();
    await page.waitForFunction(() => !isDirty());
    assert.deepEqual(JSON.parse(files.get('class-data.json')).students[0].appearance,{species:'cat',base:1,accessory:3});
    assert.equal(JSON.parse(files.get('class-data.json')).log.length,0);
    await open();
    await page.getByRole('button',{name:'兔子',exact:true}).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => APPEARANCE.draft.species),'bunny');
    assert.equal(await page.evaluate(() => S.data.students[0].xp),0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => APPEARANCE.dialog.contains(document.activeElement)),true);
    await page.getByRole('button',{name:'企鵝',exact:true}).click();
    await page.getByRole('button',{name:'加分',exact:true}).click();
    assert.equal(await page.locator('#appearance-cat-options').isVisible(),false);
    if(process.env.TEST_SCREENSHOTS) {
      fs.mkdirSync(process.env.TEST_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,'appearance-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,'appearance-mobile.png')});
      const fits=await page.locator('#appearance-dialog').evaluate(el=>el.scrollWidth===el.clientWidth);
      assert.equal(fits,true);
      await page.setViewportSize({width:1440,height:1000});
    }
    await page.getByRole('button',{name:'套用形象',exact:true}).click();
    await page.waitForFunction(() => !isDirty());
    assert.deepEqual(JSON.parse(files.get('class-data.json')).students[0].appearance,{species:'penguin',base:0,accessory:-1});
    await page.reload();
    await page.waitForFunction(() => S.cats.length===3);
    await page.locator('#btn-connect').click();
    await page.waitForFunction(() => !S.readOnly);
    assert.equal(await page.evaluate(() => S.cats[0].species),'penguin');
    await page.locator('#class-select').selectOption('other-class');
    await page.waitForFunction(() => S.classId==='other-class' && S.cats[0].species==='cat');
    await page.locator('#class-select').selectOption('class-data');
    await page.waitForFunction(() => S.classId==='class-data' && S.cats[0].species==='penguin');
    await open();
    await page.getByRole('button',{name:'兔子',exact:true}).click();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.evaluate(() => S.cats[0].species),'penguin');
    await page.getByRole('button',{name:'＋1',exact:true}).click();
    assert.equal(await page.evaluate(() => S.cats[0].anim.name),'penguin_flap');
    await page.evaluate(() => { award('fixture-1',1);award('fixture-1',1); });
    assert.equal(await page.evaluate(() => S.data.students[0].xp),3);
    assert.equal(await page.evaluate(() => S.cats[0].anim.name),'penguin_flap');
    await page.evaluate(() => { for(let i=0;i<4;i++) logNoteFor('fixture-1','測試登記'); });
    assert.equal(await page.evaluate(() => S.cats[0].drowsy),true);
    assert.equal(await page.evaluate(() => S.cats[0].mode),'idle');
    await page.waitForFunction(() => !isDirty());
    // Every original animation pixel must fit the fixed crop, for every frame.
    assert.equal(await page.evaluate(() => Object.entries(ANIMAL_ANIMS).every(([name,a]) => {
      if (!a.path) return true;
      const c=document.createElement('canvas');c.width=c.height=64;
      const ctx=c.getContext('2d');
      for(let f=0;f<a.frames;f++) {
        ctx.clearRect(0,0,64,64);ctx.drawImage(S.bundle.animals[name],f*64,0,64,64,0,0,64,64);
        const data=ctx.getImageData(0,0,64,64).data;
        for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(data[(y*64+x)*4+3] && (x<(a.cropX??16)||x>=(a.cropX??16)+32||y<a.cropY||y>=a.cropY+32))return false;
      }return true;
    })),true);
    // Read-only mutation guard, even if a caller bypasses the disabled button.
    assert.equal(await page.evaluate(() => {
      S.readOnly=true;const ok=saveAppearance(S.data.students[0],{species:'bunny'});S.readOnly=false;return ok;
    }),false);
    await open();
    await page.getByRole('button',{name:'兔子',exact:true}).click();
    await page.evaluate(() => { window.savedAsset=S.bundle.animals.bunny_walk;S.bundle.animals.bunny_walk=null;refreshAppearanceOptions(); });
    assert.equal(await page.getByRole('button',{name:'套用形象',exact:true}).isDisabled(),true);
    await page.evaluate(() => {S.bundle.animals.bunny_walk=window.savedAsset;refreshAppearanceOptions()});
    failWrites=true;
    await page.getByRole('button',{name:'套用形象',exact:true}).click();
    await page.waitForFunction(() => document.getElementById('save-state').textContent==='存檔失敗');
    assert.equal(await page.evaluate(() => isDirty()),true);
    assert.equal(JSON.parse(files.get('class-data.json')).students[0].appearance.species,'penguin');
    failWrites=false;
    await page.evaluate(() => doSave());
    assert.equal(JSON.parse(files.get('class-data.json')).students[0].appearance.species,'bunny');
    await page.evaluate(() => hideBanner()); // 結束模擬失敗情境，開始新動物驗證
    for (const [species,label] of [['cow','牛'],['goose','鵝'],['frog','青蛙']]) {
      await open();
      assert.equal(await page.locator('#appearance-species button').count(),6);
      await page.getByRole('button',{name:label,exact:true}).click();
      assert.equal(await page.locator('#appearance-cat-options').isVisible(),false);
      for (const action of ['待機','走路','加分']) await page.getByRole('button',{name:action,exact:true}).click();
      if(process.env.TEST_SCREENSHOTS) {
        await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,`appearance-${species}.png`)});
        if (species==='goose') {
          await page.setViewportSize({width:390,height:844});
          await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,'appearance-six-mobile.png')});
          assert.equal(await page.locator('#appearance-dialog').evaluate(el=>el.scrollWidth===el.clientWidth),true);
          await page.setViewportSize({width:1440,height:1000});
        }
      }
      if (species==='frog') {
        await page.evaluate(() => {window.frogLand=S.bundle.animals.frog_land;S.bundle.animals.frog_land=null;refreshAppearanceOptions()});
        assert.equal(await page.getByRole('button',{name:'套用形象',exact:true}).isDisabled(),true);
        await page.evaluate(() => {S.bundle.animals.frog_land=window.frogLand;refreshAppearanceOptions()});
      }
      await page.getByRole('button',{name:'套用形象',exact:true}).click();
      await page.waitForFunction(() => !isDirty());
      assert.deepEqual(JSON.parse(files.get('class-data.json')).students[0].appearance,{species,base:0,accessory:-1});
      await page.locator('#btn-reload').click();
      await page.waitForFunction(s => S.cats[0].species===s, species);
    }
    if(process.env.TEST_SCREENSHOTS) {
      await page.evaluate(() => {hideBanner();openPanel(S.cats[0]);document.getElementById('panel').scrollTop=10000});
      await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS,'panel-footer.png')});
    }
    assert.deepEqual(errors,[]);
    console.log('Browser: preview, keyboard, cancel, save/reload, class switch, reactions, crop bounds, read-only and write failure recovery passed.');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>server.close());
