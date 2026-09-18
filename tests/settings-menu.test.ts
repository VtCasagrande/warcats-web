import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUDIO } from '../src/game/audio-mix';
import { applyCrosshair, normalizeControlSettings, settingsDialog } from '../src/ui/settings';

test('control settings clamp ADS, accel and crosshair and the ops menu exposes mira tabs', () => {
  const s = normalizeControlSettings({ adsMultiplier: 9, mouseAccel: -2, crosshairStyle: 'laser' as never, crosshairColor: 'red', parachuteAuto: false });
  assert.equal(s.adsMultiplier, 1.2);
  assert.equal(s.mouseAccel, 0);
  assert.equal(s.crosshairStyle, 'cross');
  assert.equal(s.crosshairColor, '#f4f3df');
  assert.equal(s.parachuteAuto, false);
  const html = settingsDialog({
    paused: false, room: '', tab: 'controls', quality: 'medium', sensitivity: 1, fov: 78, volume: 0.5,
    invertY: false, reducedMotion: false, audio: { ...DEFAULT_AUDIO }, adsMultiplier: 0.7, mouseAccel: 0.2,
    parachuteAuto: true, crosshairStyle: 'dot', crosshairColor: '#7fd4ff', crosshairSize: 1.2, crosshairOpacity: 0.6,
  });
  assert.match(html, /CONTROLES/);
  assert.match(html, /Multiplicador de ADS/);
  assert.match(html, /INTERFACE/);
  const host = { style: { setProperty() {} }, querySelector: () => ({ classList: { remove() {}, add() {} } }) } as unknown as HTMLElement;
  applyCrosshair(host, { ...s, crosshairStyle: 'dot' });
});
