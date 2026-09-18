import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:5173';
await mkdir('artifacts/gameplay-polish',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(base);await page.waitForFunction(()=>!!window.__WAR_CATS__&&!document.getElementById('loading'));
  await page.getByRole('button',{name:'Abrir configurações'}).click();
  assert.equal(await page.locator('.audio-channel input').count(),8);
  await page.locator('#audio-voice').fill('0');await page.locator('#audio-gunfire').fill('0.45');await page.locator('#audio-movement').fill('0.35');
  await page.screenshot({path:'artifacts/gameplay-polish/audio-settings.png'});
  await page.getByRole('button',{name:'SALVAR E VOLTAR'}).click();await page.reload();await page.waitForFunction(()=>!!window.__WAR_CATS__&&!document.getElementById('loading'));
  const saved=await page.evaluate(()=>window.__WAR_CATS__.audio.mix);assert.equal(saved.voice,0);assert.equal(saved.gunfire,.45);assert.equal(saved.movement,.35);
  await page.getByRole('button',{name:'ARSENAL',exact:true}).click();await page.waitForTimeout(100);
  const start=await page.evaluate(()=>window.__WAR_CATS__.audio.menuSounds);
  await page.locator('[data-class="medic"]').click();await page.waitForTimeout(100);await page.locator('[data-weapon="ak"]').click();await page.waitForTimeout(100);
  const menu=await page.evaluate(()=>window.__WAR_CATS__.audio.menuSounds);assert.ok(menu>=start+2);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Abrir configurações'}).click();await page.waitForTimeout(300);assert.ok(await page.locator('.settings-dialog').isVisible());await page.screenshot({path:'artifacts/gameplay-polish/audio-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const actual=await page.evaluate(async()=>{
    const {GameAudio}=await import('/src/game/audio.ts');const {DEFAULT_AUDIO}=await import('/src/game/audio-mix.ts');
    const audio=new GameAudio();await audio.enable();audio.setVolume(1);audio.setMix({...DEFAULT_AUDIO,voice:0,gunfire:1});
    const ctx=audio.context,analyser=ctx.createAnalyser(),quiet=ctx.createGain();quiet.gain.value=0;
    audio.master.disconnect();audio.master.connect(analyser);analyser.connect(quiet);quiet.connect(ctx.destination);
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.sin(i/ctx.sampleRate*Math.PI*880)*.3;
    audio.samples.set('radio-start',buffer);audio.samples.set('fire-ar',buffer);audio.requested.add('radio-start');audio.requested.add('fire-ar');
    const energy=async()=>{await new Promise(r=>setTimeout(r,120));const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return data.reduce((n,v)=>n+v*v,0)/data.length;};
    await new Promise(r=>setTimeout(r,220));const voice=audio.sample('radio-start',.5);const mutedVoice=await energy();voice?.stop();await new Promise(r=>setTimeout(r,80));
    const shot=audio.sample('fire-ar',.5);const audibleShot=await energy();audio.setMix({...DEFAULT_AUDIO,voice:0,gunfire:0});await new Promise(r=>setTimeout(r,500));const mutedShot=await energy();shot?.stop();await ctx.close();
    return {mutedVoice,audibleShot,mutedShot};
  });
  assert.ok(actual.mutedVoice<1e-8);assert.ok(actual.audibleShot>1e-4);assert.ok(actual.mutedShot<1e-8);
  const spatial=await page.evaluate(async()=>{
    const {GameAudio}=await import('/src/game/audio.ts');const {DEFAULT_AUDIO}=await import('/src/game/audio-mix.ts');
    async function render(x,y,z,yaw=0){
      const ctx=new OfflineAudioContext(2,24000,48000),audio=new GameAudio();audio.context=ctx;audio.mix={...DEFAULT_AUDIO,spatial:true};
      audio.updateListener({x:0,y:0,z:0,yaw,pitch:0,crouch:false,state:'alive'});
      const source=ctx.createOscillator();source.frequency.value=660;const pan=audio.spatialNode({x,y,z});source.connect(pan);pan.connect(ctx.destination);source.start(.05);source.stop(.45);
      const result=await ctx.startRendering(),energy=[];for(let c=0;c<2;c++){const data=result.getChannelData(c);let sum=0;for(let i=4800;i<18000;i++)sum+=data[i]*data[i];energy.push(sum/13200);}return energy;
    }
    return {right:await render(9,1.64,-5),left:await render(-9,1.64,-5),turned:await render(9,1.64,-5,Math.PI),above:await render(0,15,-5),front:await render(0,1.64,-5)};
  });
  assert.ok(spatial.right[1]>spatial.right[0]*1.1);assert.ok(spatial.left[0]>spatial.left[1]*1.1);assert.ok(spatial.turned[0]>spatial.turned[1]*1.1);assert.notDeepEqual(spatial.above,spatial.front);
  assert.deepEqual(errors,[]);const report={settingsPersisted:saved,menuFeedback:true,actualMixer:actual,spatial,errors};await writeFile('artifacts/gameplay-polish/audio-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
