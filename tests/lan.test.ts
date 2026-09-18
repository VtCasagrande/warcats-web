import test from 'node:test';
import assert from 'node:assert/strict';
import { isBrowserOriginAllowed, isPrivateHostname } from '../server/lan';

test('LAN Vite proxy origins are allowed when the backend Host is loopback', () => {
  assert.equal(isPrivateHostname('192.168.0.12'), true);
  assert.equal(isPrivateHostname('10.0.0.8'), true);
  assert.equal(isPrivateHostname('unrelated.example'), false);
  assert.equal(isBrowserOriginAllowed('http://192.168.0.12:5173', '127.0.0.1:3001'), true);
  assert.equal(isBrowserOriginAllowed('http://localhost:5173', '127.0.0.1:3001'), true);
  assert.equal(isBrowserOriginAllowed('https://unrelated.example', '127.0.0.1:3001'), false);
  assert.equal(isBrowserOriginAllowed('http://192.168.0.12:5173', '192.168.0.12:3001'), true);
  assert.equal(isBrowserOriginAllowed('http://192.168.155.38:5173', '127.0.0.1:3001'), true);
});
