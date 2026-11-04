import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateLabel, distanceBetweenMeters, normalizeCoordinates } from './location-utils.js';

test('normalizes valid geographic coordinates and rejects invalid points', () => {
  assert.deepEqual(normalizeCoordinates({ latitude: '-23.5505201', longitude: '-46.6333082' }), {
    latitude: -23.5505201,
    longitude: -46.6333082
  });
  assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(normalizeCoordinates({ latitude: 0, longitude: -181 }), null);
  assert.equal(normalizeCoordinates({ latitude: '', longitude: '' }), null);
});

test('formats a truthful coordinate label for manually selected map points', () => {
  assert.equal(
    coordinateLabel({ latitude: -23.55052, longitude: -46.633308 }, 'Origem no mapa'),
    'Origem no mapa (-23.55052, -46.63331)'
  );
  assert.throws(() => coordinateLabel(null), /localização válida/);
});

test('calculates driver location update distances in meters', () => {
  assert.equal(distanceBetweenMeters(null, { latitude: 0, longitude: 0 }), Number.POSITIVE_INFINITY);
  const oneDegreeAtEquator = distanceBetweenMeters(
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 }
  );
  assert.ok(oneDegreeAtEquator > 111_000 && oneDegreeAtEquator < 112_000);
});
