import test from 'node:test';
import assert from 'node:assert/strict';
import { phase, pulse, reloadMotion, throwMotion, throwProgress, THROW_SECONDS } from '../src/game/view-motion';

test('reload pose stays continuous and keeps the magazine on a path instead of popping', () => {
  const samples = Array.from({ length: 41 }, (_, i) => reloadMotion(i / 40));
  for (let i = 1; i < samples.length; i++) {
    assert.ok(Math.abs(samples[i].y - samples[i - 1].y) < 0.08, 'reload dip jumped between samples');
    assert.ok(Math.abs(samples[i].magY - samples[i - 1].magY) < 0.08, 'magazine popped between samples');
    assert.ok(Math.abs(samples[i].rz - samples[i - 1].rz) < 0.32, 'reload roll jumped between samples');
  }
  assert.ok(Math.abs(reloadMotion(0).magY) < 1e-9);
  assert.ok(Math.abs(reloadMotion(1).magY) < 1e-9);
  assert.ok(reloadMotion(0.22).magY < -0.1);
  assert.ok(reloadMotion(0.12).rz < reloadMotion(0).rz);
  assert.ok(reloadMotion(0.4).x !== reloadMotion(0.45).x, 'mid-reload should keep working instead of freezing');
});

test('grenade wind-up, release and recover do not snap the throwing arm', () => {
  const start = throwMotion(0), wind = throwMotion(0.25), release = throwMotion(0.52), end = throwMotion(1);
  assert.ok(wind.right.z > start.right.z, 'wind-up should draw the arm back');
  assert.ok(release.right.z < wind.right.z, 'release should drive the arm forward');
  assert.ok(Math.abs(end.right.z - start.right.z) < 0.08, 'recover should return near idle');
  assert.equal(start.grenadeVisible, true);
  assert.equal(throwMotion(0.5).grenadeVisible, false);
  assert.equal(start.showGun, true);
  assert.equal(throwMotion(0.4).showGun, false);
  assert.equal(end.showGun, true);
  const throws = Array.from({ length: 17 }, (_, i) => throwMotion(i / 16).right.z);
  for (let i = 1; i < throws.length; i++) assert.ok(Math.abs(throws[i] - throws[i - 1]) < 0.2, 'throw arm snapped');
  assert.equal(throwProgress(THROW_SECONDS, 0), 0);
  assert.equal(throwProgress(THROW_SECONDS, THROW_SECONDS), 1);
  assert.ok(phase(0.5, 0, 1) > 0.4 && phase(0.5, 0, 1) < 0.6);
  assert.ok(pulse(0.5, 0, 0.5, 1) > 0.9);
});
