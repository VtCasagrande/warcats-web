import test from 'node:test';
import assert from 'node:assert/strict';
import { mapView, MINIMAP_RANGE } from '../src/ui/map';

test('minimap is player-centered and tighter than the tactical map', () => {
  const player = { x: 40, z: -20, yaw: 0.5 };
  const mini = mapView(280, 196, player, false);
  const full = mapView(680, 196, player, true);
  assert.equal(mini.focused, true);
  assert.equal(mini.originX, 40);
  assert.equal(mini.originZ, -20);
  assert.equal(mini.rotate, player.yaw);
  assert.equal(mini.scale, 280 / (MINIMAP_RANGE * 2));
  assert.equal(full.focused, false);
  assert.equal(full.originX, 0);
  assert.equal(full.rotate, 0);
  const sameSize = mapView(240, 196, player, false);
  const sameFull = mapView(240, 196, player, true);
  assert.ok(sameSize.scale > sameFull.scale * 3);
});

test('tactical map stays north-up even without a player', () => {
  const full = mapView(680, 196, undefined, true);
  assert.equal(full.focused, false);
  assert.equal(full.rotate, 0);
  assert.equal(full.originX, 0);
});
