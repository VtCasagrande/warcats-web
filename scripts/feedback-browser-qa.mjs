import {chromium} from 'playwright';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.stack));
try{
 await page.goto('http://localhost:5173/artifacts/competitive/feedback.html');await page.waitForFunction(()=>window.feedback&&!document.getElementById('loading'));
 await page.waitForTimeout(800);await page.evaluate(()=>feedback.show());await page.waitForFunction(()=>document.querySelectorAll('.threat-arc').length===2);
 const initial=await page.locator('.threat-arc').evaluateAll(nodes=>nodes.map(n=>({kind:n.getAttribute('class'),rotation:n.getAttribute('transform')})));
 await page.screenshot({path:'artifacts/competitive/directional-feedback.png'});
 await page.evaluate(()=>{feedback.me.yaw=-Math.PI/2;feedback.input.yaw=-Math.PI/2;});await page.waitForTimeout(100);
 const rotated=await page.locator('.threat-arc').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));assert.notDeepEqual(initial.map(v=>v.rotation),rotated);
 await page.evaluate(()=>feedback.setTime(22));await page.waitForTimeout(100);assert.equal(await page.locator('.threat-arc').count(),0);
 // Verify one actual near-miss sound at its exact XYZ and separation from delayed gun reports.
 const sound=await page.evaluate(async()=>{
  const {audio,me,sim}=feedback;await audio.enable();audio.world(sim.state,me,false,1/60);const calls=[];audio.sample=(name,volume,pan)=>{calls.push({name,volume,pan});return {};};
  audio.event({id:710,type:'nearMiss',time:22,x:me.x+.8,y:1.4,z:me.z,player:'other',target:me.id,weapon:'ar',value:.8},me);
  const count=calls.length;audio.event({id:711,type:'shot',time:22,x:me.x+100,y:2,z:me.z,player:'other',team:1,weapon:'ar'},me);
  const delay=calls.length===count;sim.state.time=22.4;audio.world(sim.state,me,false,1/60);
  return {nearMiss:calls.find(c=>c.name==='bullet-crack'),delayedGun:delay};
 });assert.ok(sound.nearMiss);assert.equal(sound.nearMiss.pan.x,205.8);assert.ok(sound.delayedGun);
 assert.deepEqual(errors,[]);await writeFile('artifacts/competitive/feedback-browser.json',JSON.stringify({initial,rotated,expired:true,sound,errors},null,2));console.log('PASS ring directions, camera rotation, expiry, exact near-miss sound location and gun propagation delay');
}finally{await browser.close();}
