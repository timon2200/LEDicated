import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentIntersectsRect } from './daw-ui.mjs';

test('segmentIntersectsRect: detects point inside rect', () => {
  const rect = { left: 100, right: 200, top: 50, bottom: 100, width: 100, height: 50 };
  assert.equal(segmentIntersectsRect(150, 75, 150, 75, rect), true);
  assert.equal(segmentIntersectsRect(50, 25, 50, 25, rect), false);
});

test('segmentIntersectsRect: horizontal swipe across row detects middle cell (high-speed gesture)', () => {
  // 3 cells in a row: L1 (10..70), C1 (80..140), R1 (150..210) at y=20..60
  const l1 = { left: 10, right: 70, top: 20, bottom: 60, width: 60, height: 40 };
  const c1 = { left: 80, right: 140, top: 20, bottom: 60, width: 60, height: 40 };
  const r1 = { left: 150, right: 210, top: 20, bottom: 60, width: 60, height: 40 };
  const l2 = { left: 10, right: 70, top: 80, bottom: 120, width: 60, height: 40 };

  // Fast cursor swipe from inside L1 (x=30, y=40) to inside R1 (x=180, y=40)
  // Notice: the cursor skipped completely past C1 between samples!
  const x1 = 30, y1 = 40, x2 = 180, y2 = 40;

  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, l1), true, 'L1 must be intersected');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, c1), true, 'C1 in the middle MUST be intersected during fast swipe');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, r1), true, 'R1 must be intersected');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, l2), false, 'L2 in row 2 must NOT be intersected');
});

test('segmentIntersectsRect: vertical swipe down column detects all 3 cells in order', () => {
  // Column C: C1 (top=10..50), C2 (top=60..100), C3 (top=110..150) at x=80..140
  const c1 = { left: 80, right: 140, top: 10, bottom: 50, width: 60, height: 40 };
  const c2 = { left: 80, right: 140, top: 60, bottom: 100, width: 60, height: 40 };
  const c3 = { left: 80, right: 140, top: 110, bottom: 150, width: 60, height: 40 };
  const r2 = { left: 160, right: 220, top: 60, bottom: 100, width: 60, height: 40 };

  // Swipe straight down column C from C1 to C3
  const x1 = 110, y1 = 20, x2 = 110, y2 = 140;

  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, c1), true, 'C1 intersected');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, c2), true, 'C2 intersected');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, c3), true, 'C3 intersected');
  assert.equal(segmentIntersectsRect(x1, y1, x2, y2, r2), false, 'R2 in column R not intersected');
});

test('segmentIntersectsRect: diagonal and grazing lines', () => {
  const rect = { left: 50, right: 100, top: 50, bottom: 100, width: 50, height: 50 };
  // Diagonal passing through
  assert.equal(segmentIntersectsRect(20, 20, 120, 120, rect), true);
  // Diagonal missing above-right
  assert.equal(segmentIntersectsRect(110, 10, 10, 110, rect), true); // crosses top-right
  assert.equal(segmentIntersectsRect(150, 10, 110, 50, rect), false); // clearly misses
});

// Minimal DOM mock for testing createPerformancePanel live drag
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty() {} };
    this.dataset = {};
    this.listeners = {};
    this._classes = new Set();
    this._textContent = '';
    this._attributes = new Map();
    this._rect = { left: 0, right: 50, top: 0, bottom: 30, width: 50, height: 30 };
  }

  animate() {
    return { cancel() {}, finished: Promise.resolve() };
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

  setAttribute(k, v) { this._attributes.set(k, String(v)); }
  getAttribute(k) { return this._attributes.get(k); }

  getBoundingClientRect() {
    return this._rect;
  }

  setBoundingRect(rect) {
    this._rect = { ...rect };
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

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const list = this.listeners[event.type] || [];
    for (const fn of list) fn.call(this, event);
    return !event.defaultPrevented;
  }

  closest(selector) {
    let curr = this;
    const isClass = selector.startsWith('.');
    const cls = isClass ? selector.slice(1) : selector;
    while (curr) {
      if (isClass && curr._classes.has(cls)) return curr;
      if (curr.tagName === selector.toUpperCase()) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const isClass = selector.startsWith('.');
    const cls = isClass ? selector.slice(1) : selector;
    const traverse = node => {
      for (const child of node.children) {
        if (isClass && child._classes.has(cls)) results.push(child);
        else if (child.tagName === selector.toUpperCase()) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

test('createPerformancePanel: live drag multiselect across row and column', async () => {
  const originalDoc = globalThis.document;
  const originalWin = globalThis.window;
  const originalStorage = globalThis.localStorage;

  const storageMap = new Map();
  globalThis.localStorage = {
    getItem: k => storageMap.get(k) || null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: k => storageMap.delete(k)
  };

  const windowListeners = {};
  globalThis.window = {
    addEventListener: (type, fn) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!windowListeners[type]) return;
      windowListeners[type] = windowListeners[type].filter(f => f !== fn);
    }
  };

  globalThis.document = {
    createElement: tag => new MockElement(tag),
    getElementById: () => null,
    body: new MockElement('body'),
    elementFromPoint: (x, y) => null
  };

  try {
    const { createPerformancePanel } = await import('./daw-performance.mjs');
    const host = new MockElement('div');
    const panel = createPerformancePanel(host, {
      status: () => {},
      blackout: () => false
    });

    const targetGrid = host.querySelector('.pf-target-grid');
    assert(targetGrid, 'targetGrid must be present in DOM');

    const buttons = targetGrid.querySelectorAll('.pf-target');
    assert.equal(buttons.length, 9, 'must render 9 bar buttons');

    // Layout the 9 buttons into a 3x3 grid geometry:
    // Row 0: L1 (10..70), C1 (80..140), R1 (150..210) at y=10..50
    // Row 1: L2 (10..70), C2 (80..140), R2 (150..210) at y=60..100
    // Row 2: L3 (10..70), C3 (80..140), R3 (150..210) at y=110..150
    const colXs = [ [10, 70], [80, 140], [150, 210] ];
    const rowYs = [ [10, 50], [60, 100], [110, 150] ];

    buttons.forEach((btn, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      btn.setBoundingRect({
        left: colXs[col][0],
        right: colXs[col][1],
        top: rowYs[row][0],
        bottom: rowYs[row][1],
        width: 60,
        height: 40
      });
    });

    // 1. Initial targets for pad 0 default is 'all'
    assert.equal(panel.desk.pads[0].targets, 'all');

    // 2. Perform Solo drag on Row 1 (L2 -> C2 -> R2) with Alt key held
    // Start at L2 (x=40, y=80)
    const l2Btn = buttons[3];
    assert.equal(l2Btn.dataset.barId, 'L2');

    targetGrid.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      altKey: true,
      shiftKey: false,
      clientX: 40,
      clientY: 80,
      target: l2Btn
    });

    // Drag horizontally across to R2 (x=180, y=80)
    for (const fn of (windowListeners['pointermove'] || [])) {
      fn({ clientX: 180, clientY: 80 });
    }

    // Release pointer
    for (const fn of (windowListeners['pointerup'] || [])) {
      fn({ clientX: 180, clientY: 80 });
    }

    // Targets should now ONLY be Row 1: ['L2', 'C2', 'R2']
    const row1Targets = panel.desk.pads[0].targets;
    assert.deepEqual(row1Targets, ['L2', 'C2', 'R2'], 'Alt-drag soloed row 2 [L2, C2, R2]');

    // Check button classes live
    assert(buttons[3].classList.contains('on'), 'L2 on');
    assert(buttons[4].classList.contains('on'), 'C2 on');
    assert(buttons[5].classList.contains('on'), 'R2 on');
    assert(!buttons[0].classList.contains('on'), 'L1 off');
    assert(!buttons[1].classList.contains('on'), 'C1 off');

    // 3. Now drag down column L (L1 -> L2 -> L3) with ADD mode
    // Starting on L1 (which is currently OFF) -> turns it ON and adds subsequent bars
    const l1Btn = buttons[0];
    targetGrid.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      altKey: false,
      shiftKey: false,
      clientX: 40,
      clientY: 30,
      target: l1Btn
    });

    // Drag down to L3 (x=40, y=130)
    for (const fn of (windowListeners['pointermove'] || [])) {
      fn({ clientX: 40, clientY: 130 });
    }

    for (const fn of (windowListeners['pointerup'] || [])) {
      fn({ clientX: 40, clientY: 130 });
    }

    // Current targets should now contain Row 1 plus Column L (L1, L2, L3, C2, R2)
    const combinedTargets = panel.desk.pads[0].targets;
    assert(combinedTargets.includes('L1'), 'L1 added');
    assert(combinedTargets.includes('L2'), 'L2 kept');
    assert(combinedTargets.includes('L3'), 'L3 added');
    assert(combinedTargets.includes('C2'), 'C2 kept');
    assert(combinedTargets.includes('R2'), 'R2 kept');

    // 4. Drag to REMOVE Row 1 (starting on L2 which is ON)
    targetGrid.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      altKey: false,
      shiftKey: false,
      clientX: 40,
      clientY: 80,
      target: l2Btn
    });

    // Drag across to R2 (x=180, y=80)
    for (const fn of (windowListeners['pointermove'] || [])) {
      fn({ clientX: 180, clientY: 80 });
    }

    for (const fn of (windowListeners['pointerup'] || [])) {
      fn({ clientX: 180, clientY: 80 });
    }

    const removedTargets = panel.desk.pads[0].targets;
    assert(!removedTargets.includes('L2'), 'L2 removed');
    assert(!removedTargets.includes('C2'), 'C2 removed');
    assert(!removedTargets.includes('R2'), 'R2 removed');
    assert(removedTargets.includes('L1'), 'L1 remains on');
    assert(removedTargets.includes('L3'), 'L3 remains on');

    // 5. Attempt to deselect all remaining bars (L1 and L3)
    // Only L1 and L3 remain. Drag from L1 to L3 in remove mode:
    targetGrid.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      altKey: false,
      shiftKey: false,
      clientX: 40,
      clientY: 30,
      target: l1Btn
    });

    for (const fn of (windowListeners['pointermove'] || [])) {
      fn({ clientX: 40, clientY: 130 });
    }

    for (const fn of (windowListeners['pointerup'] || [])) {
      fn({ clientX: 40, clientY: 130 });
    }

    // At least one bar must remain on (L3 cannot be removed if L1 was removed)
    const finalTargets = panel.desk.pads[0].targets;
    assert.equal(finalTargets.length, 1, 'at least one bar must remain on');
    assert.equal(finalTargets[0], 'L3', 'L3 was kept as the last active bar');

    // 6. Shift-drag (always adds)
    targetGrid.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      altKey: false,
      shiftKey: true,
      clientX: 110,
      clientY: 80,
      target: buttons[4] // C2
    });

    for (const fn of (windowListeners['pointermove'] || [])) {
      fn({ clientX: 180, clientY: 80 }); // swipe to R2
    }

    for (const fn of (windowListeners['pointerup'] || [])) {
      fn({ clientX: 180, clientY: 80 });
    }

    const shiftTargets = panel.desk.pads[0].targets;
    assert(shiftTargets.includes('L3'), 'L3 preserved');
    assert(shiftTargets.includes('C2'), 'C2 added by Shift-drag');
    assert(shiftTargets.includes('R2'), 'R2 added by Shift-drag');

    // 7. Verify window listeners are cleaned up
    assert.equal((windowListeners['pointermove'] || []).length, 0, 'pointermove listener cleaned up');
    assert.equal((windowListeners['pointerup'] || []).length, 0, 'pointerup listener cleaned up');
  } finally {
    globalThis.document = originalDoc;
    globalThis.window = originalWin;
    globalThis.localStorage = originalStorage;
  }
});
