import test from 'node:test';
import assert from 'node:assert/strict';
import { compassTapeX, headingDeg, deathPanelMarkup, eliminationMarkup, hitmarkerState, killCause, killFeedKey, killFeedMarkup } from '../src/ui/combat-hud';
import type { GameEvent, Match, Player } from '../shared/types';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function feed(events: GameEvent[]) {
  return killFeedMarkup({
    time: 10,
    players: {
      a: { id: 'a', name: 'Lynx-1', team: 0, weapon: 'dmr' } as Player,
      b: { id: 'b', name: 'Ember-2', team: 1, weapon: 'ar' } as Player,
    },
    events,
  } as unknown as Match, esc);
}

test('compass heading wraps and the tape centers north at yaw 0', () => {
  assert.equal(Math.round(headingDeg(0)), 0);
  assert.equal(Math.round(headingDeg(-Math.PI / 2)), 90);
  assert.equal(compassTapeX(0), compassTapeX(-Math.PI * 2));
  assert.ok(compassTapeX(-Math.PI / 2) < compassTapeX(0));
});

test('kill console labels headshot, regular elimination, melee and downs', () => {
  assert.equal(killCause({ type: 'kill', headshot: true, weapon: 'dmr' }), 'headshot');
  assert.equal(killCause({ type: 'kill', headshot: false, weapon: 'ar' }), 'body');
  assert.equal(killCause({ type: 'kill', headshot: false, weapon: 'knife' }), 'melee');
  assert.equal(killCause({ type: 'kill', headshot: false, weapon: 'rpg' }), 'blast');
  assert.equal(killCause({ type: 'down', headshot: false, weapon: 'smg' }), 'downed');
  const html = feed([
    { id: 1, type: 'kill', time: 9.6, x: 0, y: 0, z: 0, player: 'a', target: 'b', team: 0, headshot: true, weapon: 'dmr' },
    { id: 2, type: 'kill', time: 9.4, x: 0, y: 0, z: 0, player: 'b', target: 'a', team: 1, weapon: 'ar' },
    { id: 3, type: 'down', time: 9.2, x: 0, y: 0, z: 0, player: 'a', target: 'b', team: 0, weapon: 'knife' },
  ]);
  assert.match(html, /HEADSHOT/);
  assert.match(html, /ELIMINAÇÃO/);
  assert.match(html, /ABATIDO/);
  assert.match(html, /Lynx-1/);
  assert.match(html, /Ember-2/);
  assert.match(html, /kill-row headshot/);
  assert.equal(killFeedKey({ time: 10, events: [
    { id: 1, type: 'kill', time: 9.6, x: 0, y: 0, z: 0, headshot: true, weapon: 'dmr' },
  ] } as unknown as Match).includes('1:kill:1:dmr'), true);
});

test('elimination banner names the victim and labels headshot or melee', () => {
  assert.match(eliminationMarkup({ type: 'kill', headshot: true, weapon: 'dmr' }, 'Ember-2', esc), /TIRO NA CABEÇA/);
  assert.match(eliminationMarkup({ type: 'kill', headshot: false, weapon: 'knife' }, 'Ember-2', esc), /CORTE/);
  assert.match(eliminationMarkup({ type: 'kill', headshot: false, weapon: 'ar' }, 'Lynx-1', esc), /ELIMINADO <span>Lynx-1<\/span>/);
  assert.doesNotMatch(eliminationMarkup({ type: 'kill', headshot: false, weapon: 'ar' }, 'Lynx-1', esc), /TIRO NA CABEÇA/);
});

test('victim banner and death panel name the attacker, weapon and cause', () => {
  const event = { type: 'kill' as const, headshot: true, weapon: 'dmr' as const };
  assert.match(eliminationMarkup(event, 'Lynx-1', esc, 'victim'), /ELIMINADO POR/);
  assert.match(eliminationMarkup(event, 'Lynx-1', esc, 'victim'), /Lynx-1/);
  assert.match(eliminationMarkup({ type: 'down', headshot: false, weapon: 'ar' }, 'Lynx-1', esc, 'victim'), /ABATIDO POR/);
  const state = {
    time: 12,
    players: {
      a: { id: 'a', name: 'Lynx-1', team: 0, weapon: 'dmr' } as Player,
      b: { id: 'b', name: 'Ember-2', team: 1, weapon: 'ar' } as Player,
    },
    events: [{ id: 4, type: 'kill', time: 11, x: 0, y: 0, z: 0, player: 'a', target: 'b', headshot: true, weapon: 'dmr' }],
  } as unknown as Match;
  const html = deathPanelMarkup({ id: 'b', state: 'dead', lastAttacker: 'a', bleedAt: 0, respawnAt: 16, reviveProgress: 0 }, state, esc);
  assert.match(html, /ELIMINADO POR/);
  assert.match(html, /Lynx-1/);
  assert.match(html, /HEADSHOT/);
  assert.match(html, /REAGRUPANDO EM 4/);
  const downed = deathPanelMarkup({ id: 'b', state: 'downed', lastAttacker: 'a', bleedAt: 20, respawnAt: 0, reviveProgress: 0.4 }, {
    ...state,
    time: 14,
    events: [{ id: 5, type: 'down', time: 13, x: 0, y: 0, z: 0, player: 'a', target: 'b', weapon: 'ar' }],
  } as unknown as Match, esc);
  assert.match(downed, /ABATIDO POR/);
  assert.match(downed, /Lynx-1/);
});

test('hitmarker stays a short flash on hit and a longer confirm on kill', () => {
  assert.deepEqual(hitmarkerState(1.05, 1, -10), { visible: true, kill: false });
  assert.deepEqual(hitmarkerState(1.2, 1, -10), { visible: false, kill: false });
  assert.deepEqual(hitmarkerState(1.3, 1, 1), { visible: true, kill: true });
  assert.deepEqual(hitmarkerState(1.5, 1, 1), { visible: false, kill: false });
});
