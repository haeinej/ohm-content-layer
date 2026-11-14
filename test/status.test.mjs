import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { cortexStatus } from '../src/status.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
async function fresh(t) {
  const base = await mkdtemp(join(tmpdir(), 'cortex-status-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  return { base, dir, cortex: openCortex(dir) };
}
async function has(cortex, kind, expected = true) {
  const items = (await cortexStatus(cortex)).filter(item => item.kind === kind);
  assert.equal(items.length > 0, expected, kind);
  for (const item of items) assert.ok(item.what && item.clear);
  return items;
}
async function snapshot(root) {
  const files = {};
  for (const path of await readdir(root, { recursive: true })) {
    const full = join(root, path);
    const info = await stat(full);
    if (info.isFile()) files[path] = [await readFile(full, 'utf8'), info.mtimeMs];
  }
  return files;
}

test('identity proposals clear when confirmed or rejected', async t => {
  const { cortex } = await fresh(t);
  for (const action of ['confirmIdentity', 'rejectIdentity']) {
    const value = action === 'confirmIdentity' ? 'Alex' : 'Robin';
    const proposal = await cortex.proposeIdentity({ field: 'preferredName', value, source: { kind: 'person', quote: `Call me ${value}.` } });
    await has(cortex, 'identity-proposal');
    await cortex[action](proposal.id);
    await has(cortex, 'identity-proposal', false);
  }
});

test('skill and tool proposals each say how to stop waiting', async t => {
  const { dir, cortex } = await fresh(t);
  await cortex.proposeSkill({ text: '---\nname: reading-notes\ndescription: File reading notes\n---\nRead it.' });
  await has(cortex, 'skill-proposal');
  await cortex.approveSkill('reading-notes');
  await has(cortex, 'skill-proposal', false);
  await cortex.proposeTool({ name: 'read-links', description: 'Read links', inputs: 'URL', outputs: 'Text' });
  await has(cortex, 'tool-proposal');
  await rm(join(dir, '.cortex/proposed/tools/read-links.md'));
  await has(cortex, 'tool-proposal', false);
});

test('observations clear when the next agent settles them', async t => {
  const { cortex } = await fresh(t);
  await cortex.addNote({ id: 'n1', note: 'A short title today', session: 's1' });
  await has(cortex, 'notes');
  await cortex.settle({ notes: [{ id: 'n1', outcome: 'dropped' }] });
  await has(cortex, 'notes', false);
});

test('broken pointers and undescribed or gone sections have working remedies', async t => {
  const { base, dir, cortex } = await fresh(t);
  const vault = join(base, 'vault');
  await mkdir(join(vault, 'notes'), { recursive: true });
  const post = join(vault, 'notes/map.md');
  await writeFile(post, '---\nid: map\n---\nA map.');
  await cortex.connectVault({ kind: 'folder', path: vault });
  await has(cortex, 'undescribed-section');
  await cortex.describeSection({ section: 'notes', meaning: 'Reading notes' });
  await has(cortex, 'undescribed-section', false);
  await cortex.write({ name: 'map-pointer', description: 'Where the map is', kind: 'reference', stated: true, posts: ['map'], body: 'See map.' });
  await rm(post);
  await has(cortex, 'broken-pointer');
  await has(cortex, 'gone-section');
  await writeFile(post, '---\nid: map\n---\nA map.');
  await has(cortex, 'broken-pointer', false);
  await rm(post);
  await writeFile(join(dir, 'vault.md'), '# How to read the vault\n');
  await has(cortex, 'gone-section', false);
});

test('unreadable memories, bad identity and an unreachable vault clear after repair', async t => {
  const { base, dir, cortex } = await fresh(t);
  await writeFile(join(dir, 'memory/broken.md'), 'not a memory');
  await has(cortex, 'problem');
  await rm(join(dir, 'memory/broken.md'));
  await has(cortex, 'problem', false);
  const identity = await readFile(join(dir, 'identity.md'), 'utf8');
  await writeFile(join(dir, 'identity.md'), '---\ntimezone: nowhere\n---\n');
  await has(cortex, 'problem');
  await writeFile(join(dir, 'identity.md'), identity);
  await has(cortex, 'problem', false);
  const vault = join(base, 'missing-vault');
  await writeFile(join(dir, '.cortex/vault.json'), JSON.stringify({ kind: 'folder', path: vault }));
  await has(openCortex(dir), 'problem');
  await mkdir(vault);
  await has(openCortex(dir), 'problem', false);
});

test('stale working memory clears when its agent distills', async t => {
  const { dir, cortex } = await fresh(t);
  const agent = openCortex(dir, { actor: 'codex' });
  const { version } = await agent.writeWorking('An open thread.');
  const old = new Date(Date.now() - 31 * 86400000);
  await utimes(join(dir, '.cortex/working/codex.md'), old, old);
  await has(cortex, 'stale-working');
  await agent.distill({ session: 's1', working: 'Still open.', version });
  await has(cortex, 'stale-working', false);
});

test('status is read-only even when the vault changed, and the CLI returns text or JSON', async t => {
  const { base, dir, cortex } = await fresh(t);
  const vault = join(base, 'vault');
  await mkdir(vault);
  await cortex.connectVault({ kind: 'folder', path: vault });
  assert.equal(execFileSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8' }).trim(), 'Nothing is waiting.');
  await mkdir(join(vault, 'notes'));
  await writeFile(join(vault, 'notes/new.md'), 'A note.');
  const before = await snapshot(base);
  const items = await cortexStatus(cortex);
  const json = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--json', dir], { encoding: 'utf8' }));
  assert.deepEqual(json, items);
  assert.match(execFileSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8' }), /undescribed-section: notes/);
  assert.deepEqual(await snapshot(base), before);
});
