import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { blobCid } from '../vault/core.mjs';
import { INDEX, inspect, openIndex, scan, search, summary, words } from '../vault/indexer.mjs';
import { CONFIG, globTest, readConfig } from '../vault/roots.mjs';

const HOME = '/Users/example';
const VAULT = '/Users/example/Vault';

test('a root is a different folder, read only, with its channel, patterns and how much it keeps', () => {
  const { roots, problems } = readConfig({ roots: [
    { name: 'queries', path: '~/work/queries', include: ['*.sql'] },
    { name: 'drive', path: '~/Library/CloudStorage/GoogleDrive-a@example.com/My Drive/Research', channel: 'reading/research' },
  ] }, { vault: VAULT, home: HOME });
  assert.deepEqual(problems, []);
  assert.deepEqual(roots.map(root => [root.name, root.path, root.channel, root.retain, root.drive]), [
    ['queries', '/Users/example/work/queries', 'queries', 'text', false],
    ['drive', '/Users/example/Library/CloudStorage/GoogleDrive-a@example.com/My Drive/Research', 'reading/research', 'reference', true],
  ]);
  assert.equal(roots[0].takes('deep/in/churn.sql'), true);
  assert.equal(roots[0].takes('notes.md'), false);

  const refused = readConfig({ extra: 1, roots: [
    { name: 'vault', path: '/elsewhere' },
    { name: 'inside', path: '~/Vault/sub' },
    { name: 'around', path: '~' },
    { name: 'sync', path: '/a', mode: 'two-way' },
    { name: 'Bad Name', path: '/b' },
    { name: 'relative', path: 'notes' },
    { name: 'odd', path: '/c', retain: 'everything', channel: '_hidden', include: 'x', colour: 'red' },
    { name: 'fine', path: '/d' },
    { name: 'fine', path: '/e' },
  ] }, { vault: VAULT, home: HOME });
  assert.deepEqual(refused.roots.map(root => root.name), ['fine']);
  const said = refused.problems.join('\n');
  for (const words of ['not know: extra', 'cannot be called "vault"', 'the vault itself, inside it, or around it', 'two-way sync, which is not built yet',
    'lowercase letters', 'absolute folder', 'retain is one of', 'not a channel\'s path', '"include" that is not a list', 'not know: colour', 'same name as another root']) {
    assert.ok(said.includes(words), words);
  }
  assert.deepEqual(readConfig(undefined, { vault: VAULT, home: HOME }), { roots: [], problems: [] });
});

test('globs: ** crosses folders, * does not, and a pattern without / matches the name anywhere', () => {
  assert.equal(globTest('**/*.pdf')('a/b/c.pdf'), true);
  assert.equal(globTest('**/*.pdf')('c.pdf'), true);
  assert.equal(globTest('docs/*.md')('docs/a.md'), true);
  assert.equal(globTest('docs/*.md')('docs/x/a.md'), false);
  assert.equal(globTest('*.md')('x/y/a.md'), true);
  assert.equal(globTest('drafts/**')('drafts/a/b.md'), true);
  assert.equal(globTest('a?.md')('ab.md'), true);
});

test('words split on anything but letters and digits, and take Korean, Japanese and Chinese two characters at a time', () => {
  assert.deepEqual(words('Churn query: account_id!'), ['churn', 'query', 'account_id']);
  assert.deepEqual(words('서울의 비'), ['서울', '울의', '비']);
  assert.deepEqual(words('rain서울'), ['rain', '서울']);
});

async function setup(t) {
  const base = await mkdtemp(join(tmpdir(), 'vault-index-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const put = async (path, text) => { await mkdir(dirname(join(base, path)), { recursive: true }); await writeFile(join(base, path), text); };
  const vault = join(base, 'Vault');
  await put('Vault/writing/_channel.md', '---\ntitle: Writing\n---\n\nEssays.\n');
  await put('Vault/writing/rain.md', '---\ntitle: Rain in 서울\n---\n\nThe [[churn-query]] taught me nothing about rain.\n');
  await put('Vault/analytics/churn-query.md', '---\nkind: code\ntitle: Churn query\n---\n\nJoins on account_id.\n\n![[churn.sql]]\n');
  await put('Vault/analytics/churn.sql', 'select 1;\n');
  await put('Vault/.obsidian/app.json', '{}');
  await put('queries/retention.sql', 'select account_id from events where churned;\n');
  await put('queries/old/notes.md', '# Old notes\n\nAbout retention.\n');
  await put('queries/data.bin', 'binary');
  await put('drive/paper.pdf', '%PDF-1.4 secret words');
  await put('full/photo.png', 'not really a png');
  const config = roots => writeFile(join(vault, CONFIG), JSON.stringify({ roots }));
  await mkdir(join(vault, '.vault'), { recursive: true });
  await config([
    { name: 'queries', path: join(base, 'queries'), include: ['*.sql', '*.md'] },
    { name: 'drive', path: join(base, 'drive'), retain: 'reference' },
    { name: 'kept', path: join(base, 'full'), retain: 'full', channel: 'photos' },
  ]);
  const db = await openIndex(vault, { DatabaseSync });
  t.after(() => { if (db.isOpen !== false) try { db.close(); } catch {} });
  return { base, vault, db, put, config };
}

test('indexing reads the folder and its roots once, and after that only what changed', async t => {
  const { base, vault, db, put } = await setup(t);
  const first = await scan({ vault, db });
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.roots.map(root => [root.name, root.files, root.available]), [['vault', 4, true], ['queries', 2, true], ['drive', 1, true], ['kept', 1, true]]);
  // Everything is opened except the reference-only root, whose file is never read.
  assert.equal(first.opened, 7);
  assert.equal(first.cached, 1);
  const status = summary(db);
  assert.equal(status.files, 8);
  assert.ok(status.nodes >= 9);

  // A file kept in full is copied into the cache under its content address.
  const photo = await readFile(join(base, 'full/photo.png'));
  assert.deepEqual(await readdir(join(vault, '.vault/cache')), [await blobCid(photo)]);
  // A reference-only file has no address, because its bytes were never read.
  const paper = inspect(db, 'paper-pdf');
  assert.equal(paper.file.hash, null);
  assert.equal(paper.node.kind, 'file');
  assert.equal(paper.origin.where, join(base, 'drive/paper.pdf'));
  assert.equal(paper.node.home, 'drive');
  assert.deepEqual(search(db, 'secret'), []);

  // Unchanged files are not opened again.
  const second = await scan({ vault, db });
  assert.deepEqual([second.opened, second.unchanged, second.added.length, second.changed.length], [0, 8, 0, 0]);

  // An edited file is read again; a moved one is recognised; a removed one goes.
  await put('Vault/writing/rain.md', '---\ntitle: Rain in 서울\n---\n\nNow about snow.\n');
  await rename(join(base, 'queries/retention.sql'), join(base, 'queries/kept-retention.sql'));
  await rm(join(base, 'queries/old/notes.md'));
  const third = await scan({ vault, db });
  assert.deepEqual(third.changed, [{ root: 'vault', path: 'writing/rain.md' }]);
  assert.deepEqual(third.moved, [{ root: 'queries', from: 'retention.sql', to: 'kept-retention.sql' }]);
  assert.deepEqual(third.removed, [{ root: 'queries', path: 'old/notes.md' }]);
  assert.equal(third.opened, 2);
  assert.equal(inspect(db, 'notes'), null);
  assert.equal(inspect(db, 'kept-retention-sql').node.kind, 'code');
});

test('the index holds every node, its file, its edges and its words', async t => {
  const { vault, db } = await setup(t);
  await scan({ vault, db });
  const churn = inspect(db, 'churn-query');
  assert.equal(churn.key, 'block:analytics/churn-query.md');
  assert.equal(churn.file.path, 'analytics/churn-query.md');
  assert.match(churn.file.hash, /^bafkrei/);
  assert.deepEqual(churn.out, [{ kind: 'embeds', node: 'file:churn.sql', at: '3' }]);
  assert.deepEqual(churn.in.map(edge => `${edge.kind} ${edge.node}`).sort(), ['contains channel:analytics', 'links block:writing/rain.md']);
  assert.equal(inspect(db, 'writing/rain.md').key, 'block:writing/rain.md');
  assert.equal(inspect(db, 'channel:writing').node.title, 'Writing');
  // A root's Markdown is a block in the root's channel, saying where it is.
  const notes = inspect(db, 'notes');
  assert.equal(notes.node.home, 'queries/old');
  assert.equal(notes.root, 'queries');
  assert.equal(notes.origin.kind, 'local');
  // Words in a title count twice; a root's file of code is searchable by what it says.
  assert.deepEqual(search(db, '서울').map(hit => hit.slug), ['rain']);
  assert.deepEqual(search(db, 'account_id').map(hit => hit.slug).sort(), ['churn-query', 'retention-sql']);
  assert.deepEqual(search(db, 'churn query').map(hit => hit.slug)[0], 'churn-query');
  assert.deepEqual(search(db, '   '), []);
  // Files outside the patterns, and the editor's own folder, are not taken in.
  assert.equal(inspect(db, 'data-bin'), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM files WHERE path LIKE '.obsidian/%'").get().n, 0);
});

test('a root that cannot be reached keeps what the index knew, and a removed root is forgotten', async t => {
  const { base, vault, db, config } = await setup(t);
  await scan({ vault, db });
  await rename(join(base, 'drive'), join(base, 'drive-offline'));
  const offline = await scan({ vault, db });
  assert.equal(offline.roots.find(root => root.name === 'drive').available, false);
  assert.deepEqual(offline.removed, []);
  assert.match(offline.problems.find(each => each.root === 'drive').problems[0], /cannot be read .* is kept/);
  assert.ok(inspect(db, 'paper-pdf'));
  await config([{ name: 'queries', path: join(base, 'queries'), include: ['*.sql'] }, { name: 'sync', path: join(base, 'x'), mode: 'two-way' }]);
  const fewer = await scan({ vault, db });
  assert.equal(inspect(db, 'paper-pdf'), null);
  assert.equal(inspect(db, 'notes'), null);
  assert.match(fewer.problems.find(each => each.path === CONFIG).problems.join(), /two-way sync, which is not built yet/);
});

test('a reference-only root never opens a file, even one it could not read', async t => {
  const { base, vault, db } = await setup(t);
  await chmod(join(base, 'drive/paper.pdf'), 0o000);
  try {
    const report = await scan({ vault, db });
    assert.equal(report.roots.find(root => root.name === 'drive').files, 1);
    assert.ok(inspect(db, 'paper-pdf'));
  } finally {
    await chmod(join(base, 'drive/paper.pdf'), 0o644);
  }
});

test('an index of another version, or one that cannot be read, is made again from the files', async t => {
  const { vault, db } = await setup(t);
  await scan({ vault, db });
  db.prepare("UPDATE meta SET value = '0' WHERE key = 'version'").run();
  db.close();
  const again = await openIndex(vault, { DatabaseSync });
  assert.equal(summary(again).files, 0);
  await scan({ vault, db: again });
  assert.equal(summary(again).files, 8);
  again.close();
  await writeFile(join(vault, INDEX), 'not a database');
  for (const extra of ['-wal', '-shm']) await rm(join(vault, `${INDEX}${extra}`), { force: true });
  const mended = await openIndex(vault, { DatabaseSync });
  t.after(() => mended.close());
  assert.equal(summary(mended).files, 0);
  assert.ok((await readdir(join(vault, '.vault'))).some(name => name.startsWith('index.sqlite.damaged-')));
});

test('the vault command makes a configuration, indexes and answers, without touching the service', async t => {
  const { vault } = await setup(t);
  const ohm = (...args) => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/ohm.mjs', import.meta.url)), 'vault', ...args, '--vault', vault], { env: { ...process.env, OHM_VAULT_FOLDER: '' } });
  const init = JSON.parse((await ohm('init')).stdout);
  assert.match(init.note, /already has a configuration/);
  const indexed = JSON.parse((await ohm('index')).stdout);
  assert.equal(indexed.roots.length, 4);
  assert.equal(JSON.parse((await ohm('search', 'rain')).stdout)[0].slug, 'rain');
  assert.equal(JSON.parse((await ohm('inspect', 'churn-query')).stdout).node.title, 'Churn query');
  assert.equal(JSON.parse((await ohm('status')).stdout).files, 8);
  await assert.rejects(ohm('inspect', 'nothing-here'), /Nothing in the index is "nothing-here"/);
  await assert.rejects(ohm('dance'), /Say what to do: init, index, status, inspect, search/);
});
