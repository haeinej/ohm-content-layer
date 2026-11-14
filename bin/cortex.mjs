#!/usr/bin/env node
// cortex init [dir]            start a cortex in an empty folder
// cortex mcp [dir]             serve the cortex's tools to an agent, over standard input and output
// cortex approve <skill> [dir] approve a skill an agent proposed
// cortex event <text> [dir]    report a change from outside, for the agent to settle
// The folder is the one named, or CORTEX_DIR, or ~/cortex.
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refused } from '../src/core.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createServer, serve } from '../src/protocol.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const folder = given => resolve(given ?? process.env.CORTEX_DIR ?? join(homedir(), 'cortex'));

try {
  if (command === 'init') {
    const { dir } = await initCortex(folder(rest[0]), template);
    console.log(`A cortex was started in ${dir}`);
  } else if (command === 'mcp') {
    const dir = folder(rest[0]);
    // The agent is named by what connects, so each save says which agent made it.
    let agent = process.env.CORTEX_AGENT ?? 'agent';
    // Made at the first call, once the agent has said its name, and kept: a confirmation lives in it.
    await serve(createServer({ tools: () => createTools(openCortex(dir, { actor: agent })), list: TOOLS, instructions: INSTRUCTIONS, onClient: name => { agent = process.env.CORTEX_AGENT ?? name; } }), process.stdin, process.stdout);
  } else if (command === 'approve' && rest[0]) {
    const done = await openCortex(folder(rest[1])).approveSkill(rest[0]);
    console.log(`${done.name} is approved, and is now in skills/`);
  } else if (command === 'event' && rest[0]) {
    const { id } = await openCortex(folder(rest[1]), { actor: process.env.CORTEX_SOURCE ?? 'host' }).addNote({ id: randomUUID(), note: rest[0], session: 'event' });
    console.log(`Recorded ${id}`);
  } else {
    console.log('cortex init [dir] | mcp [dir] | approve <skill> [dir] | event <text> [dir]');
    process.exitCode = command ? 1 : 0;
  }
} catch (problem) {
  if (!(problem instanceof Refused)) throw problem;
  console.error(problem.message);
  process.exitCode = 1;
}
