// The hooks adapter: what `cortex hook <moment>` answers when Claude Code or Codex runs it at a fixed
// moment of a session. It reads the cortex folder directly and never waits on the network, so it
// answers fast whatever the model does. A hook must never break the session it runs in: whatever
// goes wrong, the command writes nothing and exits 0.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readMemoryFile } from './core.mjs';
import { agentName, openCortex } from './folder.mjs';
import { forAgent } from './identity.mjs';
import { openJournal } from './journal.mjs';
import { INSTRUCTIONS } from './tools.mjs';

export const MOMENTS = ['session-start', 'prompt', 'stop', 'session-end'];
// How much context one hook may hand the model, in characters.
// - Claude Code caps each additionalContext at 10,000 characters; beyond that it saves the text to a
//   file and shows the model a 2,000-character preview (code.claude.com/docs/en/hooks).
// - Codex limits each model-visible hook-output message to roughly 2,500 tokens by default; beyond
//   that it shows a head-and-tail preview (the Codex hooks docs, developers.openai.com/codex/hooks).
//   6,000 characters keeps well under 2,500 tokens for English and Markdown.
// Any other agent gets the smaller budget, since we do not know its limit.
export const BUDGETS = { 'claude-code': 9999, codex: 6000 };
export const budgetFor = agent => BUDGETS[same(agent)] ?? BUDGETS.codex;
export const ASK = 'Before you finish, call cortex_distill with what you noticed this session.';
const POINTER = 'The playbook (agents/AGENTS.md) is too long to include here. Call cortex_start now: it returns the playbook in full. Follow it.';

// Agents are matched the way their working memory files are named, so `Codex` and `codex` agree.
const same = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'agent';
const sessionOf = input => typeof input?.session_id === 'string' && input.session_id ? input.session_id.slice(0, 200) : null;
// Lengths and cuts count whole characters, so an emoji is never split in two.
export const chars = text => Array.from(text).length;

// A folder is a cortex when it holds the playbook. Anything else is broken, and the hook stays silent.
async function cortexAt(dir) {
  const found = await stat(join(dir, 'agents', 'AGENTS.md'));
  if (!found.isFile()) throw new Error(`${dir} is not a cortex`);
}

// Session lines are in the journal. A cortex made before the journal kept them in
// .cortex/sessions.jsonl, which is still read, first, and never written again. Both are read into
// the old shape: { agent, session, started | asked | distilled | ended, version }.
const SESSION_EVENTS = { start: 'started', ask: 'asked', distill: 'distilled', end: 'ended' };
async function sessions(dir) {
  const content = await readFile(join(dir, '.cortex', 'sessions.jsonl'), 'utf8').catch(problem => { if (problem.code === 'ENOENT') return ''; throw problem; });
  const lines = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry && typeof entry === 'object') lines.push(entry); } catch {}
  }
  for (const entry of await openJournal(dir).read()) {
    if (entry.type !== 'session' || !Object.hasOwn(SESSION_EVENTS, entry.event)) continue;
    const line = { agent: entry.actor?.name, session: entry.session ?? null, [SESSION_EVENTS[entry.event]]: entry.at };
    if (Object.hasOwn(entry, 'version')) line.version = entry.version;
    if (entry.event === 'end') line.distilled = entry.distilled === true;
    lines.push(line);
  }
  return lines;
}
// The journal makes .cortex/ if it is missing, say after a git clone, since git keeps no empty folders.
const record = (dir, agent, event, fields, session, now) => openJournal(dir, { now }).append(agent, 'session', { event, ...fields }, { session });
const tryRecord = (...args) => record(...args).then(() => true, () => false);

async function alwaysMemories(dir) {
  const found = [];
  for (const entry of await readdir(join(dir, 'memory'), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue;
    try {
      const memory = readMemoryFile(await readFile(join(dir, 'memory', entry.name), 'utf8'));
      if (memory.always) found.push(memory);
    } catch {}
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

// Fits text into max characters by dropping whole lines from its middle: the end, the newest part,
// is kept first, then as much of the start as fits.
export function squeeze(text, max) {
  if (chars(text) <= max) return text;
  const marker = '(… cut to fit; cortex_start has it in full …)';
  const room = max - chars(marker) - 2;
  if (room <= 0) return '';
  const lines = text.split('\n');
  const tail = [];
  let used = 0;
  for (let at = lines.length - 1; at >= 0; at--) {
    const size = chars(lines[at]) + 1;
    if (used + size > Math.floor(room * 0.75)) {
      // A last line too long to keep whole keeps its end, cut on a character.
      if (!tail.length) { tail.unshift(Array.from(lines[at]).slice(-Math.floor(room * 0.75)).join('')); used = chars(tail[0]) + 1; }
      break;
    }
    tail.unshift(lines[at]);
    used += size;
  }
  const head = [];
  for (const line of lines.slice(0, lines.length - tail.length)) {
    const size = chars(line) + 1;
    if (used + size > room) break;
    head.push(line);
    used += size;
  }
  return [...head, marker, ...tail].join('\n');
}

// Cuts at the last line that fits, never inside a character.
function headCut(text, max) {
  if (chars(text) <= max) return text;
  const marker = '(Cut to fit. Call cortex_start for the rest.)';
  const kept = [];
  let used = chars(marker);
  for (const line of text.split('\n')) {
    const size = chars(line) + 1;
    if (used + size > max) break;
    kept.push(line);
    used += size;
  }
  if (!kept.length) return Array.from(marker).slice(0, max).join('');
  return [...kept, marker].join('\n');
}

// The context put in front of the model at session start, cut to fit the agent's budget, in this
// order: the memory index, then other agents' working memory (oldest first), then the playbook
// becomes a pointer to cortex_start (and whatever was cut and now fits comes back), then the middle
// of this agent's own working memory, then of the memories marked always.
// Identity is shown as an agent sees it: confirmed fields only, birthdate hidden, and never a
// proposal or its evidence.
export async function sessionContext(dir, agent, budget = budgetFor(agent)) {
  const cortex = openCortex(dir, { actor: agent });
  const identity = forAgent(await cortex.identity());
  const always = await alwaysMemories(dir);
  const index = ((await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8').catch(() => '')) ?? '').split('\n').filter(line => line.startsWith('- ')).join('\n');
  const { mine, others } = await cortex.working();
  const playbook = (await cortex.rules()).trim();
  const alwaysText = always.length ? always.map(memory => `### ${memory.name}: ${memory.description}\n${memory.body.trim()}`).join('\n\n') : '(none)';

  const build = ({ full = true, withIndex = true, shown = others, own = mine.text.trim(), kept = alwaysText }) => [
    '# Your cortex',
    INSTRUCTIONS,
    'This was read from the cortex folder as the session started: the playbook, the identity, the memories marked always, the memory index and working memory. cortex_start gives the rest, such as the vault, skills and tools, and the versions you need to write.',
    '## The playbook (agents/AGENTS.md)',
    full ? playbook : POINTER,
    '## Identity',
    JSON.stringify(identity, null, 2),
    '## Memories marked always',
    kept,
    ...(withIndex ? ['## Memory index', index || '(no other memories)'] : []),
    `## Your working memory from last time (${mine.agent})`,
    own || '(empty)',
    ...(shown.length ? ["## Other agents' working memory", shown.map(other => `### ${other.agent}, updated ${other.updated}\n${other.text.trim()}`).join('\n\n')] : []),
  ].join('\n\n');
  const fits = text => chars(text) <= budget;

  for (const full of [true, false]) {
    for (const withIndex of [true, false]) {
      // others are newest first, so the oldest is dropped first.
      for (let count = others.length; count >= 0; count--) {
        const text = build({ full, withIndex, shown: others.slice(0, count) });
        if (fits(text)) return text;
        if (withIndex) break;
      }
    }
  }
  const bare = { full: false, withIndex: false, shown: [] };
  // The room left for one part, with everything else as it is.
  const spare = (part, parts) => budget - (chars(build({ ...bare, ...parts })) - chars(parts[part]));
  // Own working memory keeps its end, and drops from the middle of its older part.
  // It is squeezed first, down to a floor of 1,500 characters; past that the memories marked always
  // give way.
  const ownText = mine.text.trim();
  const floor = Math.min(chars(ownText), 1500);
  const own = squeeze(ownText, Math.max(spare('own', { own: ownText, kept: alwaysText }), floor)) || '(cut to fit; cortex_start has it)';
  let text = build({ ...bare, own });
  if (fits(text)) return text;
  const kept = squeeze(alwaysText, Math.max(spare('kept', { own, kept: alwaysText }), 0)) || '(cut to fit; cortex_start has them)';
  text = build({ ...bare, own, kept });
  return fits(text) ? text : headCut(text, budget);
}

// Whether this agent's working memory holds state the session has not saved: its version differs
// from the one at the session's last checkpoint (its start, or its last ask), and it is not the
// version a distill by this agent left since the session started. A session that never touches
// working memory has nothing unsaved. Versions, not file times, decide, so clocks never matter.
function unsaved(lines, who, session, mine) {
  const ours = lines.filter(entry => same(entry.agent) === who && (entry.session ?? null) === session);
  const start = ours.find(entry => typeof entry.started === 'string');
  const last = ours.filter(entry => typeof entry.started === 'string' || typeof entry.asked === 'string').at(-1);
  const current = mine.version ?? null;
  const distilled = Boolean(start) && lines.some(entry => same(entry.agent) === who && typeof entry.distilled === 'string' && Object.hasOwn(entry, 'version')
    && entry.distilled >= start.started && (entry.version ?? null) === current);
  return { start, changed: Boolean(last) && (last.version ?? null) !== current && !distilled, distilled };
}

// Answers one moment. Returns what to write to standard output, which may be nothing, and what to
// record once it has been written. A record that fails never takes the answer with it.
export async function hook(moment, { dir, agent: given, input = {}, now = () => new Date() }) {
  if (!MOMENTS.includes(moment)) throw new Error(`No moment ${moment}`);
  // Fitting memories to the prompt is later work; an empty answer must not slow a prompt.
  if (moment === 'prompt') return { output: '' };
  await cortexAt(dir);
  const agent = agentName(given);
  const who = same(agent);
  const session = sessionOf(input);
  const { mine } = await openCortex(dir, { actor: agent }).working();

  if (moment === 'session-start') {
    const context = await sessionContext(dir, agent);
    const output = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
    // A resume or a compaction fires again for the same session; its start is the first one.
    const after = async () => {
      const lines = await sessions(dir).catch(() => []);
      if (session && lines.some(entry => same(entry.agent) === who && entry.session === session && typeof entry.started === 'string')) return;
      await tryRecord(dir, agent, 'start', { version: mine.version ?? null }, session, now);
    };
    return { output, after };
  }

  const lines = await sessions(dir);
  const state = unsaved(lines, who, session, mine);

  if (moment === 'stop') {
    // stop_hook_active: the client is already continuing because a stop hook asked.
    if (input.stop_hook_active === true) return { output: '' };
    // A session with no start line, say one begun before the hooks were installed, starts now.
    if (!state.start) {
      await tryRecord(dir, agent, 'start', { version: mine.version ?? null }, session, now);
      return { output: '' };
    }
    if (!state.changed) return { output: '' };
    // The same state is never asked about twice: the ask is a checkpoint with this version.
    if (!(await tryRecord(dir, agent, 'ask', { version: mine.version ?? null }, session, now))) return { output: '' };
    return { output: JSON.stringify({ decision: 'block', reason: ASK }) };
  }

  // session-end: only what happened.
  await record(dir, agent, 'end', { distilled: state.distilled }, session, now);
  return { output: '' };
}

// Reads the hook's JSON from standard input, without waiting forever for a client that never
// closes it.
export function readInput(stream, { wait = 1000 } = {}) {
  return new Promise(resolve => {
    const chunks = [];
    const done = () => { clearTimeout(timer); stream.removeAllListeners('data'); stream.pause(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const timer = setTimeout(done, wait);
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', done);
    stream.on('error', done);
  });
}

// The whole command: never throws, never fails the session.
export async function runHook(moment, { dir, agent, stdin, stdout }) {
  try {
    // A client that closes the pipe early never sees a stack trace.
    stdout.on('error', () => {});
    // prompt answers nothing, so it does not wait to read what it would not use.
    if (moment === 'prompt') return;
    const raw = await readInput(stdin);
    const input = raw.trim() ? JSON.parse(raw) : {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const { output, after } = await hook(moment, { dir, agent, input });
    if (output) await new Promise(resolve => stdout.write(`${output}\n`, () => resolve()));
    if (after) await after().catch(() => {});
  } catch {
    // Nothing is written. The session goes on as if there were no hook.
  }
}

export const SNIPPETS = {
  'claude-code': { file: 'claude-code.json', where: 'Add to the "hooks" of .claude/settings.json (a project) or ~/.claude/settings.json (every session).' },
  codex: { file: 'codex.toml', where: 'Add to ~/.codex/config.toml, or to .codex/config.toml in a trusted project, then review the hooks with /hooks.' },
};
