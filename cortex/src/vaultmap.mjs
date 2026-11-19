// vault.md: how to read the vault. One heading for each channel. Under it, a line of counts that
// cortex keeps in step with the vault, then what the channel means and how blocks there are filed,
// written by the agent and editable by the person, then anything else the person wrote, kept as it is.
//
//   ## essays
//   12 blocks.
//   Meaning: Finished long-form writing, one idea each.
//   Conventions: Titles in sentence case. Linked to the reading notes they came from.
import { Refused } from './core.mjs';

export const HEADER = [
  '# How to read the vault',
  '',
  '<!-- Kept by cortex. Each heading is a channel. The count under it follows the vault and is rewritten. Meaning and Conventions are written by your agent: edit them freely, and what you write outranks what it wrote. Anything else you add under a heading is kept as you wrote it. -->',
  '',
].join('\n');
// The header vault.md had before channels, so an older file does not keep it as the person's words.
const OLD_HEADER = '<!-- Kept by cortex. The count under each heading follows the vault and is rewritten. Meaning and Conventions are written by your agent: edit them freely, and what you write outranks what it wrote. Anything else you add under a heading is kept as you wrote it. -->';
export const LINES = { meaning: 'Meaning', conventions: 'Conventions' };
const GONE = 'Not in the vault any more.';
// Counts were written as posts before channels, and are still read.
const counted = line => /^\d+ (?:blocks?|posts?)\.$/.test(line.trim()) || line.trim() === GONE;

// What the person writes above the first channel is kept under the empty key, and written back
// after the header.
const INTRO = '';
const headerLines = new Set([...HEADER.split('\n').filter(Boolean), OLD_HEADER]);

// `known` names the channels the vault has now. A heading starts a channel when it names one of
// them, or when cortex wrote it (its count line follows). Any other heading is the person's own,
// and is kept as part of the text under the channel it sits in.
export function parseMap(text, known = new Set()) {
  const channels = new Map();
  let current = { meaning: '', conventions: '', extra: [] };
  channels.set(INTRO, current);
  const lines = (text ?? '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading && (known.has(heading[1].trim()) || counted(lines[index + 1] ?? ''))) {
      current = { meaning: '', conventions: '', extra: [] };
      channels.set(heading[1].trim(), current);
      continue;
    }
    if (current === channels.get(INTRO)) {
      if (!headerLines.has(line)) current.extra.push(line);
      continue;
    }
    const field = /^(Meaning|Conventions):\s*(.*)$/.exec(line);
    if (field) current[field[1] === 'Meaning' ? 'meaning' : 'conventions'] = field[2].trim();
    else if (!counted(line)) current.extra.push(line);
  }
  for (const channel of channels.values()) {
    while (channel.extra.length && !channel.extra.at(-1).trim()) channel.extra.pop();
    while (channel.extra.length && !channel.extra[0].trim()) channel.extra.shift();
  }
  return channels;
}

// Channels the vault has, in its order, then any the vault no longer has but that still hold words,
// so nothing written about a channel is lost when it goes.
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
  for (const { channel, blocks: count } of shape.channels) {
    present.add(channel);
    block(channel, `${count} block${count === 1 ? '' : 's'}.`, written.get(channel));
  }
  for (const [key, words] of written) {
    if (present.has(key) || (!words.meaning && !words.conventions && !words.extra.length)) continue;
    block(key, GONE, words);
  }
  return `${HEADER}\n${intro.length ? `${intro.join('\n')}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

export const gone = (shape, written) => [...written.keys()].filter(key => key !== INTRO && !shape.channels.some(item => item.channel === key));

export function checkWords(field, text) {
  if (!Object.hasOwn(LINES, field)) throw new Refused('InvalidRequest', 'Describe a channel by its meaning or its conventions');
  if (typeof text !== 'string' || !text.trim() || text.length > 500 || /[\r\n]/.test(text)) throw new Refused('InvalidRequest', `${field} is one line, at most 500 characters`);
  return text.trim();
}
