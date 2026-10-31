import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrackTitle,
  fmtDuration,
  drawCardBanner,
  extractYouTubeId,
  getTrackThumbnailUrls
} from './daw-browser.mjs';
import { showMenu, closeMenu } from './daw-ui.mjs';

test('parseTrackTitle parses artist and title correctly', () => {
  const t1 = parseTrackTitle('Klangkuenstler, Ski Aggu - Sonne Geht Auf (full track)');
  assert.equal(t1.artist, 'Klangkuenstler, Ski Aggu');
  assert.equal(t1.title, 'Sonne Geht Auf (full track)');

  const t2 = parseTrackTitle('Sounds');
  assert.equal(t2.artist, '');
  assert.equal(t2.title, 'Sounds');

  const t3 = parseTrackTitle('Artist - Track - Remix');
  assert.equal(t3.artist, 'Artist');
  assert.equal(t3.title, 'Track - Remix');

  const t4 = parseTrackTitle('');
  assert.equal(t4.title, 'Nepoznato');
});

test('fmtDuration formats duration in minutes and seconds', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(45), '0:45');
  assert.equal(fmtDuration(75), '1:15');
  assert.equal(fmtDuration(273.85), '4:33');
  assert.equal(fmtDuration(-10), '0:00');
  assert.equal(fmtDuration(null), '0:00');
});

test('extractYouTubeId and getTrackThumbnailUrls resolve artwork and YouTube fallback URLs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=oelcyQCQmCI'), 'oelcyQCQmCI');
  assert.equal(extractYouTubeId('https://youtu.be/WVH12tO6n6Q?si=123'), 'WVH12tO6n6Q');
  assert.equal(extractYouTubeId('not-a-url'), null);

  const urls1 = getTrackThumbnailUrls({
    id: '12f110db-ca50-44ff-965a-5b54bf553c2c',
    videoId: 'oelcyQCQmCI'
  });
  assert.deepEqual(urls1, [
    '/api/library/artwork/12f110db-ca50-44ff-965a-5b54bf553c2c',
    'https://i.ytimg.com/vi/oelcyQCQmCI/hqdefault.jpg'
  ]);

  const urls2 = getTrackThumbnailUrls({
    sourceUrl: 'https://www.youtube.com/watch?v=hQgXFSzWGXs'
  });
  assert.deepEqual(urls2, [
    'https://i.ytimg.com/vi/hQgXFSzWGXs/hqdefault.jpg'
  ]);
});

test('drawCardBanner renders onto a canvas mock without error with and without thumbnail', () => {
  const operations = [];
  const fakeCanvas = {
    width: 320,
    height: 142,
    getContext: () => ({
      clearRect: (...args) => operations.push(['clearRect', args]),
      createLinearGradient: () => ({
        addColorStop: (...args) => operations.push(['addColorStop', args])
      }),
      fillRect: (...args) => operations.push(['fillRect', args]),
      beginPath: () => operations.push(['beginPath']),
      moveTo: () => operations.push(['moveTo']),
      lineTo: () => operations.push(['lineTo']),
      stroke: () => operations.push(['stroke'])
    })
  };

  const track = { title: 'Klangkuenstler, Ski Aggu - Sonne Geht Auf (full track)' };
  const analysis = { bpm: 156.6, energy: 0.9, envelopes: { energy: [0.2, 0.8, 0.95, 0.5] } };

  assert.doesNotThrow(() => {
    drawCardBanner(fakeCanvas, track, analysis, false, false);
    drawCardBanner(fakeCanvas, track, analysis, true, true);
  });
  assert(operations.length > 10, 'Canvas operations performed');
});

test('showMenu promotes context menu to Top Layer via popover API and flips near viewport edges', () => {
  let popoverShown = false;
  let popoverHidden = false;
  const appended = [];

  const prevDoc = globalThis.document;
  const prevWinW = globalThis.innerWidth;
  const prevWinH = globalThis.innerHeight;
  const prevAddEv = globalThis.addEventListener;
  const prevRemEv = globalThis.removeEventListener;

  globalThis.innerWidth = 1000;
  globalThis.innerHeight = 700;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};

  const makeNode = tag => {
    const attrs = {};
    const children = [];
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      style: { setProperty(k, v) { this[k] = v; } },
      dataset: {},
      children,
      setAttribute(k, v) { attrs[k] = v; },
      getAttribute(k) { return attrs[k]; },
      append(...items) { children.push(...items); },
      addEventListener() {},
      querySelector() { return children[0] || null; },
      querySelectorAll() { return children; },
      contains() { return false; },
      focus() {},
      remove() {},
      showPopover() { popoverShown = true; },
      hidePopover() { popoverHidden = true; },
      getBoundingClientRect() { return { width: 220, height: 180 }; }
    };
    return node;
  };

  globalThis.document = {
    createElement: makeNode,
    body: { append(n) { appended.push(n); } }
  };

  try {
    const triggerRect = { left: 880, right: 912, top: 600, bottom: 632 };
    const menu = showMenu(triggerRect.left, triggerRect.bottom + 6, [
      { label: 'Otvori u studiju', onClick: () => {} }
    ], triggerRect);

    assert.equal(menu.getAttribute('popover'), 'manual');
    assert.equal(popoverShown, true, 'showPopover() must be called to enter Top Layer above modal dialog');
    // Since 880 + 220 > 1000 - 8, left flips to anchorRect.right - width = 912 - 220 = 692
    assert.equal(menu.style.left, '692px');
    // Since 638 + 180 > 700 - 8, top flips to anchorRect.top - height - 6 = 600 - 180 - 6 = 414
    assert.equal(menu.style.top, '414px');

    closeMenu();
    assert.equal(popoverHidden, true, 'hidePopover() must be called on closeMenu()');
  } finally {
    globalThis.document = prevDoc;
    globalThis.innerWidth = prevWinW;
    globalThis.innerHeight = prevWinH;
    globalThis.addEventListener = prevAddEv;
    globalThis.removeEventListener = prevRemEv;
  }
});
