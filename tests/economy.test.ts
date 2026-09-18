import test from 'node:test';
import assert from 'node:assert/strict';
import { killPayout, placementBonus, REWARD, splitCash, targetCash, zoneFactor } from '../shared/economy';
import { Simulation } from '../shared/simulation';
import { emptyInput, type Team, type WeaponId } from '../shared/types';
import { scoreboardMarkup, scoreboardSort } from '../src/ui/scoreboard';

const state = {
  zone: { x: 0, z: 0, radius: 20 },
  hotZone: { x: 0, z: 0, radius: 6 },
};
const outside = { x: 80, z: 0 };
const control = { x: 12, z: 0 };
const hot = { x: 0, z: 0 };

test('zone multipliers follow the Wardogs 1 / 5 / 10 ladder', () => {
  assert.equal(zoneFactor(state, outside), 1);
  assert.equal(zoneFactor(state, control), 5);
  assert.equal(zoneFactor(state, hot), 10);
});

test('kills split cash between shooter and victim and scale inside the rings', () => {
  assert.equal(killPayout(state, outside, outside, false), 300);
  assert.equal(killPayout(state, control, control, false), 1500);
  assert.equal(killPayout(state, hot, hot, false), 3000);
  assert.equal(killPayout(state, outside, outside, true), 350);
  assert.equal(killPayout(state, hot, outside, false), 1650);
});

test('repeat kills on the same target lose about a quarter each time', () => {
  assert.equal(killPayout(state, outside, outside, false, 1), 228);
  assert.equal(killPayout(state, outside, outside, false, 4), 12);
});

test('assists and revives pay on the target ring', () => {
  assert.equal(splitCash(REWARD.assist, outside, outside, state), 80);
  assert.equal(targetCash(REWARD.spotAssist, control, state), 400);
  assert.equal(targetCash(REWARD.spotAssist, hot, state), 800);
  assert.equal(targetCash(REWARD.revive, outside, state), 90);
  assert.equal(targetCash(REWARD.revive, hot, state), 900);
  assert.equal(placementBonus(4000), 700);
});

function player(sim: Simulation, id = 'a', team: Team = 0, x = -60, z = 0, weapon: WeaponId = 'ar') {
  const p = sim.addPlayer(id, { name: id, team, weapon });
  Object.assign(p, { x, z, yaw: 0, pitch: 0, protectedUntil: 0 });
  sim.setInput(id, emptyInput());
  return p;
}

test('a fresh spot pays once and the match wallet tracks only earnings', () => {
  const sim = new Simulation(0, 471, { warmup: false });
  const p = player(sim, 'spotter'); player(sim, 'target', 1, -60, -25);
  const start = p.credits;
  sim.support.spot(p, []);
  assert.equal(p.credits - start, 20);
  assert.equal(p.earned, 20);
  sim.state.time = 1.3;
  sim.support.spot(p, []);
  assert.equal(p.credits - start, 20, 'refreshing an active mark does not pay again');
});

test('scoreboard lists K/D/A and match cash instead of the remaining wallet', () => {
  const sim = new Simulation(0, 12, { warmup: false });
  const a = player(sim, 'Lynx-1'); const b = player(sim, 'Ember-1', 1, 60, 0);
  Object.assign(a, { kills: 4, deaths: 1, assists: 3, earned: 1850, credits: 6400, transports: 2, revives: 1, captures: 12 });
  Object.assign(b, { kills: 2, deaths: 5, assists: 0, earned: 400, credits: 9800 });
  const html = scoreboardMarkup(sim.state, a, s => s, n => String(n), () => '');
  assert.match(html, /ASSIST\./);
  assert.match(html, /MORTES/);
  assert.match(html, /CR DA RODADA/);
  assert.match(html, />4</);
  assert.match(html, />1</);
  assert.match(html, />3</);
  assert.match(html, /1.?850/);
  assert.doesNotMatch(html, /6.?400/);
  assert.equal(scoreboardSort(a, b) < 0, true);
});
