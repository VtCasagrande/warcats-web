import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingRoomError, sanitizeRoomCode } from '../src/ui/lobby';

test('room codes keep hex from invite links and drop noise', () => {
  assert.equal(sanitizeRoomCode('aa0584'), 'AA0584');
  assert.equal(sanitizeRoomCode('  a3f8d1-extra '), 'A3F8D1');
  assert.equal(sanitizeRoomCode('xyz'), '');
});

test('missing-room errors unlock creating a new operation', () => {
  assert.equal(isMissingRoomError('Sala não encontrada. Confira o código ou crie uma nova operação.'), true);
  assert.equal(isMissingRoomError('O servidor está cheio. Tente novamente em alguns minutos.'), false);
});
