// Identity: the few facts about a person or organisation that rarely change. Each field has one
// type, is checked when it is set, and is never guessed. The list is fixed: an agent cannot add a
// field. A person may write their own fields below these, and those are kept as they wrote them.
import { cortexVersion, Refused, splitFront, writeFront } from './core.mjs';

const line = (max = 200) => value => typeof value === 'string' && value.trim() && value.length <= max && !/[\r\n]/.test(value) ? value.trim() : null;
const list = (each, max = 10) => value => {
  if (!Array.isArray(value) || !value.length || value.length > max) return null;
  const checked = value.map(each);
  return checked.every(item => item !== null) && new Set(checked.map(item => JSON.stringify(item))).size === checked.length ? checked : null;
};
const address = value => line(254)(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const email = value => {
  if (typeof value === 'string') return address(value) && { label: 'main', address: address(value) };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['label', 'address'].includes(key))) return null;
  const label = line(40)(value.label);
  return label && address(value.address) ? { label, address: address(value.address) } : null;
};
const url = value => {
  if (!line(2000)(value)) return null;
  try { const parsed = new URL(value.trim()); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
};
const language = value => {
  if (!line(35)(value)) return null;
  try { return Intl.getCanonicalLocales(value.trim())[0]; } catch { return null; }
};
const timezone = value => {
  if (!line(64)(value)) return null;
  try { return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone; } catch { return null; }
};
// A whole date, or a month and day alone (ISO 8601's --MM-DD) for someone who gives no year.
const birthdate = value => {
  if (typeof value !== 'string') return null;
  const found = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!found) return null;
  const [, year, month, day] = found;
  const date = new Date(Date.UTC(year === '-' ? 2000 : Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  if (year !== '-' && (Number(year) < 1900 || date > new Date())) return null;
  return value.trim();
};
const account = value => line(253)(value) && (/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(value.trim()) || /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value.trim())) ? value.trim() : null;

// Order here is the order the fields are written in identity.md.
export const IDENTITY = {
  kind: { check: value => ['person', 'organization'].includes(value) ? value : null, says: 'person or organization' },
  account: { check: account, says: 'a DID or a handle', fromAccountOnly: true },
  name: { check: line(), says: 'their name, as they give it, on one line' },
  preferredName: { check: line(100), says: 'what to call them, on one line' },
  pronouns: { check: line(60), says: 'their pronouns, as they state them', personOnly: true },
  emails: { check: list(email), says: 'a list of addresses, each with a label', sensitive: true },
  websites: { check: list(url), says: 'a list of http or https addresses' },
  city: { check: line(100), says: 'the city they are based in', sensitive: true },
  timezone: { check: timezone, says: 'a time zone such as Asia/Seoul' },
  languages: { check: list(language), says: 'a list of language tags, the preferred one first' },
  // Hidden from agents altogether: they are told one is on file, and ask the person when a task needs it.
  birthdate: { check: birthdate, says: 'a date as YYYY-MM-DD, or --MM-DD with no year', sensitive: true, hidden: true },
  occupation: { check: line(), says: 'what they do, on one line' },
  organization: { check: line(), says: 'where they do it, on one line' },
  position: { check: line(), says: 'their role there, on one line' },
};
export const FIELDS = Object.keys(IDENTITY);
export const SENSITIVE = FIELDS.filter(field => IDENTITY[field].sensitive);
export const HIDDEN = FIELDS.filter(field => IDENTITY[field].hidden);

// What an agent is given of an identity: every confirmed field but the hidden ones, which are
// only named, so it knows to ask.
export function forAgent({ fields, own, about }) {
  const shown = Object.fromEntries(Object.entries(fields).filter(([field]) => !HIDDEN.includes(field)));
  const onFile = HIDDEN.filter(field => fields[field] !== undefined);
  return { ...shown, ...(Object.keys(own).length ? { own } : {}), about, ...(onFile.length ? { hidden: onFile } : {}) };
}
export const shownValue = (field, value) => HIDDEN.includes(field) ? '(hidden)' : value;

// A waiting proposal as an agent sees it. For a hidden field the evidence is hidden too: a quote
// or passage that states a birthdate is the birthdate. Only where it came from is kept.
export function proposalForAgent({ id, field, value, source }) {
  if (!HIDDEN.includes(field)) return { id, field, value, source };
  const block = source?.block ?? source?.post;
  return { id, field, value: '(hidden)', source: { kind: source?.kind, ...(block ? { block } : {}), hidden: true } };
}

export function checkField(field, value) {
  if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field. The fields are: ${FIELDS.join(', ')}`);
  const checked = IDENTITY[field].check(value);
  if (checked === null || checked === undefined || checked === false) throw new Refused('InvalidIdentity', `${field} is ${IDENTITY[field].says}`);
  return checked;
}

// People write lists by hand as `[ko, en]` or `ko, en`. Read those as lists, so a hand edit is not a problem.
function handWritten(field, value) {
  if (typeof value !== 'string' || !['languages', 'websites', 'emails'].includes(field)) return value;
  return value.replace(/^\[(.*)\]$/, '$1').split(',').map(item => item.trim().replace(/^['"](.*)['"]$/, '$1')).filter(Boolean);
}

// The person's comment at the top of the body is a hint for them, not part of what they are about.
const about = body => body.replace(/^\s*<!--[\s\S]*?-->\s*/, '').trim();

export async function readIdentity(content) {
  const { properties, body } = splitFront(content ?? '');
  const fields = {};
  const own = {};
  const problems = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!Object.hasOwn(IDENTITY, key)) { own[key] = value; continue; }
    if (value === null || value === '') continue;
    try { fields[key] = checkField(key, handWritten(key, value)); } catch (problem) {
      if (!(problem instanceof Refused)) throw problem;
      problems.push(`identity.md: ${problem.message}`);
    }
  }
  return { fields, own, about: about(body), problems, properties, body, version: await cortexVersion({ identity: content ?? '' }) };
}

// Writes the fixed fields in their order, then the person's own, then the body as it was.
export function writeIdentity(properties, body) {
  const ordered = {};
  for (const field of FIELDS) if (properties[field] !== undefined) ordered[field] = properties[field];
  for (const [key, value] of Object.entries(properties)) if (!Object.hasOwn(IDENTITY, key)) ordered[key] = value;
  return writeFront(ordered, body.startsWith('\n') ? body : `\n${body}`).replace(/^---\n---\n/, '---\n\n---\n');
}

// For fields written in words, the evidence must say the value itself: a quote about Lisbon is not
// evidence for Porto. Fields that cannot be read off word for word (kind, timezone, languages,
// birthdate) rest on the person confirming them.
const plain = words => String(words).toLowerCase().replace(/\s+/g, ' ').trim();
const site = address => plain(address).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
export function statesValue(field, value, said) {
  const words = plain(said);
  if (['name', 'preferredName', 'pronouns', 'city', 'occupation', 'organization', 'position'].includes(field)) return words.includes(plain(value));
  if (field === 'emails') return value.every(email => words.includes(plain(email.address)));
  if (field === 'websites') return value.every(address => words.includes(site(address)));
  return true;
}

// Evidence is what makes a proposal more than a guess: the person's own words, or a passage of
// one of their blocks that states the fact. With a vault connected, the folder checks the block says it.
// A source from before channels named the block `post`; it is still taken, and kept as `block`.
export function checkSource(field, source) {
  if (IDENTITY[field]?.fromAccountOnly) throw new Refused('InvalidIdentity', `${field} comes from the signed-in account, and is never proposed`);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Refused('NoEvidence', 'A proposal names its source: the person\'s own words, or a block in the vault and the passage that states it');
  const quote = value => typeof value === 'string' && value.trim() && value.length <= 2000;
  if (source.kind === 'person') {
    if (!quote(source.quote) || Object.keys(source).some(key => !['kind', 'quote'].includes(key))) throw new Refused('NoEvidence', 'A person source quotes what they said, at most 2,000 characters');
    return { kind: 'person', quote: source.quote.trim() };
  }
  if (source.kind === 'vault') {
    if (IDENTITY[field].personOnly) throw new Refused('NoEvidence', `${field} is only ever taken from what the person says. It is never read from the vault or inferred`);
    const { post, ...rest } = source;
    const given = post !== undefined && rest.block === undefined ? { ...rest, block: post } : source;
    if (typeof given.block !== 'string' || !given.block.trim() || given.block.length > 200 || !quote(given.passage) || Object.keys(given).some(key => !['kind', 'block', 'passage'].includes(key))) {
      throw new Refused('NoEvidence', 'A vault source names the block\'s ID and quotes the passage that states the fact, at most 2,000 characters');
    }
    return { kind: 'vault', block: given.block.trim(), passage: given.passage.trim() };
  }
  throw new Refused('NoEvidence', 'A source is the person\'s own words (kind person) or a block in the vault (kind vault). Something worked out is not evidence');
}
