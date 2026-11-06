const ALERT_AUDIO_URL = '/som_corrida.wav';
let audioContext;
let alertAudioBuffer;
let alertAudioLoading;
let playbackQueue = Promise.resolve();
let reportedAudioFailure = false;
let reportAudioError = () => {};
const playedNotificationIds = new Set();
const activeAudioSources = new Set();
const activeHtmlAudio = new Set();
const MAX_REMEMBERED_NOTIFICATIONS = 2000;
let waitingForGesture = false;
let gestureHandler = null;

function reportAudioFailure(error) {
  if (reportedAudioFailure) return;
  reportedAudioFailure = true;
  reportAudioError(error);
}

function installGestureFallback() {
  if (waitingForGesture || typeof document === 'undefined') return;
  waitingForGesture = true;
  gestureHandler = () => {
    for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
      document.removeEventListener(eventName, gestureHandler, true);
    }
    waitingForGesture = false;
    gestureHandler = null;
    unlockRideAlertSound(reportAudioError);
  };
  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(eventName, gestureHandler, { once: true, capture: true });
  }
}

function loadAlertAudio() {
  if (alertAudioBuffer) return Promise.resolve(alertAudioBuffer);
  if (alertAudioLoading) return alertAudioLoading;
  if (!audioContext) return Promise.reject(new Error('Contexto de áudio indisponível.'));
  alertAudioLoading = fetch(ALERT_AUDIO_URL)
    .then(response => {
      if (!response.ok) throw new Error(`Não foi possível carregar o som da solicitação (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(audio => audioContext.decodeAudioData(audio.slice(0)))
    .then(buffer => {
      alertAudioBuffer = buffer;
      return buffer;
    })
    .catch(error => {
      alertAudioLoading = null;
      throw error;
    });
  return alertAudioLoading;
}

function playPattern() {
  if (!alertAudioBuffer || !audioContext) return false;
  const source = audioContext.createBufferSource();
  source.buffer = alertAudioBuffer;
  source.connect(audioContext.destination);
  activeAudioSources.add(source);
  source.addEventListener('ended', () => activeAudioSources.delete(source), { once: true });
  source.start();
  return true;
}

function playHtmlAudio() {
  if (typeof Audio !== 'function') {
    throw new Error('Este dispositivo não oferece suporte à reprodução de áudio.');
  }
  const audio = new Audio(ALERT_AUDIO_URL);
  audio.preload = 'auto';
  audio.playsInline = true;
  audio.volume = 1;
  activeHtmlAudio.add(audio);
  const cleanup = () => activeHtmlAudio.delete(audio);
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  const result = audio.play();
  if (result && typeof result.then === 'function') return result.then(() => true);
  return true;
}

export function unlockRideAlertSound(onError = () => {}) {
  reportAudioError = onError;
  const AudioContextConstructor = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
  if (AudioContextConstructor) {
    audioContext ||= new AudioContextConstructor();
    loadAlertAudio().catch(() => {});
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  }
  if (typeof Audio === 'function') {
    try {
      const warmer = new Audio(ALERT_AUDIO_URL);
      warmer.preload = 'auto';
      warmer.playsInline = true;
      warmer.muted = true;
      const playResult = warmer.play();
      if (playResult && typeof playResult.then === 'function') {
        playResult.then(() => {
          warmer.pause();
          warmer.currentTime = 0;
          warmer.muted = false;
        }).catch(() => {});
      }
    } catch {
      // ignore warmup failures; playback still retries on the next alert
    }
  }
  return Boolean(AudioContextConstructor || typeof Audio === 'function');
}

async function playAlertSound() {
  if (audioContext) {
    if (audioContext.state === 'suspended') await audioContext.resume();
    try {
      await loadAlertAudio();
      if (playPattern()) return true;
    } catch {
      // fall through to HTML audio
    }
  }
  return playHtmlAudio();
}

export async function playRideAlertOnce(notificationId, onError = () => {}) {
  const id = String(notificationId || '').trim();
  if (!id || playedNotificationIds.has(id)) return false;
  playedNotificationIds.add(id);
  if (playedNotificationIds.size > MAX_REMEMBERED_NOTIFICATIONS) {
    const oldestId = playedNotificationIds.values().next().value;
    playedNotificationIds.delete(oldestId);
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;

  if (!unlockRideAlertSound(onError)) {
    playedNotificationIds.delete(id);
    reportAudioFailure(new Error('Este dispositivo não oferece suporte ao som de chamadas no app aberto.'));
    return false;
  }
  const playback = playbackQueue.then(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    try {
      await playAlertSound();
      return true;
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        playedNotificationIds.delete(id);
        installGestureFallback();
        throw error;
      }
      playedNotificationIds.delete(id);
      throw error;
    }
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
  for (const audio of activeHtmlAudio) {
    audio.pause();
    audio.currentTime = 0;
  }
  activeHtmlAudio.clear();
}
