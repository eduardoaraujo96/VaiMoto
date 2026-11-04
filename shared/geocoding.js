import { distanceBetweenMeters, normalizeCoordinates } from './location-utils.js';

export const MATOES_CENTER = Object.freeze({
  latitude: -5.5210672,
  longitude: -43.2041534
});

const photonEndpoint = 'https://photon.komoot.io/api/';
const cache = new Map();
let lastRequestAt = 0;

async function waitForRequestSlot(signal) {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (!wait) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, wait);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('A pesquisa foi cancelada.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function normalizedText(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

function locationName(feature) {
  const properties = feature?.properties || {};
  return properties.name || properties.street || properties.locality || '';
}

function isMatoesResult(feature) {
  const properties = feature?.properties || {};
  return ['city', 'town', 'municipality', 'county', 'locality', 'district', 'name']
    .some(field => normalizedText(properties[field]) === 'matoes');
}

function isNearbyResult(feature) {
  const point = normalizeCoordinates({
    latitude: feature?.geometry?.coordinates?.[1],
    longitude: feature?.geometry?.coordinates?.[0]
  });
  return point && distanceBetweenMeters(MATOES_CENTER, point) <= 75_000;
}

function resultLabel(feature) {
  const properties = feature.properties || {};
  const primary = locationName(feature);
  const details = [
    properties.housenumber,
    properties.street && properties.street !== primary ? properties.street : null,
    properties.suburb,
    properties.district,
    properties.city,
    properties.town,
    properties.village,
    properties.county,
    properties.state,
    properties.country
  ].filter(Boolean);
  const uniqueDetails = [...new Set(details)].filter(value => normalizedText(value) !== normalizedText(primary));
  return [primary, ...uniqueDetails].join(', ').slice(0, 300);
}

function orderLocalResults(features, query) {
  const queryText = normalizedText(query);
  const first = features[0];
  const firstName = normalizedText(locationName(first));
  const firstCity = normalizedText(first?.properties?.city || first?.properties?.town || first?.properties?.village);
  const explicitlyNamedOutsidePlace = first
    && !isMatoesResult(first)
    && Boolean(firstCity)
    && (firstCity === queryText || queryText.includes(firstCity))
    && (firstName === queryText || queryText.includes(firstCity));

  if (explicitlyNamedOutsidePlace) return features;

  return features
    .map((feature, index) => ({
      feature,
      index,
      priority: isMatoesResult(feature) ? 0 : isNearbyResult(feature) ? 1 : 2
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(item => item.feature);
}

export async function searchLocations(query, { signal, fetchImpl = fetch } = {}) {
  const text = String(query || '').trim();
  if (text.length < 3) return [];

  const cacheKey = normalizedText(text);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  await waitForRequestSlot(signal);
  if (signal?.aborted) throw new DOMException('A pesquisa foi cancelada.', 'AbortError');

  const url = new URL(photonEndpoint);
  url.searchParams.set('q', text);
  url.searchParams.set('lat', String(MATOES_CENTER.latitude));
  url.searchParams.set('lon', String(MATOES_CENTER.longitude));
  url.searchParams.set('limit', '10');

  lastRequestAt = Date.now();
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/geo+json, application/json' },
    signal
  });
  if (!response.ok) throw new Error('A pesquisa de locais está indisponível. Tente novamente ou marque o ponto no mapa.');

  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const results = orderLocalResults(features, text)
    .map(feature => {
      const coordinates = normalizeCoordinates({
        longitude: feature?.geometry?.coordinates?.[0],
        latitude: feature?.geometry?.coordinates?.[1]
      });
      if (!coordinates) return null;
      const label = resultLabel(feature);
      if (!label) return null;
      return {
        label,
        coordinates,
        source: 'geocoded'
      };
    })
    .filter(Boolean);

  cache.set(cacheKey, results);
  return results;
}
