import test from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal DOM mock before importing daw-playlist
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this._classes = new Set();
    this.value = '';
    this._textContent = '';
    this.width = 800;
    this.height = 600;
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent || '';
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  get classList() {
    return {
      add: (...cls) => cls.forEach(c => this._classes.add(c)),
      remove: (...cls) => cls.forEach(c => this._classes.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
      },
      contains: c => this._classes.has(c)
    };
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set className(val) {
    this._classes = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  append(...children) {
    for (const child of children) {
      if (typeof child === 'string' || typeof child === 'number') {
        const textNode = new MockElement('#text');
        textNode.textContent = String(child);
        textNode.parentNode = this;
        this.children.push(textNode);
      } else if (child) {
        child.parentNode = this;
        this.children.push(child);
      }
    }
  }

  replaceChildren(...children) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  replaceWith(replacement) {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) {
      this.parentNode.children[idx] = replacement;
      replacement.parentNode = this.parentNode;
      this.parentNode = null;
    }
  }

  addEventListener(type, fn, opts) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }

  dispatchEvent(event) {
    event.target = this;
    let curr = this;
    const path = [];
    while (curr) {
      path.push(curr);
      curr = curr.parentNode;
    }
    for (const node of path) {
      if (event._stopped) break;
      const list = node.listeners[event.type] || [];
      for (const fn of list) {
        if (event._stopped) break;
        fn.call(node, event);
      }
    }
    return !event.defaultPrevented;
  }

  closest(selector) {
    let curr = this;
    const isTag = /^[a-z]+$/i.test(selector);
    const isClass = selector.startsWith('.');
    const selectors = selector.split(',').map(s => s.trim());
    while (curr) {
      for (const sel of selectors) {
        if (sel.startsWith('.')) {
          if (curr.classList.contains(sel.slice(1))) return curr;
        } else if (curr.tagName === sel.toUpperCase()) {
          return curr;
        }
      }
      curr = curr.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = node => {
      for (const child of node.children) {
        if (selector.startsWith('.')) {
          if (child.classList.contains(selector.slice(1))) results.push(child);
        } else if (child.tagName === selector.toUpperCase()) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  setAttribute(k, v) { this[k] = v; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  select() {}
  getContext() {
    return {
      fillRect() {}, fillText() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, setLineDash() {}, save() {}, restore() {}, clearRect() {}
    };
  }
}

class MockEvent {
  constructor(type, props = {}) {
    this.type = type;
    this._stopped = false;
    this.defaultPrevented = false;
    Object.assign(this, props);
  }
  stopPropagation() { this._stopped = true; }
  preventDefault() { this.defaultPrevented = true; }
}

globalThis.document = {
  createElement: tag => new MockElement(tag),
  body: new MockElement('body'),
  addEventListener() {},
  removeEventListener() {}
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { createPlaylist } = await import('./daw-playlist.mjs');
const { createStore, normalizeTimeline } = await import('./daw-state.mjs');
const { createAutoShow } = await import('./timeline.mjs');

const analysis = () => ({ durationSec: 60, bpm: 120, beatsSec: Array.from({ length: 120 }, (_, i) => 0.25 + i * .5), features: { hopSec: .05, startSec: 0, drums: [], bass: [] } });

test('layer heads: Solo activates on first click after selecting another layer', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  assert(timeline.layers.length >= 2, 'need at least 2 layers');
  const store = createStore(timeline);
  let activeLayer = 0;
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => activeLayer,
    setActiveLayer: idx => {
      activeLayer = idx;
      playlist.updateActiveHead(idx);
    },
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  const heads = host.querySelector('.pl-heads');
  const layerRows = heads.querySelectorAll('.pl-head-layer');
  assert.equal(layerRows.length, timeline.layers.length);

  // 1. Layer 0 is currently active
  assert.equal(activeLayer, 0);
  assert.equal(layerRows[0].classList.contains('active'), true);
  assert.equal(layerRows[1].classList.contains('active'), false);

  // Find layer 1 Solo button
  const buttonsLayer1 = layerRows[1].querySelectorAll('button');
  const soloBtnLayer1 = buttonsLayer1.find(b => b.textContent === 'S');
  assert.ok(soloBtnLayer1, 'solo button exists');

  // Simulate user pressing down on Layer 1 Solo button (pointerdown)
  // then releasing (click)
  const ptrDown = new MockEvent('pointerdown', { bubbles: true, cancelable: true });
  soloBtnLayer1.dispatchEvent(ptrDown);

  // The pointerdown must NOT have destroyed the button or layerRows[1]
  assert.equal(soloBtnLayer1.parentNode.parentNode, layerRows[1]);

  // Now the click event fires
  const click = new MockEvent('click', { bubbles: true, cancelable: true });
  soloBtnLayer1.dispatchEvent(click);

  // Assert: Solo must be active on layer 1 on THIS FIRST CLICK!
  assert.equal(playlist.solo.has(timeline.layers[1].id), true, 'Layer 1 must be soloed on the first click');
});

test('layer heads: Mute toggles on first click after selecting another layer', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  let activeLayer = 0;
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => activeLayer,
    setActiveLayer: idx => {
      activeLayer = idx;
      playlist.updateActiveHead(idx);
    },
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  const heads = host.querySelector('.pl-heads');
  const layerRows = heads.querySelectorAll('.pl-head-layer');

  // Layer 0 is active
  assert.equal(activeLayer, 0);

  // Layer 1 starts enabled
  assert.equal(store.timeline.layers[1].enabled, true);

  const buttonsLayer1 = layerRows[1].querySelectorAll('button');
  const muteBtnLayer1 = buttonsLayer1.find(b => b.textContent === 'M');
  assert.ok(muteBtnLayer1, 'mute button exists');

  // Simulate pointerdown and click on Mute button of Layer 1
  muteBtnLayer1.dispatchEvent(new MockEvent('pointerdown', { bubbles: true, cancelable: true }));
  muteBtnLayer1.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));

  // Layer 1 must be muted on this first click!
  assert.equal(store.timeline.layers[1].enabled, false, 'Layer 1 must be disabled/muted on the first click');
});

test('layer heads: clicking row background switches active layer without destroying DOM', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  let activeLayer = 0;
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => activeLayer,
    setActiveLayer: idx => {
      activeLayer = idx;
      playlist.updateActiveHead(idx);
    },
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  const heads = host.querySelector('.pl-heads');
  const layerRows = heads.querySelectorAll('.pl-head-layer');
  const row1 = layerRows[1];

  // Click on row 1 directly (e.g. empty area)
  row1.dispatchEvent(new MockEvent('pointerdown', { bubbles: true, cancelable: true }));

  assert.equal(activeLayer, 1, 'active layer switched to 1');
  assert.equal(row1.classList.contains('active'), true, 'row 1 has active class');
  assert.equal(layerRows[0].classList.contains('active'), false, 'row 0 does not have active class');
  // Crucially, row1 must still be the exact same DOM node (not destroyed)
  const currentRows = heads.querySelectorAll('.pl-head-layer');
  assert.equal(currentRows[1], row1, 'DOM element was preserved and not re-created');
});

test('layer heads: double-clicking layer name replaces with input and commits rename', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  const heads = host.querySelector('.pl-heads');
  const layerRows = heads.querySelectorAll('.pl-head-layer');
  const nameSpan = layerRows[0].querySelector('.layer-name');
  assert.ok(nameSpan, 'name span exists');

  // Double click name span
  nameSpan.dispatchEvent(new MockEvent('dblclick', { bubbles: true, cancelable: true }));

  const input = layerRows[0].querySelector('.layer-name-edit');
  assert.ok(input, 'input replaced name span');
  input.value = 'Novi Atmosferski Sloj';

  // Press Enter to save
  input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.equal(store.timeline.layers[0].name, 'Novi Atmosferski Sloj', 'Layer 0 name was successfully renamed');
});

test('layer heads: clicking expand button toggles expansion and only one layer is expanded at a time', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  const heads = host.querySelector('.pl-heads');
  let layerRows = heads.querySelectorAll('.pl-head-layer');
  assert.equal(playlist.expandedLayerId, null, 'initially no layer is expanded');

  // Expand layer 0
  const expandBtn0 = layerRows[0].querySelector('.layer-expand-btn');
  expandBtn0.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(playlist.expandedLayerId, timeline.layers[0].id, 'layer 0 is now expanded');
  layerRows = heads.querySelectorAll('.pl-head-layer');
  assert.equal(layerRows[0].classList.contains('expanded'), true, 'row 0 has expanded class');
  assert.equal(layerRows[0].style.height, '180px', 'row 0 has expanded height 180px');
  assert.equal(layerRows[1].style.height, '64px', 'row 1 remains standard height 64px');

  // Now expand layer 1: accordion behavior closes layer 0
  const expandBtn1 = layerRows[1].querySelector('.layer-expand-btn');
  expandBtn1.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(playlist.expandedLayerId, timeline.layers[1].id, 'layer 1 is now expanded');
  layerRows = heads.querySelectorAll('.pl-head-layer');
  assert.equal(layerRows[0].classList.contains('expanded'), false, 'layer 0 collapsed');
  assert.equal(layerRows[1].classList.contains('expanded'), true, 'layer 1 expanded');

  // Clicking expand again on layer 1 toggles it closed
  const expandBtn1Again = layerRows[1].querySelector('.layer-expand-btn');
  expandBtn1Again.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(playlist.expandedLayerId, null, 'layer 1 closed, now null');
});

test('timeline: hit testing in expanded track distinguishes clip header, keyframe, and automation workspace', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  // Expand layer 0
  playlist.toggleExpandLayer(timeline.layers[0].id);
  assert.equal(playlist.expandedLayerId, timeline.layers[0].id);

  const clip0 = timeline.layers[0].clips[0];
  assert.ok(clip0, 'clip 0 exists');
  const clipR = playlist.clipScreenRect(0, clip0);
  assert.equal(clipR.h, 172, 'clip height in expanded mode is 180 - 8 = 172px');

  // Hit top header bar (y <= clipR.y + 20) -> should be 'clip'
  const hitHeader = playlist.hit(clipR.x + 20, clipR.y + 10);
  assert.equal(hitHeader.type, 'clip', 'header click is clip mode for moving/trimming');

  // Hit keyframe 0 at its exact coordinate
  const k0 = clip0.keyframes[0];
  const autoY = clipR.y + 20, autoH = clipR.h - 22;
  const kx0 = clipR.x + (k0.timeSec / clip0.durationSec) * clipR.w;
  const ky0 = autoY + autoH * (1 - k0.value);
  const hitKf0 = playlist.hit(kx0, ky0);
  assert.equal(hitKf0.type, 'keyframe', 'hitting first keyframe returns type keyframe');
  assert.equal(hitKf0.keyframeIndex, 0);

  // Hit middle of automation workspace (not on keyframe)
  const hitAuto = playlist.hit(clipR.x + clipR.w * 0.5, clipR.y + 100);
  assert.equal(hitAuto.type, 'automation', 'hitting empty automation area returns type automation');
});

test('timeline wheel: horizontal two-finger drag prevents browser page navigation and pans timeline', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  const host = new MockElement('div');
  const playlist = createPlaylist(host, {
    store,
    stems: { subscribe: () => {} },
    getAnalysis: () => analysis(),
    duration: () => 120,
    getTime: () => 0,
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    getSnap: () => 'beat',
    getTool: () => 'select',
    seek: () => {},
    commitSeek: () => {},
    setActiveLayer: () => {},
    status: () => {},
    newClipSpec: () => ({ preset: 'sparkle', driver: 'none', driverGain: 1, targets: 'all', color: [1, 1, 1, 0] })
  });

  class MockWheelEvent {
    constructor(props) {
      this.type = 'wheel';
      this.deltaX = 0;
      this.deltaY = 0;
      this.ctrlKey = false;
      this.metaKey = false;
      this.shiftKey = false;
      this.defaultPrevented = false;
      Object.assign(this, props);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  // Initial scrollSec is 0
  assert.equal(playlist.view.scrollSec, 0);

  // 1. Two-finger horizontal drag left (scroll forward in time)
  const fwdEvent = new MockWheelEvent({ deltaX: 40, deltaY: 2 });
  playlist.canvas.dispatchEvent(fwdEvent);
  assert.equal(fwdEvent.defaultPrevented, true, 'horizontal swipe must call preventDefault to stop Chrome history navigation');
  assert.ok(playlist.view.scrollSec > 0, 'horizontal drag increased scrollSec');
  const scrolledSec = playlist.view.scrollSec;

  // 2. Two-finger horizontal drag right back to 0
  const backEvent = new MockWheelEvent({ deltaX: -100, deltaY: 0 });
  playlist.canvas.dispatchEvent(backEvent);
  assert.equal(backEvent.defaultPrevented, true, 'swiping back calls preventDefault');
  assert.equal(playlist.view.scrollSec, 0, 'view clamped at 0');

  // 3. Swiping back when already at 0 (CRITICAL: this is where Chrome would go back a page)
  const atZeroEvent = new MockWheelEvent({ deltaX: -50, deltaY: 0 });
  playlist.canvas.dispatchEvent(atZeroEvent);
  assert.equal(atZeroEvent.defaultPrevented, true, 'must preventDefault even when at 0:00 to prevent Chrome history navigation');
  assert.equal(playlist.view.scrollSec, 0);

  // 4. Pure vertical scroll (scrolling through tracks) - should NOT preventDefault so native scroll works
  const vertEvent = new MockWheelEvent({ deltaX: 0, deltaY: 30 });
  playlist.canvas.dispatchEvent(vertEvent);
  assert.equal(vertEvent.defaultPrevented, false, 'vertical track scrolling allows native scroller scroll');

  // 5. Shift + vertical wheel pan
  const shiftEvent = new MockWheelEvent({ deltaX: 0, deltaY: 20, shiftKey: true });
  playlist.canvas.dispatchEvent(shiftEvent);
  assert.equal(shiftEvent.defaultPrevented, true, 'shift+wheel calls preventDefault');
  assert.ok(playlist.view.scrollSec > 0, 'shift+wheel panned timeline forward');
});

