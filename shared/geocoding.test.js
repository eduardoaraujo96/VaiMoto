import test from 'node:test';
import assert from 'node:assert/strict';
import { MATOES_CENTER, searchLocations } from './geocoding.js';

function feature(name, city, longitude, latitude, extra = {}) {
  return {
    type: 'Feature',
    properties: { name, city, state: 'Maranhão', country: 'Brasil', ...extra },
    geometry: { type: 'Point', coordinates: [longitude, latitude] }
  };
}

test('search biases Photon toward Matões without restricting outside locations', async () => {
  let requestUrl;
  const results = await searchLocations('Rua da Igreja', {
    fetchImpl: async url => {
      requestUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({
          features: [
            feature('Rua da Igreja', 'Teresina', -42.8016, -5.0892),
            feature('Rua da Igreja', 'Matões', -43.2041, -5.521),
            feature('Rua da Igreja', 'Parnarama', -43.0900, -6.4400)
          ]
        })
      };
    }
  });

  assert.equal(requestUrl.searchParams.get('lat'), String(MATOES_CENTER.latitude));
  assert.equal(requestUrl.searchParams.get('lon'), String(MATOES_CENTER.longitude));
  assert.equal(results[0].label, 'Rua da Igreja, Matões, Maranhão, Brasil');
  assert.ok(results.some(result => result.label.includes('Teresina')));
  assert.ok(results.every(result => result.source === 'geocoded'));
});

test('preserves a direct search for a place outside Matões and ignores invalid geocoder points', async () => {
  const results = await searchLocations('Teresina', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        features: [
          feature('Teresina', 'Teresina', -42.8016, -5.0892),
          feature('Matões', 'Matões', -43.2041, -5.521),
          feature('Invalid', 'Matões', 200, 0)
        ]
      })
    })
  });

  assert.match(results[0].label, /^Teresina/);
  assert.equal(results.length, 2);
});

test('rejects short queries and reports geocoding service errors', async () => {
  assert.deepEqual(await searchLocations('ab', {
    fetchImpl: () => { throw new Error('short query should not make a request'); }
  }), []);
  await assert.rejects(
    searchLocations('povoado', { fetchImpl: async () => ({ ok: false }) }),
    /pesquisa de locais está indisponível/
  );
});
