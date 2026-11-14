#!/usr/bin/env node
// cortex init [dir] [--account <did-or-handle>]   start a cortex in an empty folder
// cortex mcp [dir]             serve the cortex's tools to an agent, over standard input and output
// cortex approve <skill> [dir] approve a skill an agent proposed
// cortex event <text> [dir]    report a change from outside, for the agent to settle
// cortex confirm <field|id> [dir]   accept an identity fact an agent proposed
// cortex reject <field|id> [dir]    turn one down; that value is not proposed again
// cortex clear <field> [dir]        remove an identity field
// The folder is the one named, or CORTEX_DIR, or ~/cortex.
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refused } from '../src/core.mjs';
import { agentName, initCortex, openCortex } from '../src/folder.mjs';
import { createServer, serve } from '../src/protocol.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const folder = given => resolve(given ?? process.env.CORTEX_DIR ?? join(homedir(), 'cortex'));

try {
  if (command === 'init') {
    const at = rest.indexOf('--account');
    const account = at >= 0 ? rest.splice(at, 2)[1] : undefined;
    if (at >= 0 && !account) throw new Refused('InvalidRequest', 'Give --account a DID or a handle');
    const { dir } = await initCortex(folder(rest[0]), template, { account });
    console.log(`A cortex was started in ${dir}`);
  } else if (command === 'mcp') {
    const dir = folder(rest[0]);
    // The agent is named by what connects, so each save says which agent made it.
    // An agent is named by what connects, and can never take the person's or the account's name.
    let agent = agentName(process.env.CORTEX_AGENT);
    // Made at the first call, once the agent has said its name, and kept: a confirmation lives in it.
    await serve(createServer({ tools: () => createTools(openCortex(dir, { actor: agent })), list: TOOLS, instructions: INSTRUCTIONS, onClient: name => { agent = agentName(process.env.CORTEX_AGENT ?? name); } }), process.stdin, process.stdout);
  } else if (command === 'approve' && rest[0]) {
    const done = await openCortex(folder(rest[1])).approveSkill(rest[0]);
    console.log(`${done.name} is approved, and is now in skills/`);
  } else if (['confirm', 'reject'].includes(command) && rest[0]) {
    const cortex = openCortex(folder(rest[1]), { actor: 'member' });
    const done = command === 'confirm' ? await cortex.confirmIdentity(rest[0]) : await cortex.rejectIdentity(rest[0]);
    console.log(command === 'confirm' ? `${done.field} is now ${JSON.stringify(done.value)}` : `${done.field}: proposal ${done.id} turned down`);
  } else if (command === 'clear' && rest[0]) {
    await openCortex(folder(rest[1]), { actor: 'member' }).clearIdentity(rest[0]);
    console.log(`${rest[0]} is cleared`);
  } else if (command === 'identity') {
    const cortex = openCortex(folder(rest[0]));
    const { fields, problems } = await cortex.identity();
    console.log(JSON.stringify({ fields, waiting: await cortex.identityProposals(), ...(problems.length ? { problems } : {}) }, null, 2));
  } else if (command === 'event' && rest[0]) {
    const { id } = await openCortex(folder(rest[1]), { actor: process.env.CORTEX_SOURCE ?? 'host' }).addNote({ id: randomUUID(), note: rest[0], session: 'event' });
    console.log(`Recorded ${id}`);
  } else {
    console.log('cortex init [dir] [--account <did>] | mcp [dir] | identity [dir] | confirm <field|id> [dir] | reject <field|id> [dir] | clear <field> [dir] | approve <skill> [dir] | event <text> [dir]');
    process.exitCode = command ? 1 : 0;
  }
} catch (problem) {
  if (!(problem instanceof Refused)) throw problem;
  console.error(problem.message);
  process.exitCode = 1;
}
