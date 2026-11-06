import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './ride-map.css';
import { getCurrentPosition } from './location.js';
import { normalizeCoordinates } from './location-utils.js';

const defaultCenter = [-5.5210672, -43.2041534];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function rideMapCardMarkup({ id, title, description, modes = [], activeMode, locateLabel, searchInfo = false }) {
  const modeButtons = modes.map(mode => `
    <button class="btn ${mode.id === activeMode ? 'btn-green' : 'btn-light'}"
      type="button" data-map-mode="${escapeHtml(mode.id)}"
      aria-pressed="${mode.id === activeMode}">
      ${escapeHtml(mode.label)}
    </button>`).join('');
  const locationButton = locateLabel
    ? `<button class="btn btn-light" type="button" data-map-current>${escapeHtml(locateLabel)}</button>`
    : '';

  return `<section class="panel ride-map-panel" aria-label="${escapeHtml(title)}">
    <div class="ride-map-heading">
      <div><h2>${escapeHtml(title)}</h2><p class="panel-sub">${escapeHtml(description)}</p></div>
    </div>
    <div class="ride-map-controls">${modeButtons}${locationButton}</div>
    <div class="ride-map-legend" aria-label="Legenda dos marcadores">
      <span><i class="ride-map-legend-driver" aria-hidden="true"></i>Mototaxista</span>
      <span><i class="ride-map-legend-pickup" aria-hidden="true"></i>Partida do passageiro</span>
      <span><i class="ride-map-legend-destination" aria-hidden="true"></i>Destino</span>
    </div>
    <div id="${escapeHtml(id)}" class="ride-map" role="application" aria-label="${escapeHtml(title)}"></div>
    <p class="field-help">${searchInfo
      ? 'Mapa © OpenStreetMap. Sugestões de locais usam Photon sobre dados OSM e priorizam Matões sem limitar outras cidades. Pontos só são salvos com a solicitação.'
      : 'Mapa © OpenStreetMap. Os pontos só são salvos com a solicitação ou atualizados durante a corrida.'}</p>
  </section>`;
}

export function mountRideMap(element, { points = [], selectionMode = null, onSelect, onCurrentLocation, onError } = {}) {
  if (!element) return null;

  let mode = selectionMode;
  const markers = new Map();
  let currentPoints = [];
  const map = L.map(element, { scrollWheelZoom: false }).setView(defaultCenter, 13);
  let destroyed = false;
  let tileErrorReported = false;
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  }).addTo(map);
  tiles.on('tileerror', () => {
    if (tileErrorReported) return;
    tileErrorReported = true;
    onError?.(new Error('Não foi possível carregar os mapas. Verifique sua conexão.'));
  });

  function setPoints(nextPoints, focusType) {
    const validPoints = nextPoints
      .map(point => ({ ...point, coordinates: normalizeCoordinates(point) }))
      .filter(point => point.coordinates);
    const nextMarkers = new Map();
    const keysChanged = validPoints.length !== markers.size
      || validPoints.some(point => !markers.has(point.id || `${point.type}:${point.label || ''}`));
    for (const point of validPoints) {
      const key = point.id || `${point.type}:${point.label || ''}`;
      const markerClass = `ride-map-marker ride-map-marker--${point.type}`;
      let marker = markers.get(key);
      if (marker) {
        marker.setLatLng([point.coordinates.latitude, point.coordinates.longitude]);
        marker.setIcon(L.divIcon({
          className: '',
          html: `<span class="${markerClass}" aria-hidden="true"></span>`,
          iconSize: [24, 28],
          iconAnchor: [12, 24]
        }));
        marker.unbindTooltip();
      } else {
        marker = L.marker([point.coordinates.latitude, point.coordinates.longitude], {
          icon: L.divIcon({
            className: '',
            html: `<span class="${markerClass}" aria-hidden="true"></span>`,
            iconSize: [24, 28],
            iconAnchor: [12, 24]
          }),
          title: point.label || 'Localização'
        }).addTo(map);
      }
      if (point.label) marker.bindTooltip(escapeHtml(point.label));
      nextMarkers.set(key, marker);
    }
    for (const [key, marker] of markers) {
      if (!nextMarkers.has(key)) marker.remove();
    }
    markers.clear();
    for (const [key, marker] of nextMarkers) markers.set(key, marker);
    currentPoints = validPoints;

    const focused = focusType && currentPoints.find(point => point.type === focusType);
    if (focusType && focused) {
      map.setView([focused.coordinates.latitude, focused.coordinates.longitude], Math.max(map.getZoom(), 15));
    } else if (keysChanged && currentPoints.length > 1) {
      map.fitBounds(L.latLngBounds(currentPoints.map(point => [
        point.coordinates.latitude,
        point.coordinates.longitude
      ])).pad(0.18), { maxZoom: 15 });
    } else if (keysChanged && currentPoints.length === 1) {
      map.setView([currentPoints[0].coordinates.latitude, currentPoints[0].coordinates.longitude], 15);
    }
  }

  map.on('click', event => {
    if (!mode || !onSelect) return;
    const coordinates = normalizeCoordinates({
      latitude: event.latlng.lat,
      longitude: event.latlng.lng
    });
    if (coordinates) onSelect(mode, coordinates);
  });

  setPoints(points);
  const resizeFrame = requestAnimationFrame(() => {
    if (!destroyed) map.invalidateSize();
  });
  const resizeTimer = window.setTimeout(() => {
    if (!destroyed) map.invalidateSize();
  }, 180);
  const onWindowResize = () => {
    if (!destroyed) map.invalidateSize();
  };
  window.addEventListener('resize', onWindowResize);

  return {
    setMode(nextMode) {
      mode = nextMode;
    },
    updatePoints: setPoints,
    async locate() {
      try {
        const position = await getCurrentPosition();
        const coordinates = normalizeCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        if (!coordinates) throw new Error('O dispositivo retornou coordenadas inválidas.');
        onCurrentLocation?.(coordinates);
      } catch (error) {
        onError?.(new Error(error.message || 'Não foi possível obter sua localização. Você pode selecionar o ponto manualmente no mapa.'));
      }
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(resizeFrame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onWindowResize);
      map.off();
      map.remove();
      markers.clear();
      currentPoints = [];
    }
  };
}
