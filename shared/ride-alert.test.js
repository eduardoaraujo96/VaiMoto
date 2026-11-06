import test from 'node:test';
import assert from 'node:assert/strict';
import { playRideAlertOnce } from './ride-alert.js';
import { createUuid } from './uuid.js';

test('plays one sound for a notification ID even when Realtime and push repeat it', async t => {
  let plays = 0;
  class FakeAudioContext {
    state = 'running';
    destination = {};
    async resume() {}
    async decodeAudioData() { return { duration: 1 }; }
    createBufferSource() {
      return {
        connect() {},
        addEventListener() {},
        start() { plays += 1; },
        stop() {}
      };
    }
  }

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.document = { visibilityState: 'visible' };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  });

  const notificationId = `new-ride:${createUuid()}`;
  const results = await Promise.all([
    playRideAlertOnce(notificationId),
    playRideAlertOnce(notificationId)
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(plays, 1);
  assert.equal(await playRideAlertOnce(notificationId), false);
  assert.equal(plays, 1);
});
