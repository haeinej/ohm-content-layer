// What a client may read without calling a tool: the playbook, identity, how to read the vault,
// the memory index and each memory, approved skills, and the tools switched on. Secrets, the
// hidden identity fields, proposals and history are never served.
import { memoryFile, NAME, Refused } from './core.mjs';
import { forAgent } from './identity.mjs';

const markdown = (uri, text) => ({ uri, mimeType: 'text/markdown', text });
const json = (uri, value) => ({ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) });

export function createResources(cortex) {
  return {
    async list() {
      const listed = [
        { uri: 'cortex://agents/AGENTS.md', name: 'Playbook', description: 'How to keep this cortex and file into the vault. Read before anything else', mimeType: 'text/markdown' },
        { uri: 'cortex://identity', name: 'Identity', description: 'Who this cortex belongs to: the facts the person confirmed', mimeType: 'application/json' },
        { uri: 'cortex://memory/MEMORY.md', name: 'Memory index', description: 'One line for every memory', mimeType: 'text/markdown' },
        { uri: 'cortex://tools', name: 'Tools', description: 'What the person has switched on', mimeType: 'application/json' },
      ];
      if (await cortex.vaultMap() !== null) listed.splice(2, 0, { uri: 'cortex://vault.md', name: 'How to read the vault', description: 'Each section, what it means, and what goes where', mimeType: 'text/markdown' });
      for (const memory of (await cortex.list()).memories) listed.push({ uri: `cortex://memory/${memory.name}`, name: memory.name, description: memory.description, mimeType: 'text/markdown' });
      for (const skill of await cortex.listSkills()) listed.push({ uri: `cortex://skills/${skill.name}`, name: skill.name, description: skill.description, mimeType: 'text/markdown' });
      return listed;
    },

    async read(uri) {
      if (uri === 'cortex://agents/AGENTS.md') return markdown(uri, await cortex.rules());
      if (uri === 'cortex://identity') return json(uri, forAgent(await cortex.identity()));
      if (uri === 'cortex://vault.md') {
        const map = await cortex.vaultMap();
        if (map !== null) return markdown(uri, map);
      }
      if (uri === 'cortex://memory/MEMORY.md') {
        await cortex.reindex();
        const lines = (await cortex.list()).memories.map(memory => `- [${memory.name}](${memory.name}) — ${memory.description}`);
        return markdown(uri, `${lines.join('\n')}\n`);
      }
      if (uri === 'cortex://tools') return json(uri, (await cortex.listTools()).filter(tool => tool.on).map(({ name, description }) => ({ name, description })));
      const found = /^cortex:\/\/(memory|skills)\/([^/]+)$/.exec(uri);
      if (found && NAME.test(found[2])) {
        if (found[1] === 'memory') return markdown(uri, memoryFile((await cortex.read(found[2])).memory));
        return markdown(uri, (await cortex.getSkill(found[2])).skill.text);
      }
      throw new Refused('NotFound', `There is no resource ${uri}`);
    },
  };
}
