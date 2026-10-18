import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchFixtureBrowser,createFixtureContext} from './desktop-ui-browser.mjs';
import {measureMobileChrome} from './measure-mobile-chrome.mjs';
const output=process.env.VOLTIUS_UI_EVIDENCE||'mobile-chrome-evidence',baseline=process.argv.includes('--baseline');await mkdir(output,{recursive:true});
const browser=await launchFixtureBrowser(),results=[];
try {
 for(const viewport of (baseline?[{width:393,height:852}]:[{width:393,height:852},{width:320,height:640},{width:844,height:390},{width:640,height:360},{width:717,height:512}])) for(const dpr of (baseline?[1]:[1,2,3])) {
  const context=await createFixtureContext(browser,{viewport,deviceScaleFactor:dpr,isMobile:true,hasTouch:true}),page=await context.newPage();await page.goto('http://127.0.0.1:1428/tests/desktop-ui/index.html?mobile-tabs=1');await page.waitForFunction(()=>window.__mobileTabFixture);await page.locator('[data-mobile-panel-quick] svg').first().waitFor({state:'attached',timeout:1000}).catch(()=>{});
  for(const model of (baseline?['text']:['text','root'])) for(const scale of (baseline?[1]:[1,1.5,2,3])) for(const keyboard of [false,true]) for(const panels of [true,false]) {
   await page.evaluate(({model,scale,keyboard,panels})=>{document.documentElement.style.fontSize=`${15*(model==='root'?scale:1)}px`;document.querySelector('main').style.setProperty('--fixture-font-scale',String(model==='text'?scale:1));window.__mobileTabFixture.setKeyboard(keyboard);window.__mobileTabFixture.setPanels(panels);},{model,scale,keyboard,panels});
   await page.waitForFunction(k=>document.querySelector('main').dataset.keyboardOpen===String(k),keyboard);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   const positions=baseline?['start']:['start','middle','end'];
   for(const position of positions){await page.evaluate(position=>{for(const n of document.querySelectorAll('[data-mobile-panels-row],[data-mobile-key-scroll="true"]')) n.scrollLeft=(n.scrollWidth-n.clientWidth)*({start:0,middle:.5,end:1}[position]);},position);await page.evaluate(()=>new Promise(requestAnimationFrame));const m=await page.evaluate(measureMobileChrome);results.push({viewport,dpr,model,scale,keyboard,panels,position,...m});
    if(!baseline){assert(m.gaps.every(g=>Math.abs(g-6)<.6),'all measured horizontal gaps are 6px');assert(Math.abs(m.seam-6)<.6,'pinned modifier seam is 6px');for(const t of m.tabs)if(t.underline&&Number.isFinite(t.gap))assert(t.gap>=2.5,`tab ink gap ${t.gap}`);if(panels){assert(Math.abs(m.panels.height-m.keys.height)<.6,'equal row height');assert.deepEqual(m.panels.padding,m.keys.padding,'equal all container padding');for(const row of [m.panels,m.keys]){assert(row.controls.every(b=>b.height>=40),'40px non-overlapping touch targets');assert(row.controls.every(b=>Math.abs(b.faceTop-row.y-3)<.6&&Math.abs(row.bottom-b.faceBottom-3)<.6),'equal top/bottom border-to-face spacing');assert(row.controls.every(b=>Math.abs(b.faceHeight-row.controls[0].faceHeight)<.6),'shared face heights');}if(position==='start')assert(Math.abs(m.panels.controls[0].x-m.panels.x-3)<.6&&Math.abs(m.keys.controls[0].x-m.keys.x-3)<.6,'same leading face inset');if(position==='end')assert(Math.abs(m.panels.right-m.panels.controls.at(-1).right-3)<.6,'trailing panel face inset');assert(Math.abs(m.panels.controls[0].faceHeight-m.keys.controls[0].faceHeight)<.6,'equal faces between rows');}
    }
   }
   if(dpr===1&&model==='text'&&[1,2].includes(scale)&&!keyboard&&panels){await page.evaluate(()=>{for(const n of document.querySelectorAll('[data-mobile-panels-row],[data-mobile-key-scroll="true"]'))n.scrollLeft=0;});await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-${viewport.width}-font${scale}.png`)});}
  }
  await context.close();
 }
 await writeFile(path.join(output,baseline?'BASELINE.json':'CHROME-VALIDATION.json'),JSON.stringify({source_sha:process.env.GITHUB_SHA??null,scope:'Synthetic normally sandboxed Chromium. CSS px; Android WebView, native IME and device not tested.',scenarios:results.length,results},null,2));console.log(JSON.stringify({baseline,scenarios:results.length,status:'passed'}));
}catch(error){await writeFile(path.join(output,'FAILURE.json'),JSON.stringify({error:String(error),latest:results.at(-1)},null,2));throw error;}finally{await browser.close();}
