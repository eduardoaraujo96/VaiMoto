let audioContext;
let alertAudioBuffer;
let alertAudioLoading;
let repeatTimer;
let activeRideIds = [];
const activeAudioSources = new Set();
let audioStartPending = false;
let reportedAudioFailure = false;
let reportAudioError = () => {};

function reportAudioFailure(error) {
  if (reportedAudioFailure) return;
  reportedAudioFailure = true;
  reportAudioError(error);
}

function loadAlertAudio() {
  if (alertAudioBuffer || alertAudioLoading) return;

  alertAudioLoading = fetch('/som_corrida.wav')
    .then(response => {
      if (!response.ok) throw new Error(`Não foi possível carregar o som da solicitação (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(audio => audioContext.decodeAudioData(audio))
    .then(buffer => {
      alertAudioBuffer = buffer;
      if (activeRideIds.length && document.visibilityState !== 'hidden' && !repeatTimer) {
        schedulePattern();
      }
    })
    .catch(reportAudioFailure);
}

function playPattern() {
  if (!alertAudioBuffer) return;
  const source = audioContext.createBufferSource();
  source.buffer = alertAudioBuffer;
  source.connect(audioContext.destination);
  activeAudioSources.add(source);
  source.addEventListener('ended', () => activeAudioSources.delete(source), { once: true });
  source.start();
}

function stopPlayingAudio() {
  for (const source of activeAudioSources) {
    source.stop();
  }
  activeAudioSources.clear();
}

function stopTimer() {
  if (repeatTimer) window.clearTimeout(repeatTimer);
  repeatTimer = undefined;
}

function schedulePattern() {
  if (!activeRideIds.length || document.visibilityState === 'hidden') {
    stopTimer();
    return;
  }
  if (!alertAudioBuffer) return;
  playPattern();
  repeatTimer = window.setTimeout(schedulePattern, (alertAudioBuffer.duration + 2.5) * 1000);
}

export function unlockRideAlertSound(onError = () => {}) {
  reportAudioError = onError;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return false;

  audioContext ||= new AudioContextConstructor();
  loadAlertAudio();
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(reportAudioFailure);
  }
  return true;
}

export function syncRideAlert(rideIds, onError = () => {}) {
  const nextRideIds = [...new Set(rideIds)].sort();
  if (nextRideIds.join('|') === activeRideIds.join('|') && (repeatTimer || audioStartPending)) return;
  activeRideIds = nextRideIds;
  stopTimer();
  stopPlayingAudio();
  if (!activeRideIds.length) return;

  if (!unlockRideAlertSound(onError)) {
    reportAudioFailure(new Error('Este dispositivo não oferece suporte ao som de chamadas no app aberto.'));
    return;
  }

  audioStartPending = true;
  audioContext.resume().then(() => {
    audioStartPending = false;
    if (activeRideIds.length && document.visibilityState !== 'hidden') schedulePattern();
  }).catch(error => {
    audioStartPending = false;
    if (!reportedAudioFailure) {
      reportedAudioFailure = true;
      onError(error);
    }
  });
}

export function stopRideAlert() {
  activeRideIds = [];
  stopTimer();
  stopPlayingAudio();
}
