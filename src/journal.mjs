// The journal: one append-only file, .cortex/journal.jsonl, that says what happened in a cortex and
// who did it. This module is the only thing that writes it.
//
// Every line has `seq` (this cortex's count of lines, one more than the highest it has seen), `id`
// (unique, so lines from two machines joined by a union merge never clash), `at`, `actor`
// ({ kind: human or agent, name }), `session` when there is one, and `type`:
//
//   session   a session started, was asked to distill, distilled, or ended   (was .cortex/sessions.jsonl)
//   change    a file of the cortex was created, updated, removed or restored, with its versions before and after
//   note      one observation, waiting to be settled                         (was .cortex/notes.jsonl)
//   decision  what became of a note when it was settled                      (was the `settled` lines)
//   save      a name and a note for this point in history, to read the cortex as it was here.
//             It changes nothing. Lines written as `stamp` before the name changed are read as saves.
//
// `proposal` is named in docs/journal-and-history.md and reserved: nothing writes it yet.
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TYPES = ['session', 'change', 'note', 'decision', 'save'];
export const RESERVED_TYPES = ['proposal'];
export const OPS = ['create', 'update', 'remove', 'restore'];
// Names that mean the person, or the signed-in account. Everyone else is an agent.
export const PEOPLE = ['member', 'account'];
export const actorOf = name => ({ kind: PEOPLE.includes(name) ? 'human' : 'agent', name });

export const journalPath = dir => join(dir, '.cortex', 'journal.jsonl');

// Lines from two machines joined by a union merge can share a seq. They are ordered by seq, then by
// when they were written, then by ID, so every reader puts them in the same order.
export const order = (a, b) => a.seq - b.seq || String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id));

export function openJournal(dir, { now = () => new Date() } = {}) {
  const path = journalPath(dir);
  const raw = () => readFile(path, 'utf8').catch(problem => { if (problem?.code === 'ENOENT') return ''; throw problem; });

  // Every line that can be read, in order. A line that cannot be read, say one cut short, is skipped.
  async function read() {
    const lines = [];
    for (const line of (await raw()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.seq) || typeof entry.type !== 'string') continue;
        lines.push(entry.type === 'stamp' ? { ...entry, type: 'save' } : entry);
      } catch {}
    }
    return lines.sort(order);
  }

  // Adds one line and returns it. `actor` is the name the cortex was opened with.
  async function append(actor, type, fields = {}, { session } = {}) {
    if (!TYPES.includes(type)) throw new Error(`The journal does not take ${type} lines`);
    let last = 0;
    for (const found of (await raw()).matchAll(/"seq":(\d+)/g)) last = Math.max(last, Number(found[1]));
    const entry = {
      seq: last + 1,
      id: `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`,
      at: now().toISOString(),
      actor: actorOf(actor),
      ...(typeof session === 'string' && session ? { session } : {}),
      type,
      ...fields,
    };
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  return { path, read, append };
}
