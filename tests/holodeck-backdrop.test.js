'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHolodeckFixture() {
  const localStorageStore = new Map();
  const localStorageMock = {
    getItem: k => localStorageStore.get(k) ?? null,
    setItem: (k, v) => localStorageStore.set(k, String(v))
  };

  const canvasMock = {
    getContext: () => ({
      save() {},
      restore() {},
      scale() {},
      clearRect() {},
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      ellipse() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: ''
    }),
    getBoundingClientRect: () => ({ width: 800, height: 350 }),
    style: {}
  };

  const context = {
    window: {
      devicePixelRatio: 1
    },
    localStorage: localStorageMock,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: fn => 1,
    cancelAnimationFrame: id => {},
    Math,
    Object
  };

  const source = fs.readFileSync(path.join(__dirname, '../src/interface/holodeck-backdrop.js'), 'utf8');
  vm.runInNewContext(source, context);

  const Holodeck = context.DiscussionHolodeck || context.window.DiscussionHolodeck;
  Holodeck.init(canvasMock);

  return { Holodeck, canvasMock, localStorage: localStorageMock };
}

test('Holodeck backdrop initializes, tracks enabled state, and updates persistence', () => {
  const { Holodeck, canvasMock, localStorage } = createHolodeckFixture();
  assert.equal(Holodeck.enabled, true);

  Holodeck.setEnabled(false);
  assert.equal(Holodeck.enabled, false);
  assert.equal(canvasMock.style.display, 'none');
  assert.equal(localStorage.getItem('duo-voice-holodeck'), 'false');

  Holodeck.setEnabled(true);
  assert.equal(Holodeck.enabled, true);
  assert.equal(canvasMock.style.display, 'block');
  assert.equal(localStorage.getItem('duo-voice-holodeck'), 'true');
});

test('Holodeck signals track input mic audio, character output, and spring squish', () => {
  const { Holodeck } = createHolodeckFixture();

  // Test input microphone audio level
  Holodeck.signals.audio('level', { source: 'input', rms: 0.15 });
  Holodeck.signals.audio('end', { source: 'input' });

  // Test output audio levels for Momotamu and Vivi
  Holodeck.signals.audio('begin', { source: 'output', actor: 'momotamu' });
  Holodeck.signals.audio('level', { source: 'output', actor: 'momotamu', rms: 0.22 });
  Holodeck.signals.audio('end', { source: 'output', actor: 'momotamu' });

  Holodeck.signals.audio('begin', { source: 'output', actor: 'vivi' });
  Holodeck.signals.audio('level', { source: 'output', actor: 'vivi', rms: 0.18 });
  Holodeck.signals.audio('end', { source: 'output', actor: 'vivi' });

  // Test squish updates from spring reactor
  Holodeck.signals.squish('momotamu', 0.025);
  Holodeck.signals.squish('vivi', 0.015);
});

test('Holodeck triggers shockwaves on barge-in cancel and halos on backchannel', () => {
  const { Holodeck } = createHolodeckFixture();

  // Test backchannel nod halo
  assert.doesNotThrow(() => Holodeck.signals.audio('backchannel', { source: 'input', actor: 'momotamu' }));
  assert.doesNotThrow(() => Holodeck.signals.audio('backchannel', { source: 'input', actor: 'vivi' }));

  // Test barge-in interrupt shockwave
  assert.doesNotThrow(() => Holodeck.signals.cancel('momotamu'));
  assert.doesNotThrow(() => Holodeck.signals.lifecycle('stop', { manual: true, interrupted: true }));
  assert.doesNotThrow(() => Holodeck.signals.lifecycle('speaking', { actor: 'momotamu' }));
});
