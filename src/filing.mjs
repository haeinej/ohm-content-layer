// Filing advice: one answer to "how should I file this?", built from what cortex already knows.
// The likely sections come from vault.md, the skill from the approved skills, and related posts
// from the vault's own search. Matching is by words; nothing here calls a model.
//
// It reads and never writes: not the cortex, not the vault. Saving is the vault's job, done by
// the agent through the vault's own tools once the person says yes.
import { Refused } from './core.mjs';
import { wordsOf } from './vault.mjs';
import { parseMap } from './vaultmap.mjs';

const SECTIONS = 3;
const RELATED = 5;
// The words of the text that go to search, besides the title's: the ones it uses most.
const TEXT_WORDS = 8;

function checkSource({ kind, title, text } = {}) {
  if (typeof kind !== 'string' || !kind.trim() || kind.length > 200) throw new Refused('InvalidRequest', 'Say what the source is, in a few words, such as "meeting transcript" or "link"');
  if (title !== undefined && (typeof title !== 'string' || title.length > 500)) throw new Refused('InvalidRequest', 'title is text, at most 500 characters');
  if (text !== undefined && (typeof text !== 'string' || text.length > 1_000_000)) throw new Refused('InvalidRequest', 'text is the source as given, at most 1,000,000 characters');
  return { kind: kind.trim(), title: title?.trim() ?? '', text: text ?? '' };
}

function mostUsed(text, count) {
  const seen = new Map();
  for (const token of text.split(/\s+/)) for (const word of wordsOf(token)) seen.set(word, (seen.get(word) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([word]) => word);
}

// A section scores for each of its words the source has: most for the kind, then the title, then
// the text. A word in the section's name counts once more than one only in its meaning.
function sectionsFor(source, shape, map) {
  const weights = [[wordsOf(source.kind), 3], [wordsOf(source.title), 2], [wordsOf(source.text), 1]];
  const weight = word => Math.max(0, ...weights.filter(([words]) => words.has(word)).map(([, value]) => value));
  const scored = [];
  for (const { section, posts } of shape.sections) {
    const words = map.get(section) ?? { meaning: '', conventions: '' };
    const inName = wordsOf(section.replace(/[/-]/g, ' '));
    const inMeaning = wordsOf(words.meaning);
    let score = 0;
    const shared = [];
    for (const word of new Set([...inName, ...inMeaning])) {
      const found = weight(word);
      if (!found) continue;
      score += found + (inName.has(word) ? 1 : 0);
      shared.push(word);
    }
    if (!score) continue;
    const named = shared.filter(word => inName.has(word));
    const meant = shared.filter(word => !inName.has(word));
    const why = [named.length ? `its name shares ${named.join(', ')} with the source` : '', meant.length ? `its meaning shares ${meant.join(', ')}` : ''].filter(Boolean).join(', and ');
    scored.push({ score, item: { section, posts, ...(words.meaning ? { meaning: words.meaning } : {}), ...(words.conventions ? { conventions: words.conventions } : {}), why: `${why[0].toUpperCase()}${why.slice(1)}` } });
  }
  scored.sort((a, b) => b.score - a.score || a.item.section.localeCompare(b.item.section));
  return scored.slice(0, SECTIONS).map(({ item }) => item);
}

// The approved skill whose name and description share the most words with the kind, if any does.
function skillFor(kind, skills) {
  const wanted = wordsOf(kind);
  let best = null;
  for (const skill of skills) {
    const words = new Set([...wordsOf(skill.name.replace(/-/g, ' ')), ...wordsOf(skill.description)]);
    const score = [...wanted].filter(word => words.has(word)).length;
    if (score && (!best || score > best.score)) best = { score, skill: { name: skill.name, description: skill.description } };
  }
  return best?.skill ?? null;
}

function askFor(sections, related, shape) {
  if (!sections.length) {
    const names = shape.sections.map(item => item.section);
    return names.length
      ? `None of the sections fits this by its words: which one should it go in (${names.join(', ')}), or should it start a new one?`
      : 'The vault has no sections yet: where would you like this to go?';
  }
  const [first] = sections;
  const titled = first.conventions ? `titled the way posts there are (${first.conventions})` : 'with a title in your words, since no convention is written for that section yet';
  const linked = related.length ? `, linked to ${related.map(post => `"${post.title}"`).join(', ')}` : '';
  return `Shall I file this under ${first.section}, ${titled}${linked}?`;
}

export async function adviseFiling(cortex, given) {
  const source = checkSource(given);
  const skill = skillFor(source.kind, await cortex.listSkills());
  const answer = (vault, rest) => ({ vault, sections: [], skill, related: [], ...rest });

  let vault;
  try { vault = await cortex.connectedVault(); } catch (problem) {
    if (!(problem instanceof Refused)) throw problem;
    return answer({ connected: true, reachable: false, problem: problem.message }, { ask: `The vault cannot be read (${problem.message}), so I cannot say where this goes yet. Shall I wait until it can?` });
  }
  if (!vault) return answer({ connected: false }, { ask: 'No vault is connected to this cortex, so there is nowhere to file this yet. Would you like to connect one first?' });

  let shape;
  try { shape = await vault.shape(); } catch (problem) {
    if (!(problem instanceof Refused)) throw problem;
    return answer({ connected: true, reachable: false, problem: problem.message }, { ask: `The vault cannot be read (${problem.message}), so I cannot say where this goes yet. Shall I wait until it can?` });
  }
  const map = parseMap(await cortex.vaultMap(), new Set(shape.sections.map(item => item.section)));
  const sections = sectionsFor(source, shape, map);

  // A vault that cannot search gives no related posts, and the rest of the answer stands.
  let related = [];
  if (typeof vault.search === 'function') {
    const words = [...new Set([...wordsOf(source.title), ...mostUsed(source.text, TEXT_WORDS)])];
    if (words.length) related = (await vault.search(words, RELATED)).slice(0, RELATED).map(({ id, title, label, sublabel }) => ({ id, title, label, ...(sublabel ? { sublabel } : {}) }));
  }
  return answer({ connected: true }, { sections, related, ask: askFor(sections, related, shape) });
}
