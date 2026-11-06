import test from 'node:test';
import assert from 'node:assert/strict';
import { playOfferAlertOnce } from './proposal-alert.js';

test('plays once per new offer and ignores repeated events for the same offer', async () => {
  const playedSources = [];
  const listeners = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  class FakeAudio {
    constructor(source) {
      this.source = source;
      this.handlers = new Map();
    }
    addEventListener(name, callback) { this.handlers.set(name, callback); }
    removeEventListener(name) { this.handlers.delete(name); }
    play() {
      playedSources.push(this.source);
      this.handlers.get('ended')?.();
      return Promise.resolve();
    }
  }

  const first = playOfferAlertOnce('offer-alert-test-1', '/notificationCliente.mp3', () => {}, {
    Audio: FakeAudio,
    document: documentRef
  });
  assert.equal(await playOfferAlertOnce('offer-alert-test-1', '/notificationCliente.mp3', () => {}, {
    Audio: FakeAudio,
    document: documentRef
  }), false);
  assert.equal(await first, true);
  assert.equal(await playOfferAlertOnce('offer-alert-test-2', '/notificationCliente.mp3', () => {}, {
    Audio: FakeAudio,
    document: documentRef
  }), true);

  assert.deepEqual(playedSources, ['/notificationCliente.mp3', '/notificationCliente.mp3']);
});

test('does not play when an existing app session is hidden', async () => {
  let plays = 0;
  class FakeAudio {
    play() { plays += 1; return Promise.resolve(); }
    addEventListener() {}
    removeEventListener() {}
  }

  assert.equal(await playOfferAlertOnce('offer-alert-hidden-test', '/notificationCliente.mp3', () => {}, {
    Audio: FakeAudio,
    document: { visibilityState: 'hidden' }
  }), false);
  assert.equal(plays, 0);
});

test('retries one blocked alert after the next user interaction', async () => {
  const listeners = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  let attempts = 0;
  class FakeAudio {
    constructor() { this.handlers = new Map(); }
    addEventListener(name, callback) { this.handlers.set(name, callback); }
    removeEventListener(name) { this.handlers.delete(name); }
    play() {
      attempts += 1;
      if (attempts === 1) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      this.handlers.get('ended')?.();
      return Promise.resolve();
    }
  }

  const playback = playOfferAlertOnce('offer-alert-unlock-test', '/notificationCliente.mp3', () => {}, {
    Audio: FakeAudio,
    document: documentRef
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(listeners.has('pointerdown'), true);
  listeners.get('pointerdown')();
  assert.equal(await playback, true);
  assert.equal(attempts, 2);
});
