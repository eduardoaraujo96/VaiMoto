const playedOfferIds = new Set();
const pendingPlayback = [];
const MAX_REMEMBERED_OFFERS = 2000;
let activePlayback = false;
let waitingForGesture = false;
let gestureDocument = null;
let gestureHandler = null;

function installGestureFallback(documentRef) {
  if (waitingForGesture) return;
  waitingForGesture = true;
  gestureDocument = documentRef;
  gestureHandler = () => {
    for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
      gestureDocument.removeEventListener(eventName, gestureHandler);
    }
    waitingForGesture = false;
    gestureDocument = null;
    gestureHandler = null;
    startNextPlayback();
  };
  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    documentRef.addEventListener(eventName, gestureHandler, { once: true });
  }
}

function finishPlayback(entry, error) {
  if (entry.finished) return;
  entry.finished = true;
  entry.audio.removeEventListener('ended', entry.onEnded);
  entry.audio.removeEventListener('error', entry.onError);
  activePlayback = false;

  if (error?.name === 'NotAllowedError') {
    entry.finished = false;
    pendingPlayback.unshift(entry);
    installGestureFallback(entry.document);
    return;
  }
  if (error) {
    entry.resolve(false);
    entry.onFailure(error);
  }
  startNextPlayback();
}

function startNextPlayback() {
  if (activePlayback || waitingForGesture) return;
  const entry = pendingPlayback.shift();
  if (!entry) return;
  if (entry.document.visibilityState === 'hidden') {
    entry.resolve(false);
    startNextPlayback();
    return;
  }

  activePlayback = true;
  entry.audio.addEventListener('ended', entry.onEnded, { once: true });
  entry.audio.addEventListener('error', entry.onError, { once: true });
  try {
    const result = entry.audio.play();
    if (result && typeof result.then === 'function') {
      result.then(() => entry.resolve(true)).catch(error => finishPlayback(entry, error));
    } else {
      entry.resolve(true);
    }
  } catch (error) {
    finishPlayback(entry, error);
  }
}

export function playOfferAlertOnce(offerId, audioUrl, onFailure = () => {}, environment = {}) {
  const id = String(offerId || '').trim();
  if (!id || playedOfferIds.has(id)) return Promise.resolve(false);
  playedOfferIds.add(id);
  if (playedOfferIds.size > MAX_REMEMBERED_OFFERS) {
    playedOfferIds.delete(playedOfferIds.values().next().value);
  }

  const documentRef = environment.document || globalThis.document;
  const AudioConstructor = environment.Audio || globalThis.Audio;
  if (!documentRef || documentRef.visibilityState === 'hidden') return Promise.resolve(false);
  if (typeof AudioConstructor !== 'function') {
    onFailure(new Error('Este dispositivo não oferece suporte à reprodução de áudio.'));
    return Promise.resolve(false);
  }

  let audio;
  try {
    audio = new AudioConstructor(audioUrl);
    audio.preload = 'auto';
  } catch (error) {
    onFailure(error);
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    const entry = {
      audio,
      document: documentRef,
      onFailure,
      resolve,
      finished: false,
      onEnded: () => finishPlayback(entry),
      onError: () => finishPlayback(entry, new Error('Não foi possível carregar o áudio da nova proposta.'))
    };
    pendingPlayback.push(entry);
    startNextPlayback();
  });
}
