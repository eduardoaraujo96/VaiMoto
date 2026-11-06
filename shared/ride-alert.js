let audioContext;
let alertAudioBuffer;
let alertAudioLoading;
let playbackQueue = Promise.resolve();
let reportedAudioFailure = false;
let reportAudioError = () => {};
const playedNotificationIds = new Set();
const activeAudioSources = new Set();
const MAX_REMEMBERED_NOTIFICATIONS = 2000;

function reportAudioFailure(error) {
  if (reportedAudioFailure) return;
  reportedAudioFailure = true;
  reportAudioError(error);
}

function loadAlertAudio() {
  if (alertAudioBuffer) return Promise.resolve(alertAudioBuffer);
  if (alertAudioLoading) return alertAudioLoading;
  alertAudioLoading = fetch('/som_corrida.wav')
    .then(response => {
      if (!response.ok) throw new Error(`Não foi possível carregar o som da solicitação (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(audio => audioContext.decodeAudioData(audio))
    .then(buffer => {
      alertAudioBuffer = buffer;
      return buffer;
    })
    .catch(error => {
      alertAudioLoading = null;
      reportAudioFailure(error);
      throw error;
    });
  return alertAudioLoading;
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

export function unlockRideAlertSound(onError = () => {}) {
  reportAudioError = onError;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return false;

  audioContext ||= new AudioContextConstructor();
  loadAlertAudio().catch(() => {});
  if (audioContext.state === 'suspended') audioContext.resume().catch(reportAudioFailure);
  return true;
}

export async function playRideAlertOnce(notificationId, onError = () => {}) {
  const id = String(notificationId || '').trim();
  if (!id || playedNotificationIds.has(id)) return false;
  playedNotificationIds.add(id);
  if (playedNotificationIds.size > MAX_REMEMBERED_NOTIFICATIONS) {
    const oldestId = playedNotificationIds.values().next().value;
    playedNotificationIds.delete(oldestId);
  }
  if (document.visibilityState === 'hidden') return false;

  if (!unlockRideAlertSound(onError)) {
    reportAudioFailure(new Error('Este dispositivo não oferece suporte ao som de chamadas no app aberto.'));
    return false;
  }
  const playback = playbackQueue.then(async () => {
    await audioContext.resume();
    await loadAlertAudio();
    if (document.visibilityState === 'hidden') return false;
    playPattern();
    return true;
  });
  playbackQueue = playback.catch(error => {
    reportAudioFailure(error);
    return false;
  });
  return await playbackQueue;
}

export function stopRideAlert() {
  for (const source of activeAudioSources) {
    try {
      source.stop();
    } catch (error) {
      if (error?.name !== 'InvalidStateError') throw error;
    }
  }
  activeAudioSources.clear();
}
