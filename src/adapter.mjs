// The hooks adapter: what `cortex hook <moment>` answers when Claude Code or Codex runs it at a fixed
// moment of a session. It reads the cortex folder directly and never waits on the network, so it
// answers fast whatever the model does. A hook must never break the session it runs in: whatever
// goes wrong, the command writes nothing and exits 0.
import { appendFile, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readMemoryFile } from './core.mjs';
import { agentName, openCortex } from './folder.mjs';
import { forAgent } from './identity.mjs';
import { INSTRUCTIONS } from './tools.mjs';

export const MOMENTS = ['session-start', 'prompt', 'stop', 'session-end'];
// Both clients take at most 10,000 characters of context from one hook; keep under it.
export const LIMIT = 9999;
export const ASK = 'Before you finish, call cortex_distill with what you noticed this session.';

// Agents are matched the way their working memory files are named, so `Codex` and `codex` agree.
const same = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'agent';
const sessionOf = input => typeof input?.session_id === 'string' && input.session_id ? input.session_id.slice(0, 200) : null;

// A folder is a cortex when it holds the playbook. Anything else is broken, and the hook stays silent.
async function cortexAt(dir) {
  const found = await stat(join(dir, 'agents', 'AGENTS.md'));
  if (!found.isFile()) throw new Error(`${dir} is not a cortex`);
}

async function sessions(dir) {
  const content = await readFile(join(dir, '.cortex', 'sessions.jsonl'), 'utf8').catch(problem => { if (problem.code === 'ENOENT') return ''; throw problem; });
  const lines = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry && typeof entry === 'object') lines.push(entry); } catch {}
  }
  return lines;
}
const record = (dir, entry) => appendFile(join(dir, '.cortex', 'sessions.jsonl'), `${JSON.stringify(entry)}\n`);

// Where this agent's session began: the line for the client's session if there is one, otherwise
// the latest start this agent recorded.
function startOf(lines, agent, session) {
  const mine = lines.filter(entry => same(entry.agent) === agent && typeof entry.started === 'string');
  return (session && mine.find(entry => entry.session === session)) || mine.at(-1) || null;
}
const distilledSince = (lines, agent, started) => lines.some(entry => same(entry.agent) === agent && typeof entry.distilled === 'string' && entry.distilled >= started);

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

// The context put in front of the model at session start, cut to fit: the memory index goes
// first, then other agents' working memory, oldest first.
export async function sessionContext(dir, agent) {
  const cortex = openCortex(dir, { actor: agent });
  const identity = forAgent(await cortex.identity());
  const always = await alwaysMemories(dir);
  const index = ((await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8').catch(() => '')) ?? '').split('\n').filter(line => line.startsWith('- ')).join('\n');
  const { mine, others } = await cortex.working();
  const playbook = (await cortex.rules()).trim();

  const parts = (withIndex, shown) => [
    '# Your cortex',
    INSTRUCTIONS,
    'This was read from the cortex folder as the session started: the playbook, the identity, the memories marked always, the memory index and working memory. cortex_start gives the rest, such as the vault, skills and tools, and the versions you need to write.',
    '## The playbook (agents/AGENTS.md)',
    playbook,
    '## Identity',
    JSON.stringify(identity, null, 2),
    '## Memories marked always',
    always.length ? always.map(memory => `### ${memory.name}: ${memory.description}\n${memory.body.trim()}`).join('\n\n') : '(none)',
    ...(withIndex ? ['## Memory index', index || '(no other memories)'] : []),
    `## Your working memory from last time (${mine.agent})`,
    mine.text.trim() || '(empty)',
    ...(shown.length ? ["## Other agents' working memory", shown.map(other => `### ${other.agent}, updated ${other.updated}\n${other.text.trim()}`).join('\n\n')] : []),
  ].join('\n\n');

  let text = parts(true, others);
  if (text.length > LIMIT) text = parts(false, others);
  // others are newest first, so the oldest is dropped first.
  for (let kept = others.length - 1; text.length > LIMIT && kept >= 0; kept--) text = parts(false, others.slice(0, kept));
  if (text.length > LIMIT) {
    const cut = '\n\n(Cut to fit. Call cortex_start for the rest.)';
    text = text.slice(0, LIMIT - cut.length) + cut;
  }
  return text;
}

// Answers one moment. Returns what to write to standard output, which may be nothing.
export async function hook(moment, { dir, agent: given, input = {}, now = () => new Date() }) {
  if (!MOMENTS.includes(moment)) throw new Error(`No moment ${moment}`);
  // Fitting memories to the prompt is later work; an empty answer must not slow a prompt.
  if (moment === 'prompt') return '';
  await cortexAt(dir);
  const agent = agentName(given);
  const who = same(agent);
  const session = sessionOf(input);

  if (moment === 'session-start') {
    const context = await sessionContext(dir, agent);
    // A resume or a compaction fires again for the same session; its start is the first one.
    const lines = await sessions(dir);
    if (!(session && lines.some(entry => same(entry.agent) === who && entry.session === session && typeof entry.started === 'string'))) {
      await record(dir, { agent, session, started: now().toISOString() });
    }
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
  }

  const lines = await sessions(dir);
  const start = startOf(lines, who, session);
  const distilled = Boolean(start && distilledSince(lines, who, start.started));

  if (moment === 'stop') {
    // stop_hook_active: the client is already continuing because a stop hook asked. Never ask twice:
    // Stop runs at the end of every turn, so once asked in a session, it is not asked again.
    if (input.stop_hook_active === true || !start || distilled) return '';
    const key = start.session ?? null;
    if (lines.some(entry => same(entry.agent) === who && typeof entry.asked === 'string' && (entry.session ?? null) === key)) return '';
    await record(dir, { agent, session: key, asked: now().toISOString() });
    return JSON.stringify({ decision: 'block', reason: ASK });
  }

  // session-end: only what happened.
  await record(dir, { agent, session, ended: now().toISOString(), distilled });
  return '';
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
    const raw = await readInput(stdin);
    const input = raw.trim() ? JSON.parse(raw) : {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const answer = await hook(moment, { dir, agent, input });
    if (answer) await new Promise(resolve => stdout.write(`${answer}\n`, resolve));
  } catch {
    // Nothing is written. The session goes on as if there were no hook.
  }
}

export const SNIPPETS = {
  'claude-code': { file: 'claude-code.json', where: 'Add to the "hooks" of .claude/settings.json (a project) or ~/.claude/settings.json (every session).' },
  codex: { file: 'codex.toml', where: 'Add to ~/.codex/config.toml, or to .codex/config.toml in a trusted project, then review the hooks with /hooks.' },
};
