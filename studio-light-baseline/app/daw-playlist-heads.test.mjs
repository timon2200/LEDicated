import test from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal DOM mock before importing daw-playlist
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
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
  hasPointerCapture() { return true; }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    }
  }
  contains(target) {
    let cur = target;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  focus() {}
  select() {}
  getContext() {
    if (!this._ctx) {
      const calls = [];
      this._ctx = {
        calls,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textBaseline: 'alphabetic',
        globalAlpha: 1,
        setTransform() {},
        fillRect(...args) { calls.push(['fillRect', this.fillStyle, ...args]); },
        strokeRect(...args) { calls.push(['strokeRect', this.strokeStyle, ...args]); },
        fillText(...args) { calls.push(['fillText', ...args]); },
        beginPath() { calls.push(['beginPath']); },
        closePath() {},
        arc() {},
        rect() {},
        roundRect() {},
        clip() {},
        fill() { calls.push(['fill']); },
        stroke() { calls.push(['stroke', this.strokeStyle]); },
        moveTo(...args) { calls.push(['moveTo', ...args]); },
        lineTo(...args) { calls.push(['lineTo', ...args]); },
        setLineDash() {},
        save() {},
        restore() {},
        clearRect() {},
        measureText(t) { return { width: String(t).length * 6 }; },
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; }
      };
    }
    return this._ctx;
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
  getElementById: () => null,
  body: new MockElement('body'),
  addEventListener() {},
  removeEventListener() {}
};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.Audio = class {
  constructor() { this.preload = 'none'; this.paused = true; this.currentTime = 0; this.duration = 0; }
  pause() {}
  load() {}
  async play() {}
  addEventListener() {}
  removeAttribute() {}
};

const { createPlaylist, relabelSections } = await import('./daw-playlist.mjs');
const { createBrowser } = await import('./daw-browser.mjs');
const { createStore, normalizeTimeline, addClip } = await import('./daw-state.mjs');
const { createAutoShow, SHOW_THEMES, TIMELINE_PRESETS } = await import('./timeline.mjs');

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

test('drag clip down: dragging clip past last track opens a new track, places clip there, and is undoable', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  addClip(timeline, timeline.layers[1].id, { startSec: 4, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');
  let activeLayer = 0;

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => activeLayer,
    setActiveLayer: idx => { activeLayer = idx; },
    status: () => {},
    newClipSpec: () => ({ preset: 'pulse' })
  });

  assert.equal(store.timeline.layers.length, 2, 'starts with 2 layers');
  const clip1 = store.timeline.layers[1].clips[0];
  assert.ok(clip1, 'layer 1 has clip');
  const initialStartSec = clip1.startSec;
  const clipRect = playlist.clipScreenRect(1, clip1);

  // 1. Pointerdown on the clip
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    pointerId: 1
  }));

  // 2. Drag downwards into the area below layer 1 (where the new track slot is at y >= 248)
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 50,
    clientY: 280,
    pointerId: 1
  }));

  // While dragging over the new track zone, the new layer is opened and the clip is placed on it
  assert.equal(store.timeline.layers.length, 3, 'new layer opened during drag');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'clip placed on new layer');
  assert.equal(store.timeline.layers[2].clips[0].id, clip1.id, 'clip ID matches');

  // 3. Pointerup to drop and place it there
  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect.x + 50,
    clientY: 280,
    pointerId: 1
  }));

  // Committed state: 3 layers, clip on layer 2
  assert.equal(store.timeline.layers.length, 3, 'still has 3 layers after drop');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'clip permanently on layer 2');
  assert.equal(store.timeline.layers[1].clips.length, 0, 'layer 1 no longer has the clip');
  assert.equal(activeLayer, 2, 'newly opened track is active');

  // 4. Test Undo
  assert.ok(store.canUndo, 'can undo track creation and move');
  store.undo();
  assert.equal(store.timeline.layers.length, 2, 'undo removed the opened track');
  assert.equal(store.timeline.layers[1].clips.length, 1, 'clip returned to layer 1');
  assert.equal(store.timeline.layers[1].clips[0].startSec, initialStartSec, 'clip returned to original time');

  // 5. Test Redo
  assert.ok(store.canRedo, 'can redo');
  store.redo();
  assert.equal(store.timeline.layers.length, 3, 'redo restored opened track');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'clip back on layer 2');
});

test('drag clip down and back up: dragging clip down to new track slot then returning to existing track does not open new track', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  addClip(timeline, timeline.layers[1].id, { startSec: 4, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const clip1 = store.timeline.layers[1].clips[0];
  const clipRect = playlist.clipScreenRect(1, clip1);

  // 1. Pointerdown on clip
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    pointerId: 1
  }));

  // 2. Drag down into new track zone
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 10,
    clientY: 280,
    pointerId: 1
  }));
  assert.equal(store.timeline.layers.length, 3, 'temporary 3rd layer created while hovering down');

  // 3. Move back up to layer 1 (y = 200 is within layer 1 at 184..248)
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 10,
    clientY: 200,
    pointerId: 1
  }));
  assert.equal(store.timeline.layers.length, 2, 'temporary 3rd layer cleaned up when returning up');
  assert.equal(store.timeline.layers[1].clips.length, 1, 'clip back in layer 1');

  // 4. Release
  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect.x + 10,
    clientY: 200,
    pointerId: 1
  }));
  assert.equal(store.timeline.layers.length, 2, 'remains 2 layers after release');
});

test('drag clip down and cancel: pointercancel rolls back new track and restores clip position', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  addClip(timeline, timeline.layers[1].id, { startSec: 4, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const clip1 = store.timeline.layers[1].clips[0];
  const clipRect = playlist.clipScreenRect(1, clip1);

  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    pointerId: 1
  }));

  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 50,
    clientY: 280,
    pointerId: 1
  }));
  assert.equal(store.timeline.layers.length, 3);

  // Cancel gesture
  playlist.canvas.dispatchEvent(new MockEvent('pointercancel', { pointerId: 1 }));
  assert.equal(store.timeline.layers.length, 2, 'pointercancel restored 2 layers');
  assert.equal(store.timeline.layers[1].clips[0].id, clip1.id, 'clip restored to layer 1');
});

test('alt-drag clip down: duplicates clip and places duplicate onto newly opened track', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  addClip(timeline, timeline.layers[1].id, { startSec: 4, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const origClip = store.timeline.layers[1].clips[0];
  const clipRect = playlist.clipScreenRect(1, origClip);

  // Alt-drag (duplicate)
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    altKey: true,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    pointerId: 1
  }));

  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 50,
    clientY: 280,
    pointerId: 1
  }));

  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect.x + 50,
    clientY: 280,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers.length, 3, '3 layers after alt-drag to new track');
  assert.equal(store.timeline.layers[1].clips.length, 1, 'original clip preserved on layer 1');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'duplicate placed on layer 2');
  assert.notEqual(store.timeline.layers[2].clips[0].id, origClip.id, 'duplicate has a unique clip ID');
});

test('preset drag & drop onto new track zone opens a new track and creates clip', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  assert.equal(store.timeline.layers.length, 2);

  // Drop preset at y = 280 (new track zone below layer 1)
  const dropEvent = new MockEvent('drop', {
    clientX: 100,
    clientY: 280,
    dataTransfer: {
      getData: type => type === 'application/x-ledicated-preset' ? 'sparkle' : ''
    }
  });

  playlist.canvas.dispatchEvent(dropEvent);
  assert.equal(store.timeline.layers.length, 3, 'drop opened a new track');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'clip created on new layer');
  assert.equal(store.timeline.layers[2].clips[0].preset, 'sparkle');
});

test('multi-select drag clip down: dragging multi-selected clips down shifts relative tracks and opens a new track for the bottom clip', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  const clip0 = timeline.layers[0].clips[0];
  const clip1 = addClip(timeline, timeline.layers[1].id, { startSec: 4, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  // Select both clips
  playlist.setSelection([
    { layerId: timeline.layers[0].id, clipId: clip0.id },
    { layerId: timeline.layers[1].id, clipId: clip1.clipId }
  ]);

  const clip1Obj = store.timeline.layers[1].clips.find(c => c.id === clip1.clipId);
  const clipRect1 = playlist.clipScreenRect(1, clip1Obj);

  // Drag anchor clip (clip1 on layer 1) down to new track slot (y = 280)
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect1.x + 10,
    clientY: clipRect1.y + 10,
    pointerId: 1
  }));

  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect1.x + 10,
    clientY: 280,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers.length, 3, '3 layers opened');
  // Clip0 should have moved from layer 0 to layer 1
  assert.equal(store.timeline.layers[1].clips[0].id, clip0.id, 'clip0 moved to layer 1');
  // Clip1 should have moved from layer 1 to layer 2 (the new layer)
  assert.equal(store.timeline.layers[2].clips[0].id, clip1.clipId, 'clip1 moved to new layer 2');

  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect1.x + 10,
    clientY: 280,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers.length, 3, 'permanently 3 layers');

  // Test Undo
  store.undo();
  assert.equal(store.timeline.layers.length, 2, 'undo back to 2 layers');
  assert.equal(store.timeline.layers[0].clips[0].id, clip0.id, 'clip0 back on layer 0');
  assert.equal(store.timeline.layers[1].clips[0].id, clip1.clipId, 'clip1 back on layer 1');
});

test('shift-drag clip down: locks horizontal position and moves vertically to track below', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 3);
  timeline.layers.forEach(l => { l.clips = []; });
  addClip(timeline, timeline.layers[0].id, { startSec: 12.5, durationSec: 4, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');
  let activeLayer = 0;

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => activeLayer,
    setActiveLayer: idx => { activeLayer = idx; },
    status: () => {},
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const clip0 = store.timeline.layers[0].clips[0];
  const initialStartSec = clip0.startSec; // 12.5
  const clipRect0 = playlist.clipScreenRect(0, clip0);

  // 1. Pointerdown on clip with shiftKey: true
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect0.x + 10,
    clientY: clipRect0.y + 10,
    shiftKey: true,
    pointerId: 1
  }));

  // 2. Pointermove with huge horizontal drift (clientX + 150) and vertical move into layer 1
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect0.x + 150,
    clientY: clipRect0.y + 70, // move down into layer 1
    shiftKey: true,
    pointerId: 1
  }));

  // Clip must have moved to layer 1, and its startSec MUST BE EXACTLY initialStartSec (12.5), not drifted!
  assert.equal(store.timeline.layers[0].clips.length, 0, 'layer 0 has no clips');
  assert.equal(store.timeline.layers[1].clips.length, 1, 'clip moved to layer 1');
  assert.equal(store.timeline.layers[1].clips[0].startSec, initialStartSec, 'startSec perfectly locked horizontally');
  assert.equal(store.timeline.layers[1].clips[0].durationSec, 4, 'duration unchanged');

  // 3. Pointerup
  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect0.x + 150,
    clientY: clipRect0.y + 70,
    shiftKey: true,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers[1].clips[0].startSec, initialStartSec, 'persisted startSec is unchanged');
});

test('drag clip with Shift pressed mid-drag: dynamically snaps back to original startSec', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 3);
  timeline.layers.forEach(l => { l.clips = []; });
  addClip(timeline, timeline.layers[0].id, { startSec: 8.0, durationSec: 3, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const clip = store.timeline.layers[0].clips[0];
  const clipId = clip.id;
  const clipRect = playlist.clipScreenRect(0, clip);

  // 1. Pointerdown without shift
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    shiftKey: false,
    pointerId: 1
  }));

  // 2. Drag with horizontal move without shift (clientX + 60) down to layer 1
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 60,
    clientY: clipRect.y + 70,
    shiftKey: false,
    pointerId: 1
  }));

  // Without Shift, clip startSec shifted forward
  const movedStart = store.timeline.layers[1].clips[0].startSec;
  assert.ok(movedStart > 8.0, 'startSec shifted without Shift');

  // 3. User now holds Shift mid-drag
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 60,
    clientY: clipRect.y + 70,
    shiftKey: true,
    pointerId: 1
  }));

  // Now clip snaps back to exact 8.0!
  assert.equal(store.timeline.layers[1].clips[0].startSec, 8.0, 'snaps back to 8.0 when Shift is held');

  // 4. Release Shift mid-drag again
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 60,
    clientY: clipRect.y + 70,
    shiftKey: false,
    pointerId: 1
  }));

  assert.ok(store.timeline.layers[1].clips[0].startSec > 8.0, 'un-locks when Shift is released');

  // 5. Press Shift again and drop
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 60,
    clientY: clipRect.y + 70,
    shiftKey: true,
    pointerId: 1
  }));
  assert.equal(store.timeline.layers[1].clips[0].startSec, 8.0, 'snaps back again');

  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect.x + 60,
    clientY: clipRect.y + 70,
    shiftKey: true,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers[1].clips[0].startSec, 8.0, 'dropped at exact original startSec');
});

test('shift-drag down to new track opens layer and keeps horizontal lock', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 2);
  timeline.layers.forEach(l => { l.clips = []; });
  addClip(timeline, timeline.layers[1].id, { startSec: 15.0, durationSec: 5, preset: 'pulse' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const clip = store.timeline.layers[1].clips[0];
  const clipRect = playlist.clipScreenRect(1, clip);

  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: clipRect.x + 10,
    clientY: clipRect.y + 10,
    shiftKey: true,
    pointerId: 1
  }));

  // Drag down past last layer (y = 280) and horizontally far away (clientX + 120)
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: clipRect.x + 120,
    clientY: 280,
    shiftKey: true,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers.length, 3, 'new layer opened');
  assert.equal(store.timeline.layers[2].clips.length, 1, 'clip placed on new layer');
  assert.equal(store.timeline.layers[2].clips[0].startSec, 15.0, 'startSec perfectly locked at 15.0 on new track');

  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: clipRect.x + 120,
    clientY: 280,
    shiftKey: true,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers[2].clips[0].startSec, 15.0, 'committed at 15.0');
});

test('multi-select shift-drag: moves all selected clips down to target tracks with horizontal lock', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  timeline.layers = timeline.layers.slice(0, 3);
  timeline.layers.forEach(l => { l.clips = []; });
  const clipA = addClip(timeline, timeline.layers[0].id, { startSec: 4.0, durationSec: 2, preset: 'pulse' });
  const clipB = addClip(timeline, timeline.layers[0].id, { startSec: 10.0, durationSec: 3, preset: 'flash' });
  const store = createStore(timeline);
  const host = new MockElement('div');

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'none',
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
    newClipSpec: () => ({ preset: 'pulse' })
  });

  // Select both clips
  playlist.setSelection([clipA, clipB]);

  const clipObjA = store.timeline.layers[0].clips.find(c => c.id === clipA.clipId);
  const rectA = playlist.clipScreenRect(0, clipObjA);

  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: rectA.x + 10,
    clientY: rectA.y + 10,
    shiftKey: true,
    pointerId: 1
  }));

  // Drag down to layer 1, with horizontal motion +80px
  playlist.canvas.dispatchEvent(new MockEvent('pointermove', {
    clientX: rectA.x + 80,
    clientY: rectA.y + 70,
    shiftKey: true,
    pointerId: 1
  }));

  assert.equal(store.timeline.layers[0].clips.length, 0, 'layer 0 has no clips');
  assert.equal(store.timeline.layers[1].clips.length, 2, 'both clips moved to layer 1');
  const movedA = store.timeline.layers[1].clips.find(c => c.id === clipA.clipId);
  const movedB = store.timeline.layers[1].clips.find(c => c.id === clipB.clipId);
  assert.equal(movedA.startSec, 4.0, 'clipA kept startSec 4.0');
  assert.equal(movedB.startSec, 10.0, 'clipB kept startSec 10.0');

  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    clientX: rectA.x + 80,
    clientY: rectA.y + 70,
    shiftKey: true,
    pointerId: 1
  }));
});

test('playhead alignment & scrub: scrollbar gutter syncs top/bottom rows and snap-click commits seek', () => {
  const timeline = normalizeTimeline(createAutoShow(analysis()));
  const store = createStore(timeline);
  const host = new MockElement('div');
  const seeks = [];
  let commits = 0;

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => analysis(),
    duration: () => 60,
    getTime: () => seeks.length ? seeks[seeks.length - 1].sec : 0,
    seek: (sec, isScrubbing) => seeks.push({ sec, isScrubbing }),
    commitSeek: () => { commits++; },
    getSnap: () => 1,
    getTool: () => 'select',
    isPlaying: () => true,
    hasTrack: () => true,
    getTrackTitle: () => 'Test Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const scroller = host.querySelector('.pl-scroll');
  const topRow = host.querySelector('.pl-top');
  const bottomRow = host.querySelector('.pl-bottom');
  scroller.offsetWidth = 1009;
  scroller.clientWidth = 1000;
  playlist.fit();

  assert.equal(topRow.style.paddingRight, '9px', 'top row accounts for 9px vertical scrollbar');
  assert.equal(bottomRow.style.paddingRight, '9px', 'bottom row accounts for 9px vertical scrollbar');

  // Click without dragging on waveform with snap enabled: must snap AND call commitSeek
  playlist.canvas.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: 200,
    clientY: 20,
    pointerId: 1
  }));
  playlist.canvas.dispatchEvent(new MockEvent('pointerup', {
    button: 0,
    clientX: 200,
    clientY: 20,
    pointerId: 1
  }));

  assert.equal(commits, 1, 'commitSeek called after snap click on waveform');
  assert.equal(seeks[seeks.length - 1].isScrubbing, false, 'final seek on pointerup is non-scrubbing');

  // Click without dragging on ruler with snap enabled: must snap AND call commitSeek
  const ruler = host.querySelector('.pl-ruler');
  ruler.hasPointerCapture = () => true;
  ruler.dispatchEvent(new MockEvent('pointerdown', {
    button: 0,
    clientX: 300,
    clientY: 8,
    pointerId: 2
  }));
  ruler.dispatchEvent(new MockEvent('pointerup', {
    button: 0,
    clientX: 300,
    clientY: 8,
    pointerId: 2
  }));

  assert.equal(commits, 2, 'commitSeek called after snap click on ruler');
});

test('high-res multi-band waveform: computePeaks and drawWave support asymmetric min/max, 3-band spectral colors, cubic zoom, and pcmMono', () => {
  const bins = 60;
  const peaks = Array.from({ length: bins }, (_, i) => Math.min(1, 0.2 + (i % 10) * 0.08));
  const min = peaks.map(v => -v * 0.7);
  const max = peaks.map(v => v * 0.95);
  const rms = peaks.map(v => v * 0.55);
  const low = Array.from({ length: bins }, (_, i) => i < 20 ? 0.9 : 0.1);
  const mid = Array.from({ length: bins }, (_, i) => (i >= 20 && i < 40) ? 0.9 : 0.15);
  const high = Array.from({ length: bins }, (_, i) => i >= 40 ? 0.95 : 0.1);
  const pcmMono = new Float32Array(4410);
  for (let i = 0; i < pcmMono.length; i++) pcmMono[i] = Math.sin(i * 0.1) * 0.8;

  const trackAnalysis = {
    durationSec: 60,
    bpm: 120,
    beatsSec: Array.from({ length: 120 }, (_, i) => i * 0.5),
    waveform: { binSec: 1.0, peaks, min, max, rms, low, mid, high },
    features: { hopSec: 0.05, startSec: 0, drums: [0.5], bass: [0.5] }
  };

  const timeline = normalizeTimeline(createAutoShow(trackAnalysis));
  const store = createStore(timeline);
  const host = new MockElement('div');
  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => trackAnalysis,
    duration: () => 60,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'beat',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Spectral Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    getLoop: () => null,
    setLoop: () => {},
    isLoopOn: () => false,
    newClipSpec: () => ({ preset: 'pulse' })
  });

  const computed = playlist.computePeaks();
  assert.ok(computed, 'computePeaks returns object');
  assert.equal(computed.min.length, bins);
  assert.equal(computed.max.length, bins);
  assert.equal(computed.low.length, bins);
  assert.equal(computed.mid.length, bins);
  assert.equal(computed.high.length, bins);
  assert.ok(computed.min[0] < 0, 'min envelope is negative');
  assert.ok(computed.max[0] > 0, 'max envelope is positive');

  // Overview draw (perPx >= 1.2)
  playlist.fit();
  playlist.draw();
  const gCalls = playlist.canvas.getContext().calls;
  assert.ok(gCalls.some(c => c[0] === 'stroke'), 'draws crisp 1px top/bottom peak outline stroke');
  assert.ok(gCalls.some(c => c[0] === 'fillRect' && String(c[1]).startsWith('rgba(')), 'draws 3-band spectral rgba columns');

  // High zoom (30x -> perPx < 1.2) with cubic interpolation and pcmMono
  trackAnalysis.pcmMono = pcmMono;
  trackAnalysis.pcmSampleRate = 4410;
  playlist.zoomAround(30, 0, 0);
  playlist.draw();
  assert.equal(playlist.computePeaks().pcmMono, pcmMono, 'picks up attached pcmMono buffer');
});

test('interactive section ruler: boundary hover/drag, relabeling, type change + regeneration, split, and merge', () => {
  const trackAnalysis = {
    durationSec: 64,
    bpm: 120,
    beatsSec: Array.from({ length: 128 }, (_, i) => i * 0.5),
    features: { hopSec: 0.05, startSec: 0, drums: [0.6, 0.8], bass: [0.5, 0.7] },
    sections: [
      { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 16, durationSec: 16, color: '#3a86ff' },
      { id: 'sec-2', name: 'Gradnja', type: 'build', startSec: 16, endSec: 32, durationSec: 16, color: '#ffb703' },
      { id: 'sec-3', name: 'Drop', type: 'drop', startSec: 32, endSec: 48, durationSec: 16, color: '#ff0054' },
      { id: 'sec-4', name: 'Završetak', type: 'outro', startSec: 48, endSec: 64, durationSec: 16, color: '#48cae4' }
    ]
  };

  const timeline = normalizeTimeline(createAutoShow(trackAnalysis));
  const store = createStore(timeline);
  const host = new MockElement('div');
  const sectionChanges = [];

  const playlist = createPlaylist(host, {
    store,
    getAnalysis: () => trackAnalysis,
    duration: () => 64,
    getTime: () => 0,
    seek: () => {},
    commitSeek: () => {},
    getSnap: () => 'bar',
    getTool: () => 'select',
    isPlaying: () => false,
    hasTrack: () => true,
    getTrackTitle: () => 'Sections Track',
    isAudioMuted: () => false,
    toggleAudioMute: () => {},
    getVolume: () => 1,
    setVolume: () => {},
    getActiveLayerIndex: () => 0,
    setActiveLayer: () => {},
    status: () => {},
    getLoop: () => null,
    setLoop: () => {},
    isLoopOn: () => false,
    onSectionsChange: (secs, meta) => sectionChanges.push({ count: secs.length, meta }),
    getThemeOptions: () => ({ palette: 'cyber', theme: 'cyber', energy: 0.9 }),
    newClipSpec: () => ({ preset: 'pulse' })
  });

  playlist.fit(); // width = 800, duration = 64 => pps = 12.5
  const ruler = playlist.ruler;
  // Section 1 boundary is at 16s => x = 16 * 12.5 = 200px, y = 40 (inside RULER_SECTIONS >= 32)
  ruler.dispatchEvent(new MockEvent('pointermove', { clientX: 200, clientY: 40, pointerId: 1 }));
  assert.equal(ruler.style.cursor, 'ew-resize', 'cursor is ew-resize near internal section boundary');

  // Hover over section body at x = 100px (8s)
  ruler.dispatchEvent(new MockEvent('pointermove', { clientX: 100, clientY: 40, pointerId: 1 }));
  assert.equal(ruler.style.cursor, 'pointer', 'cursor is pointer over section pill');

  // Drag boundary at x = 200px (16s) to x = 250px (20s, which is bar-aligned at 120 BPM where 1 bar = 2.0s)
  ruler.dispatchEvent(new MockEvent('pointerdown', { button: 0, clientX: 200, clientY: 40, pointerId: 1 }));
  ruler.dispatchEvent(new MockEvent('pointermove', { clientX: 250, clientY: 40, pointerId: 1 }));
  ruler.dispatchEvent(new MockEvent('pointerup', { clientX: 250, clientY: 40, pointerId: 1 }));

  assert.equal(trackAnalysis.sections[0].endSec, 20, 'prevSec.endSec snapped to 20s');
  assert.equal(trackAnalysis.sections[0].durationSec, 20, 'prevSec.durationSec updated to 20s');
  assert.equal(trackAnalysis.sections[1].startSec, 20, 'curSec.startSec updated to 20s');
  assert.equal(trackAnalysis.sections[1].durationSec, 12, 'curSec.durationSec updated to 12s');
  assert.ok(sectionChanges.length >= 1, 'onSectionsChange called after boundary drag');

  // Change section 1 from 'build' to 'drop' with regeneration
  playlist.setSectionType(1, 'drop', { regenerate: true });
  assert.equal(trackAnalysis.sections[1].type, 'drop');
  assert.equal(trackAnalysis.sections[1].name, 'Drop 1', 'relabels multiple drops as Drop 1, Drop 2');
  assert.equal(trackAnalysis.sections[2].name, 'Drop 2');

  // Split section 2 (32s..48s) at 40s
  playlist.splitSectionAt(2, 40);
  assert.equal(trackAnalysis.sections.length, 5, 'section split into two');
  assert.equal(trackAnalysis.sections[2].endSec, 40);
  assert.equal(trackAnalysis.sections[3].startSec, 40);

  // Merge section 2 and 3 back together
  playlist.mergeSectionWithNext(2);
  assert.equal(trackAnalysis.sections.length, 4, 'sections merged back to 4');
  assert.equal(trackAnalysis.sections[2].startSec, 32);
  assert.equal(trackAnalysis.sections[2].endSec, 48);
});

test('Theme & Style Studio in daw-browser: 8 themes, 4 color pickers, effect whitelist chips, and getThemeOptions', () => {
  const host = new MockElement('div');
  let generatedArgs = null;
  const browser = createBrowser(host, {
    status: () => {},
    selectTrack: async () => {},
    generateShow: opts => { generatedArgs = opts; },
    addPreset: () => {},
    getAnalysis: () => ({ sections: [{ name: 'Drop', startSec: 0, endSec: 16, color: '#ff0054' }] }),
    setLoop: () => {},
    seek: () => {}
  });

  // Switch to 'Auto show' tab
  const tabBtns = host.querySelector('.tabs').querySelectorAll('button');
  const showTabBtn = tabBtns.find(b => b.textContent === 'Auto show');
  assert.ok(showTabBtn, 'Auto show tab exists');
  showTabBtn.dispatchEvent(new MockEvent('click'));

  const select = host.querySelector('.theme-select');
  assert.ok(select, 'theme selector exists');
  const options = select.querySelectorAll('option');
  assert.equal(options.length, 8, 'lists all 8 themes from SHOW_THEMES');

  const colorPickers = host.querySelectorAll('.theme-color-picker');
  assert.equal(colorPickers.length, 4, 'renders 4 color pickers (Baza, Bas, Sint, Akcent)');

  const chips = host.querySelectorAll('.theme-fx-chip');
  assert.equal(chips.length, 16, 'renders 16 effect whitelist chips');
  assert.ok(chips.every(c => c.classList.contains('on')), 'all 16 chips initially active');

  // Uncheck all but 1 chip, then try to uncheck the last one -> must remain checked
  for (let i = 0; i < chips.length - 1; i++) {
    chips[i].dispatchEvent(new MockEvent('click'));
  }
  assert.equal(browser.getThemeOptions().allowedPresets.length, 1, '1 chip left');
  chips[chips.length - 1].dispatchEvent(new MockEvent('click'));
  assert.equal(browser.getThemeOptions().allowedPresets.length, 1, 'never allows 0 chips selected');

  // Change theme to 'rave' and tweak a color picker
  select.value = 'rave';
  select.dispatchEvent(new MockEvent('change'));
  assert.equal(browser.getThemeOptions().theme, 'rave');
  assert.equal(browser.getThemeOptions().customColors, null, 'customColors is null before manual edit');

  colorPickers[0].value = '#ff1188';
  colorPickers[0].dispatchEvent(new MockEvent('input'));
  assert.equal(browser.getThemeOptions().customColors.length, 4, 'customColors populated after color picker edit');

  // Click Generiraj show s temom
  const genBtn = host.querySelectorAll('button').find(b => b.textContent === 'Generiraj show s temom');
  assert.ok(genBtn, 'generate button exists');
  genBtn.dispatchEvent(new MockEvent('click'));
  assert.ok(generatedArgs, 'generateShow called');
  assert.equal(generatedArgs.theme, 'rave');
  assert.equal(generatedArgs.customColors.length, 4);
});




