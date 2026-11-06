import test from 'node:test';
import assert from 'node:assert/strict';
import { createUuid } from './uuid.js';

test('uses randomUUID when available', () => {
  assert.equal(createUuid({ cryptoApi: { randomUUID: () => 'native-uuid' } }), 'native-uuid');
});

test('creates a version 4 UUID with getRandomValues when randomUUID is unavailable', () => {
  const value = createUuid({
    cryptoApi: {
      getRandomValues(bytes) {
        bytes.fill(0);
        return bytes;
      }
    }
  });

  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('falls back to a version 4 UUID when Web Crypto is unavailable', () => {
  const value = createUuid({ cryptoApi: undefined, random: () => 0.5 });

  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
