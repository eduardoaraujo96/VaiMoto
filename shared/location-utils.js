export function normalizeCoordinates(value) {
  if (!value || value.latitude === null || value.latitude === undefined || value.longitude === null || value.longitude === undefined) {
    return null;
  }
  if ((typeof value.latitude === 'string' && !value.latitude.trim())
      || (typeof value.longitude === 'string' && !value.longitude.trim())) return null;

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return {
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7))
  };
}

export function coordinateLabel(point, label = 'Ponto no mapa') {
  const coordinates = normalizeCoordinates(point);
  if (!coordinates) throw new Error('Selecione uma localização válida no mapa.');
  return `${label} (${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)})`;
}

export function distanceBetweenMeters(first, second) {
  const a = normalizeCoordinates(first);
  const b = normalizeCoordinates(second);
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
