import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.TEST_URL || 'http://localhost:5173';
await mkdir('artifacts/model-integration', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = new Map(), results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().includes('/assets/models/warcats/')) requests.set(request.url(), (requests.get(request.url()) || 0) + 1); });
try {
  await page.route('**/__asset-qa', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;overflow:hidden;background:#151e1a"><canvas id="world"></canvas></body></html>' }));
  await page.goto(base + '/__asset-qa');
  const rig = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { createWeapon, disposeModel } = await import('/src/game/models.ts');
    const { createVehicleModel, updateVehicleModel, disposeVehicleModel } = await import('/src/game/vehicle-models.ts');
    const { createVehicles } = await import('/shared/vehicles.ts');
    const { applySkin } = await import('/src/game/skins.ts');
    const wait = async roots => { const until = performance.now() + 20000; while (!roots.every(root => root.userData.assetState === 'ready')) { if (performance.now() > until) throw new Error('Asset timeout'); await new Promise(r => setTimeout(r, 30)); } };
    const doomed = createWeapon('awm'); disposeModel(doomed);
    const weapons = ['ar', 'ak', 'm40', 'awm', 'pistol', 'shotgun'].map(id => ({ id, root: createWeapon(id, false) }));
    const first = createVehicleModel('jeep', 0), second = createVehicleModel('jeep', 1), heli = createVehicleModel('helicopter', 0);
    await wait([...weapons.map(w => w.root), first.root, second.root, heli.root]);
    if (doomed.getObjectByName('asset-awm')) throw new Error('Disposed weapon attached late');
    const weaponResults = [];
    for (const { id, root } of weapons) {
      const asset = root.getObjectByName('asset-' + id);
      if (!asset || !root.getObjectByName('muzzle') || !root.getObjectByName('magazine')) throw new Error('Missing weapon contract ' + id);
      if (id === 'm40' || id === 'awm') {
        const solids = []; root.updateMatrixWorld(true); root.traverse(o => { if (o.isMesh && o.name !== 'reticle' && !o.parent?.name.includes('muzzle')) solids.push(o); });
        const hits = new T.Raycaster(new T.Vector3(0, root.userData.aimY, 1), new T.Vector3(0, 0, -1)).intersectObjects(solids, false);
        if (hits.length) throw new Error(id + ' blocked optical axis: ' + hits.map(h => h.object.name));
      }
      const body = asset.getObjectByName('body'), panel = asset.getObjectByName('furniture');
      const original = body.material.map; applySkin(root, 'desert');
      if (body.material.map !== original || panel.material.map.channel !== 1) throw new Error('Skin overwrote atlas/UV ' + id);
      applySkin(root, 'standard'); if (panel.material.map !== original) throw new Error('Atlas did not restore ' + id);
      weaponResults.push({ id, asset: asset.userData.assetId, aimY: root.userData.aimY });
    }
    const oneBody = first.root.getObjectByName('asset-jeep').getObjectByName('body'), twoBody = second.root.getObjectByName('asset-jeep').getObjectByName('body');
    if (oneBody.geometry !== twoBody.geometry || oneBody.material !== twoBody.material) throw new Error('Vehicle buffers are not shared');
    let sharedDisposed = false; oneBody.geometry.addEventListener('dispose', () => { sharedDisposed = true; });
    const state = createVehicles('nordhaven').find(v => v.kind === 'jeep'); state.x = state.z = 0; state.yaw = 0;
    updateVehicleModel(first, state, 1 / 60); state.z = -2; state.speed = 8; state.yaw = .2; updateVehicleModel(first, state, 1 / 60);
    if (first.wheels.some(w => w.spin.rotation.x >= 0) || first.wheels.filter(w => w.front).some(w => w.pivot.rotation.y <= 0)) throw new Error('Imported tire did not steer/roll');
    if (second.wheels.some(w => w.spin.rotation.x !== 0)) throw new Error('Vehicle instances share animation state');
    const helicopter = createVehicles('nordhaven').find(v => v.kind === 'helicopter'); helicopter.rotor = 12;
    updateVehicleModel(heli, helicopter, 1 / 60);
    if (heli.rotor.rotation.y !== 12 || heli.tailRotor.rotation.x !== 12 * 49 / 32) throw new Error('Imported rotor did not follow snapshot');
    disposeVehicleModel(first); if (sharedDisposed) throw new Error('Disposed another vehicle geometry');
    disposeVehicleModel(second); disposeVehicleModel(heli); weapons.forEach(w => disposeModel(w.root));
    const { attachmentOptions } = await import('/shared/loadout.ts');
    let sightsChecked=0;
    for(const id of ['ar','smg','dmr','ak','lmg','m40','awm','shotgun','pistol']) {
      for(const sight of attachmentOptions(id).sights) {
        const gun=createWeapon(id,false,{sight});if(gun.userData.assetState)await wait([gun]);gun.updateMatrixWorld(true);
        const solids=[];gun.traverse(o=>{if(!o.isMesh||o.name==='reticle'||o.parent?.name==='muzzle')return;const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.every(m=>!m.transparent||m.opacity>=1))solids.push(o);});
        const hits=new T.Raycaster(new T.Vector3(0,gun.userData.aimY,1),new T.Vector3(0,0,-1)).intersectObjects(solids,false);
        if(hits.length)throw new Error(`${id}/${sight}: blocked aiming axis ${hits.map(h=>h.object.name)}`);
        sightsChecked++;disposeModel(gun);
      }
    }
    return { weapons: weaponResults, sightsChecked, wheels: true, rotors: true, instanceIsolation: true, cancellation: true, sharedLifetime: true };
  });
  results.push(rig);
  await page.evaluate(async () => {
    const { GameRenderer } = await import('/src/game/renderer.ts');
    const { Simulation } = await import('/shared/simulation.ts');
    const { emptyInput } = await import('/shared/types.ts');
    const { modelAssetStats } = await import('/src/game/model-assets.ts');
    window.qa = { renderer: new GameRenderer(document.getElementById('world')), Simulation, emptyInput, assetStats: modelAssetStats };
    qa.renderer.setQuality('medium'); qa.renderer.reducedMotion = true;
  });
  for (const mapId of ['nordhaven', 'quarry', 'harbor', 'nordhaven']) {
    await page.evaluate(async mapId => {
      const { getMap } = await import('/shared/maps.ts');
      qa.sim = new qa.Simulation(18, 471, { mapId, warmup: false }); qa.p = qa.sim.addPlayer('asset-qa', { name: 'Asset QA', team: 0, weapon: 'ar' });
      const prop = getMap(mapId).props.find(p => p.asset === 'truck');
      qa.p.x = prop.x + 10; qa.p.z = prop.z + 12; qa.p.y = 0; qa.p.yaw = Math.atan2(qa.p.x - prop.x, qa.p.z - prop.z);
      qa.input = { ...qa.emptyInput(), yaw: qa.p.yaw, pitch: .02 };
      for (let i = 0; i < 80; i++) qa.renderer.render(qa.sim.state, qa.p, qa.input, 1 / 60);
    }, mapId);
    await page.waitForFunction(() => qa.renderer.environment.propGroup.children.every(root => root.userData.assetState === 'ready') && [...qa.renderer.vehicleModels.values()].every(v => v.root.userData.assetState === 'ready'), null, { timeout: 30000 });
    const status = await page.evaluate(() => {
      qa.renderer.render(qa.sim.state, qa.p, qa.input, 1 / 60);
      const assets = []; qa.renderer.scene.traverse(o => { if (o.userData.assetId) assets.push(o.userData.assetId); });
      const props = qa.renderer.environment.propGroup.children;
      if (props.length !== 15 || props.some(root => root.userData.assetState !== 'ready')) throw new Error('Map props are missing: ' + qa.sim.state.mapId + ' ' + JSON.stringify(props.map(root => ({ name: root.name, state: root.userData.assetState, disposed: root.userData.assetDisposed }))));
      if ([...qa.renderer.vehicleModels.values()].some(v => v.root.userData.assetState !== 'ready')) throw new Error('Fleet models are missing');
      return { mapId: qa.sim.state.mapId, props: props.length, fleet: qa.renderer.vehicleModels.size, assets, ...qa.renderer.stats };
    });
    results.push(status); await page.screenshot({ path: `artifacts/model-integration/${mapId}-game.png` });
  }
  const performanceResult = await page.evaluate(async () => {
    const frames = []; let last = performance.now();
    for (let i = 0; i < 120; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); qa.renderer.render(qa.sim.state, qa.p, qa.input, (now - last) / 1000); frames.push(now - last); last = now; }
    frames.sort((a, b) => a - b);
    return { medianMs: frames[60], p95Ms: frames[114], memory: qa.renderer.renderer.info.memory, cache: qa.renderer.assetStats };
  });
  results.push(performanceResult);
  for (const kind of ['jeep', 'helicopter']) {
    await page.evaluate(kind => {
      const v = qa.sim.state.vehicles.find(v => v.kind === kind && v.team === 0);
      v.seats[0] = qa.p.id; qa.p.vehicleId = v.id; qa.p.vehicleSeat = 0; qa.input.yaw = v.yaw + .7; qa.input.pitch = -.10;
      for (let i = 0; i < 100; i++) { v.rotor += .4; qa.renderer.render(qa.sim.state, qa.p, qa.input, 1 / 60); }
    }, kind);
    await page.screenshot({ path: `artifacts/model-integration/${kind}-game.png` });
  }
  assert.equal(requests.size, 13); assert.ok([...requests.values()].every(n => n === 1), 'A GLB was downloaded twice across map rotation'); assert.deepEqual(errors, []);
  await writeFile('artifacts/model-integration/browser-report.json', JSON.stringify({ results, errors, downloads: Object.fromEntries(requests) }, null, 2));
  console.log(JSON.stringify({ pass: true, assets: requests.size, rig, performance: performanceResult }, null, 2));
} finally { await browser.close(); }
