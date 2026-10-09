import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createLibrary } from './library.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ledicated-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createLibrary({ root: join(root, 'data'), maxAudioBytes: 1024, ...options });
  return { root, library };
}

test('imports a local file, deduplicates by content and persists a song project', async t => {
  const { root, library } = await fixture(t);
  const source = join(root, 'little.mp3');
  await writeFile(source, Buffer.from('ID3small test audio'));
  const first = await library.importFile(source);
  assert.equal(first.title, 'little');
  assert.equal(first.projectId, first.id);
  assert.equal((await readFile(await library.getAudioPath(first.id))).toString(), 'ID3small test audio');
  const same = await library.importBuffer('other.MP3', Buffer.from('ID3small test audio'));
  assert.equal(same.id, first.id);
  assert.equal((await library.list()).length, 1);
  const reopened = createLibrary({ root: join(root, 'data'), maxAudioBytes: 1024 });
  assert.deepEqual(await reopened.getTrack(first.id), first);
});

test('timeline, analysis, track edits and ordered sets persist; deletion cleans references', async t => {
  const { root, library } = await fixture(t);
  const a = await library.importBuffer('a.mp3', Buffer.from('ID3one'));
  const b = await library.importBuffer('b.wav', Buffer.from('RIFFtwo'));
  await library.saveTimeline(a.id, { version: 1, layers: [{ id: 'kick', keyframes: [{ time: 1, value: 1 }] }] });
  await library.setAnalysis(a.id, { bpm: 128, beats: [0, 0.46875] });
  await library.updateTrack(a.id, { title: 'Opening' });
  const set = await library.createSet('Club', [a.id, b.id, a.id]);
  assert.deepEqual((await library.getTimeline(a.id)).layers[0].keyframes, [{ time: 1, value: 1 }]);
  assert.equal((await library.getAnalysis(a.id)).bpm, 128);
  assert.deepEqual((await library.getSet(set.id)).trackIds, [a.id, b.id, a.id]);
  const reopened = createLibrary({ root: join(root, 'data'), maxAudioBytes: 1024 });
  assert.equal((await reopened.getTrack(a.id)).title, 'Opening');
  assert.equal((await reopened.getAnalysis(a.id)).bpm, 128);
  await reopened.deleteTrack(a.id);
  assert.deepEqual((await reopened.getSet(set.id)).trackIds, [b.id]);
  assert.equal((await readdir(join(root, 'data', 'audio'))).length, 1);
  await reopened.updateSet(set.id, { name: 'Closing', trackIds: [b.id] });
  assert.equal((await reopened.getSet(set.id)).name, 'Closing');
  await reopened.deleteSet(set.id);
  assert.deepEqual(await reopened.listSets(), []);
});

test('rejects unsafe filenames, symlink sources, oversize streams and track overflow', async t => {
  const { root, library } = await fixture(t, { maxTracks: 1, maxAudioBytes: 16 });
  await assert.rejects(library.importBuffer('../escape.mp3', Buffer.from('ID3')), /naziv/);
  await assert.rejects(library.importBuffer('bad\n.mp3', Buffer.from('ID3orphan')), /naziv/);
  await assert.rejects(library.importBuffer('song.exe', Buffer.from('ID3')), /format/);
  await assert.rejects(library.importStream('huge.mp3', Readable.from([Buffer.alloc(12), Buffer.alloc(12)])), /prevelika/);
  assert.deepEqual(await readdir(join(root, 'data', 'audio')), []);
  const source = join(root, 'real.mp3');
  const link = join(root, 'link.mp3');
  await writeFile(source, Buffer.from('ID3real'));
  await symlink(source, link);
  await assert.rejects(library.importFile(link), /obična/);
  const track = await library.importFile(source);
  assert.equal((await library.importBuffer('same.mp3', Buffer.from('ID3real'))).id, track.id);
  await assert.rejects(library.importBuffer('other.mp3', Buffer.from('ID3other')), /najviše/);
  await assert.rejects(library.getAudioPath('../outside'), /ID/);
  await assert.rejects(library.updateTrack(track.id, { sha256: 'x' }), /samo naslov/);
  await assert.rejects(library.createSet('bad', ['../outside']), /ID/);
  await assert.rejects(library.saveTimeline(track.id, { data: 'x'.repeat(9 * 1024 * 1024) }), /prevelik/);
});

test('serialized concurrent imports retain both tracks', async t => {
  const { library } = await fixture(t);
  const tracks = await Promise.all([
    library.importBuffer('one.mp3', Buffer.from('ID3one')),
    library.importBuffer('two.mp3', Buffer.from('ID3two'))
  ]);
  assert.equal(new Set(tracks.map(track => track.id)).size, 2);
  assert.equal((await library.list()).length, 2);
});
