import { stat } from 'node:fs/promises';
import { join } from 'node:path';

// Remedies are commands the person can paste, even for paths with spaces or shell characters.
const shellWord = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// The person's view: report what needs attention, with a way to clear each item.
export async function cortexStatus(cortex, { now = new Date() } = {}) {
  const dir = shellWord(cortex.dir);
  // A missing or mistyped folder is not an empty cortex.
  const present = async path => stat(join(cortex.dir, path)).then(() => true, () => false);
  if (!(await present(join('agents', 'AGENTS.md'))) && !(await present('.cortex'))) {
    return [{ kind: 'problem', what: `There is no cortex at ${cortex.dir}: it has no agents/AGENTS.md and no .cortex/`, clear: `Check the path, or start one with cortex init ${dir}` }];
  }
  const state = await cortex.inspect();
  const items = [];
  const add = (kind, what, clear) => items.push({ kind, what, clear });
  for (const proposal of state.waiting.identity) add('identity-proposal', `${proposal.field}: ${JSON.stringify(proposal.value)}`, `cortex confirm ${proposal.id} ${dir} or cortex reject ${proposal.id} ${dir}`);
  for (const name of state.waiting.skills) add('skill-proposal', name, `cortex approve ${shellWord(name)} ${dir}`);
  for (const name of state.waiting.tools) add('tool-proposal', name, `Build ${name} and add it to tools/, then delete .cortex/proposed/tools/${name}.md; or delete that proposal file.`);
  if (state.notes.length) add('notes', `${state.notes.length} observation${state.notes.length === 1 ? '' : 's'} waiting to be settled`, 'The next agent session settles these with cortex_settle.');
  for (const { memory, block } of state.vault.broken ?? []) add('broken-pointer', `${memory} points at missing block ${block}`, `Ask the agent to rewrite or forget ${memory}, or restore block ${block} in the vault.`);
  for (const channel of state.vault.channels ?? []) if (!channel.meaning) add('undescribed-channel', channel.channel, `Ask the agent to describe ${channel.channel} with cortex_describe_channel, or write its Meaning: in vault.md.`);
  for (const channel of state.vault.gone ?? []) add('gone-channel', channel, `Delete the ${channel} heading and what is under it from vault.md (keep a copy in .cortex/history/).`);
  // Said once in what; clear says only what to do about it.
  const remedy = problem => {
    // While the vault cannot be reached, its only problem is that it cannot be reached.
    if (problem.startsWith('vault: ') && state.vault.reachable === false) return `Reconnect with cortex vault connect <folder> ${dir}`;
    if (/cannot be read/.test(problem)) return "Fix the file's permissions or contents";
    return 'Fix what the message names';
  };
  for (const problem of state.problems ?? []) add('problem', problem, remedy(problem));
  for (const memory of state.working.others) if (new Date(now) - new Date(memory.updated) >= 30 * 86400000) add('stale-working', `${memory.agent}, last written ${memory.updated}`, `Let ${memory.agent} distill, or keep a copy in .cortex/history/ and delete .cortex/working/${memory.agent}.md.`);
  return items;
}
