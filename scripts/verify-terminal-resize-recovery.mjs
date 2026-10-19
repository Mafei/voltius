// Optional standalone diagnostic. Does not run a Mac or change production behavior.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {launchFixtureBrowser,createFixtureContext} from './desktop-ui-browser.mjs';
const output=path.resolve(process.env.VOLTIUS_UI_EVIDENCE??'resize-recovery-evidence');await mkdir(output,{recursive:true});
const seconds=Number(process.env.VOLTIUS_DIAGNOSTIC_SECONDS??180),browser=await launchFixtureBrowser();
const comparisons=[],actions=['none','refresh','atlas-rebuild','fit-unchanged','fit-resize','vt-repaint'];
function pixels(a,b){const r=spawnSync('python3',['-c',`from PIL import Image
import sys,json,hashlib
a,b=[Image.open(p).convert('RGBA') for p in sys.argv[1:]]
x=a.tobytes();y=b.tobytes();delta=[max(abs(x[i+k]-y[i+k]) for k in range(3)) for i in range(0,min(len(x),len(y)),4)]
print(json.dumps({'same_size':a.size==b.size,'different_pixels':sum(d>0 for d in delta) if a.size==b.size else -1,'significant_pixels':sum(d>1 for d in delta) if a.size==b.size else -1,'max_channel_delta':max(delta,default=0),'comparison_tolerance_lsb':1,'a_sha256':hashlib.sha256(x).hexdigest(),'b_sha256':hashlib.sha256(y).hexdigest()}))`,a,b],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout);}

try{
 const context=await createFixtureContext(browser,{viewport:{width:1000,height:800},deviceScaleFactor:Number(process.env.VOLTIUS_DIAGNOSTIC_DPR??1),userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:1431/tests/terminal-render/resize-recovery.html');await page.waitForFunction(()=>window.__resizeRecovery);await page.evaluate(()=>window.__resizeRecovery.init());
 const initial=await page.evaluate(()=>window.__resizeRecovery.state()),environment=await page.evaluate(()=>window.__resizeRecovery.environment());
 const shot=async (name,reference=false)=>{const file=path.join(output,name+'.png');await page.screenshot({path:file,clip:{x:16,y:reference?400:48,width:720,height:320}});return file;};
 const started=Date.now();let next=0,updates=0,lastTick={updates:0,wire_chunks:0};
 const snapshot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const state=await page.evaluate(()=>window.__resizeRecovery.state());assert.deepEqual(state.css,initial.css);assert.deepEqual(state.canvas,initial.canvas);assert.equal(state.cols,initial.cols);assert.equal(state.rows,initial.rows);assert.equal(state.gl_error,0);assert.equal(state.context_lost,false);const actual=await shot(name+'-actual');const entry={elapsed_ms:Date.now()-started,...lastTick,state,actual};comparisons.push(entry);console.log(JSON.stringify({fixed_window_checkpoint:updates,elapsed_ms:entry.elapsed_ms,buffer_verified:true}));};
 // The fixed-window interval never hides/resizes/refits the primary terminal or
 // creates another renderer. Independent references are generated afterwards.
 while(Date.now()-started<seconds*1000){lastTick=await page.evaluate(()=>window.__resizeRecovery.tick());updates=lastTick.updates;if(Date.now()-started>=next){await snapshot('fixed-'+updates);next+=30000;}await page.waitForTimeout(35);}
 await snapshot('fixed-end');
 for(const entry of comparisons){await page.evaluate(lines=>window.__resizeRecovery.reference(lines),entry.state.lines);const fresh=await shot('reference-'+entry.updates,true);await page.evaluate(()=>window.__resizeRecovery.releaseReference());entry.pixels=pixels(entry.actual,fresh);assert.equal(entry.pixels.significant_pixels,0,'independent-atlas reference must match fixed-window checkpoint');}
 await page.evaluate(()=>window.__resizeRecovery.save());const tests=[];
 for(const fault of ['none','framebuffer','gpu-atlas'])for(const action of actions){await page.evaluate(()=>window.__resizeRecovery.resetCase());const healthy=await shot('healthy-'+fault+'-'+action);if(fault!=='none')await page.evaluate(f=>window.__resizeRecovery.fault(f),fault);const damaged=await shot('before-'+fault+'-'+action);const exposed=pixels(healthy,damaged);if(fault!=='none')assert(exposed.significant_pixels>0,'injected fault must be visible');const result=await page.evaluate(a=>window.__resizeRecovery.action(a),action);const after=await shot('after-'+fault+'-'+action);const diff=pixels(healthy,after);assert.deepEqual(result.before.lines,result.after.lines,'action must preserve buffer text');assert.equal(result.after.gl_error,0);if(fault==='none'||(fault==='framebuffer'&&action==='refresh')||(fault==='gpu-atlas'&&action==='atlas-rebuild'))assert.equal(diff.significant_pixels,0,`expected recovery ${fault}/${action}`);tests.push({fault,action,exposed_pixels:exposed.different_pixels,pixels:diff,restored:diff.significant_pixels===0,...result});console.log(JSON.stringify({fault,action,restored:diff.significant_pixels===0,renders:result.after.renders-result.before.renders}));}
 assert.deepEqual(errors,[]);const report={scope:environment,pixel_comparison:'Raw differences/hashes retained; >1/255 RGB-channel differences gate significant mismatch. Independent atlas placement showed only 1-LSB antialias sampling variation during initial controls.',seconds,elapsed_ms:Date.now()-started,updates,fixed_window_checks:comparisons.length,comparisons,tests,errors,original_user_symptom_reproduced:false,notice:'Controlled framebuffer/GPU-atlas fault injection is not reproduction of the user incident. Synthetic VT repaint sends no data to any real remote shell. No periodic resize workaround or production changes.'};await writeFile(path.join(output,'RESIZE-RECOVERY-VALIDATION.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({diagnostic:'passed',seconds,updates,tests:tests.length,scope:environment}));
}catch(error){await writeFile(path.join(output,'FAILURE.json'),JSON.stringify({error:String(error),comparisons},null,2));throw error;}finally{await browser.close();}
