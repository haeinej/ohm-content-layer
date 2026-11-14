// vault.md: how to read the vault. One heading for each section. Under it, a line of counts that
// cortex keeps in step with the vault, then what the section means and how posts there are filed,
// written by the agent and editable by the person, then anything else the person wrote, kept as it is.
//
//   ## essays
//   12 posts.
//   Meaning: Finished long-form writing, one idea each.
//   Conventions: Titles in sentence case. Linked to the reading notes they came from.
import { Refused } from './core.mjs';

export const HEADER = [
  '# How to read the vault',
  '',
  '<!-- Kept by cortex. The count under each heading follows the vault and is rewritten. Meaning and Conventions are written by your agent: edit them freely, and what you write outranks what it wrote. Anything else you add under a heading is kept as you wrote it. -->',
  '',
].join('\n');
export const LINES = { meaning: 'Meaning', conventions: 'Conventions' };
const GONE = 'Not in the vault any more.';
const counted = line => /^\d+ posts?\.$/.test(line.trim()) || line.trim() === GONE;

// What the person writes above the first section is kept under the empty key, and written back
// after the header.
const INTRO = '';
const headerLines = new Set(HEADER.split('\n').filter(Boolean));

// `known` names the sections the vault has now. A heading starts a section when it names one of
// them, or when cortex wrote it (its count line follows). Any other heading is the person's own,
// and is kept as part of the text under the section it sits in.
export function parseMap(text, known = new Set()) {
  const sections = new Map();
  let current = { meaning: '', conventions: '', extra: [] };
  sections.set(INTRO, current);
  const lines = (text ?? '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading && (known.has(heading[1].trim()) || counted(lines[index + 1] ?? ''))) {
      current = { meaning: '', conventions: '', extra: [] };
      sections.set(heading[1].trim(), current);
      continue;
    }
    if (current === sections.get(INTRO)) {
      if (!headerLines.has(line)) current.extra.push(line);
      continue;
    }
    const field = /^(Meaning|Conventions):\s*(.*)$/.exec(line);
    if (field) current[field[1] === 'Meaning' ? 'meaning' : 'conventions'] = field[2].trim();
    else if (!counted(line)) current.extra.push(line);
  }
  for (const section of sections.values()) {
    while (section.extra.length && !section.extra.at(-1).trim()) section.extra.pop();
    while (section.extra.length && !section.extra[0].trim()) section.extra.shift();
  }
  return sections;
}

// Sections the vault has, in its order, then any the vault no longer has but that still hold words,
// so nothing written about a section is lost when it goes.
export function writeMap(shape, written) {
  const blocks = [];
  const block = (key, count, words = { meaning: '', conventions: '', extra: [] }) => {
    const lines = [`${key.includes('/') ? '###' : '##'} ${key}`, count];
    if (words.meaning) lines.push(`${LINES.meaning}: ${words.meaning}`);
    if (words.conventions) lines.push(`${LINES.conventions}: ${words.conventions}`);
    if (words.extra.length) lines.push(...words.extra);
    blocks.push(lines.join('\n'));
  };
  const intro = written.get(INTRO)?.extra ?? [];
  const present = new Set([INTRO]);
  for (const { section, posts } of shape.sections) {
    present.add(section);
    block(section, `${posts} post${posts === 1 ? '' : 's'}.`, written.get(section));
  }
  for (const [key, words] of written) {
    if (present.has(key) || (!words.meaning && !words.conventions && !words.extra.length)) continue;
    block(key, GONE, words);
  }
  return `${HEADER}\n${intro.length ? `${intro.join('\n')}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

export const gone = (shape, written) => [...written.keys()].filter(key => key !== INTRO && !shape.sections.some(section => section.section === key));

export function checkWords(field, text) {
  if (!Object.hasOwn(LINES, field)) throw new Refused('InvalidRequest', 'Describe a section by its meaning or its conventions');
  if (typeof text !== 'string' || !text.trim() || text.length > 500 || /[\r\n]/.test(text)) throw new Refused('InvalidRequest', `${field} is one line, at most 500 characters`);
  return text.trim();
}
