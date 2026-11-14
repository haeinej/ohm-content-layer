#!/usr/bin/env node
// cortex init [dir] [--account <did-or-handle>]   start a cortex in an empty folder
// cortex mcp [dir]             serve the cortex's tools to an agent, over standard input and output
// cortex serve [dir] [--port 8765] [--host 127.0.0.1]   serve them over HTTP, at /mcp
// cortex token [dir] [--replace]   make the token an HTTP client signs in with, and print it once
// cortex approve <skill> [dir] approve a skill an agent proposed
// cortex event <text> [dir]    report a change from outside, for the agent to settle
// cortex vault connect <folder> [dir]   read the vault kept in that folder
// cortex vault [sync] [dir]         bring the cortex in step with the vault, and show how it reads it
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
import { cortexSessions, ENDPOINT, httpTransport, listen, makeToken, readToken } from '../src/http.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';
import { getPrompt, PROMPTS } from '../src/prompts.mjs';
import { createResources } from '../src/resources.mjs';
import { cortexStatus } from '../src/status.mjs';

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
    // Resources only read, so they are served the same to every agent.
    const resources = createResources(openCortex(dir, { actor: agent }));
    // The instructions only send an agent to cortex_start, which returns the playbook from the folder.
    await serve(createServer({ tools: () => createTools(openCortex(dir, { actor: agent })), list: TOOLS, resources, prompts: { list: PROMPTS, get: getPrompt }, instructions: INSTRUCTIONS, onClient: name => { agent = agentName(process.env.CORTEX_AGENT ?? name); } }), process.stdin, process.stdout);
  } else if (command === 'serve') {
    const option = (flag, fallback) => {
      const at = rest.indexOf(flag);
      if (at < 0) return fallback;
      const [, value] = rest.splice(at, 2);
      if (!value) throw new Refused('InvalidRequest', `Give ${flag} a value`);
      return value;
    };
    const host = option('--host', '127.0.0.1');
    const port = Number(option('--port', '8765'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Refused('InvalidRequest', 'Give --port a number from 0 to 65535');
    const dir = folder(rest[0]);
    const token = await readToken(dir);
    // Without a token anything that can reach the port could read the cortex, so it serves only this machine.
    if (!token && host !== '127.0.0.1') throw new Refused('InvalidRequest', `There is no token, so cortex serves only 127.0.0.1, this machine. To serve on ${host}, where other machines can reach it, run cortex token first: every client must then sign in with it.`);
    const server = await listen(httpTransport({ open: cortexSessions(dir, { agent: process.env.CORTEX_AGENT }), token }), { port, host }).catch(problem => {
      if (problem.code === 'EADDRINUSE') throw new Refused('InvalidRequest', `Port ${port} on ${host} is in use. Pick another with --port.`);
      throw problem;
    });
    const where = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}${ENDPOINT}`;
    console.log(`Serving the cortex in ${dir} at ${where}`);
    console.log(token ? 'Clients sign in with the token in agents/secrets/mcp-token.' : 'There is no token: anything on this machine can connect. Run cortex token to require one.');
  } else if (command === 'token') {
    const replace = rest.includes('--replace');
    const dir = folder(rest.filter(arg => arg !== '--replace')[0]);
    const token = await makeToken(dir, { replace });
    // The one time the token is shown. It is kept in agents/secrets/mcp-token, which git never takes.
    console.log(token);
    console.error(`Saved in ${join(dir, 'agents', 'secrets', 'mcp-token')}. Give it to an HTTP client as Authorization: Bearer <token>.${replace ? ' The old token no longer works once cortex serve is restarted.' : ''}`);
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
  } else if (command === 'vault') {
    if (rest[0] === 'connect' && rest[1]) {
      const done = await openCortex(folder(rest[2]), { actor: 'member' }).connectVault({ kind: 'folder', path: resolve(rest[1]) });
      console.log(`Connected the vault in ${resolve(rest[1])}: ${done.sections.length} sections`);
    } else {
      const dir = folder(rest[0] === 'sync' ? rest[1] : rest[0]);
      const done = await openCortex(dir, { actor: 'member' }).syncVault();
      console.log(JSON.stringify(done, null, 2));
      if (!done.connected) process.exitCode = 1;
    }
  } else if (command === 'identity') {
    const cortex = openCortex(folder(rest[0]));
    const { fields, problems } = await cortex.identity();
    console.log(JSON.stringify({ fields, waiting: await cortex.identityProposals(), ...(problems.length ? { problems } : {}) }, null, 2));
  } else if (command === 'event' && rest[0]) {
    const { id } = await openCortex(folder(rest[1]), { actor: process.env.CORTEX_SOURCE ?? 'host' }).addNote({ id: randomUUID(), note: rest[0], session: 'event' });
    console.log(`Recorded ${id}`);
  } else if (command === 'status') {
    const json = rest.includes('--json');
    const items = await cortexStatus(openCortex(folder(rest.filter(arg => arg !== '--json')[0])));
    if (json) console.log(JSON.stringify(items, null, 2));
    else if (!items.length) console.log('Nothing is waiting.');
    else for (const kind of [...new Set(items.map(item => item.kind))]) {
      for (const item of items.filter(item => item.kind === kind)) console.log(`${kind}: ${item.what} — ${item.clear}`);
    }
  } else {
    console.log('cortex init [dir] [--account <did>] | mcp [dir] | serve [dir] [--port 8765] [--host 127.0.0.1] | token [dir] [--replace] | vault connect <folder> [dir] | vault [dir] | identity [dir] | confirm <field|id> [dir] | reject <field|id> [dir] | clear <field> [dir] | approve <skill> [dir] | event <text> [dir] | status [dir] [--json]');
    process.exitCode = command ? 1 : 0;
  }
} catch (problem) {
  if (!(problem instanceof Refused)) throw problem;
  console.error(problem.message);
  process.exitCode = 1;
}
