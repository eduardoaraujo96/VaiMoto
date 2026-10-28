import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRemainingTime,
  getRemainingSeconds,
  isValidBrazilianPlate,
  isValidUsername,
  normalizeVehiclePlate,
  normalizeUsername
} from './ride-utils.js';
import { profileAvatar } from './ui.js';

test('normalizes and validates unique username format', () => {
  assert.equal(normalizeUsername('  João.Moto_7  '), 'joão.moto_7');
  assert.equal(isValidUsername('joao.moto_7'), true);
  assert.equal(isValidUsername('jo'), false);
  assert.equal(isValidUsername('nome inválido'), false);
});

test('accepts old and Mercosul Brazilian vehicle plates', () => {
  assert.equal(normalizeVehiclePlate('abc-1234'), 'ABC1234');
  assert.equal(isValidBrazilianPlate('abc-1234'), true);
  assert.equal(isValidBrazilianPlate('ABC 1D23'), true);
  assert.equal(isValidBrazilianPlate('AB12345'), false);
});

test('calculates arrival countdown from an absolute persisted deadline', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(getRemainingSeconds('2026-10-22T12:05:00Z', now), 300);
  assert.equal(getRemainingSeconds('2026-10-22T11:59:59Z', now), 0);
  assert.equal(formatRemainingTime(300), '5min 00s');
  assert.equal(formatRemainingTime(3660), '1h 1min');
});

test('renders a safe fallback or escaped private profile photo URL', () => {
  assert.match(profileAvatar(null, 'Passenger'), /aria-label="Foto de perfil indisponível">P</);
  assert.match(profileAvatar('https://storage.example/signed?token="x"', 'Driver'), /&quot;x&quot;/);
  assert.match(profileAvatar('https://storage.example/signed', 'Driver'), /data-profile-avatar/);
});
