export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidUsername(value) {
  return /^[a-z0-9._]{3,24}$/.test(normalizeUsername(value));
}

export function normalizeVehiclePlate(value) {
  return String(value ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidBrazilianPlate(value) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizeVehiclePlate(value));
}

export function getRemainingSeconds(deadline, now = Date.now()) {
  const deadlineTime = Date.parse(deadline);
  if (!Number.isFinite(deadlineTime)) return 0;
  return Math.max(0, Math.ceil((deadlineTime - now) / 1000));
}

export function formatRemainingTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}min`;
  }
  if (minutes > 0) return `${minutes}min ${String(remainingSeconds).padStart(2, '0')}s`;
  return `${remainingSeconds}s`;
}

export function updateArrivalCountdowns(root = document, now = Date.now()) {
  root.querySelectorAll('[data-arrival-deadline]').forEach(element => {
    const seconds = getRemainingSeconds(element.dataset.arrivalDeadline, now);
    element.textContent = seconds > 0
      ? `Motorista chega em aproximadamente ${formatRemainingTime(seconds)}`
      : 'Tempo estimado de chegada atingido.';
    const warning = root.querySelector(`[data-arrival-warning="${element.dataset.arrivalId}"]`);
    if (warning) warning.hidden = seconds > 0;
  });
}
