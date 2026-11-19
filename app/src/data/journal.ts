// Version history, as the cortex's journal has it (cortex/docs/journal-and-history.md in ohmmmm): one
// append-only journal of lines, and every version of every block kept by its hash. Cortex pages
// (memories, observations, skills, tools) are blocks here too. History is never rewritten: restoring or
// reverting is a new change. Synthetic, in memory, like the rest of data/.
//
// You and agents both edit directly. Every change says who made it, so an agent's edits are marked
// as its versions, and you revert what you don't want. When an agent finishes a task it writes a
// session: what it did, the changes it made, and its dead ends, as ANVC (github.com/yodering/anvc)
// keeps abandoned attempts so a later agent does not retry them.
import type { Connection, Doc } from "./workspace-model"

export type Actor = { kind: "human" | "agent"; name: string }
export const YOU: Actor = { kind: "human", name: "you" }

/** What a block's version holds: everything a change can touch. */
export type Snapshot = { title: string; body: string; label: string; sublabel?: string; channels?: string[]; connect?: Connection[] }
export type ChangeOp = "create" | "edit" | "move" | "channels" | "connect" | "restore" | "revert" | "remove"
export type DeadEnd = { tried: string; why: string; recheck?: string }

type Common = { seq: number; id: string; at: string; actor: Actor }
/** A change: what was done, to which block, by whom, with the versions before and after. */
export type ChangeLine = Common & { type: "change"; node: string; op: ChangeOp; fields: string[]; before?: string; after: string; reason?: string; summary: string }
/** What an agent did in one task, written when it finished: the changes it made, and its dead ends. */
export type SessionLine = Common & { type: "session"; done: string; changes: string[]; deadEnds: DeadEnd[] }
/** A named point in history. It changes nothing. */
export type SaveLine = Common & { type: "save"; name: string; note?: string }
export type Line = ChangeLine | SessionLine | SaveLine

export const snap = (d: Doc): Snapshot => ({
  title: d.title, body: d.body, label: d.label, sublabel: d.sublabel,
  channels: d.channels ? [...d.channels] : undefined, connect: d.connect?.map(c => ({ ...c })),
})
/** A short content hash: the same content is the same version everywhere. */
export function versionOf(s: Snapshot) {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) }
  return `v${(h >>> 0).toString(16).padStart(8, "0")}`
}
export function applySnapshot(doc: Doc, s: Snapshot) {
  doc.title = s.title
  doc.body = s.body
  doc.label = s.label
  doc.sublabel = s.sublabel
  doc.channels = s.channels ? [...s.channels] : undefined
  doc.connect = s.connect?.map(c => ({ ...c }))
}

/** A word-level difference, for showing what a change did to the text. */
export type DiffPart = { kind: "same" | "added" | "removed"; text: string }
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/)
  const n = x.length, m = y.length
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffPart[] = []
  const add = (kind: DiffPart["kind"], text: string) => { const l = out.at(-1); if (l?.kind === kind) l.text += text; else out.push({ kind, text }) }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { add("same", x[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) add("removed", x[i++])
    else add("added", y[j++])
  }
  while (i < n) add("removed", x[i++])
  while (j < m) add("added", y[j++])
  return out
}

// ─── Seed: a few days of history, by you and two agents ─────────────────────────

export function createJournal(all: Doc[]) {
  const byId = (id: string) => all.find(doc => doc.id === id)
  const journal: Line[] = []
  /** Every version of every block, by version hash. */
  const versions = new Map<string, Snapshot>()

  let seq = 0
  const lineId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`
  function push<L extends Line>(line: Omit<L, "seq" | "id">): L {
    const full = { ...line, seq: journal.length + 1, id: lineId() } as L
    journal.push(full)
    return full
  }

  /** Who is acting now: you, unless an agent's tool is running (workspace/tools.ts withAgent). */
  let acting: Actor = YOU
  const actor = () => acting
  async function actingAs<T>(who: Actor, fn: () => Promise<T>): Promise<T> {
    const was = acting
    acting = who
    try { return await fn() } finally { acting = was }
  }

  const changeById = (id: string) => journal.find((l): l is ChangeLine => l.type === "change" && l.id === id)
  const linesFor = (node: string) => journal.filter((l): l is ChangeLine => l.type === "change" && l.node === node)
  const currentVersion = (node: string) => linesFor(node).at(-1)?.after
  const snapshotAt = (version: string) => versions.get(version)

  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  /** What changed between two snapshots, as fields and one plain line. */
  function describe(before: Snapshot | undefined, after: Snapshot, op: ChangeOp): { fields: string[]; summary: string } {
    if (!before) return { fields: ["title", "body"], summary: "Made it" }
    const fields = (Object.keys(after) as (keyof Snapshot)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    if (op === "restore") return { fields, summary: "Restored an earlier version" }
    if (op === "revert") return { fields, summary: "Reverted a change" }
    const parts: string[] = []
    if (fields.includes("title")) parts.push(`Renamed to “${after.title || "Untitled"}”`)
    if (fields.includes("body")) {
      const d = words(after.body) - words(before.body)
      parts.push(`Edited the text${d ? ` (${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? "word" : "words"})` : ""}`)
    }
    if (fields.includes("label") || fields.includes("sublabel")) parts.push(`Moved to ${after.sublabel ? `${after.label} › ${after.sublabel}` : after.label}`)
    if (fields.includes("channels")) parts.push("Changed its channels")
    if (fields.includes("connect")) parts.push("Changed its connections")
    return { fields, summary: parts.join(" · ") || "No change" }
  }
  function opOf(before: Snapshot | undefined, after: Snapshot): ChangeOp {
    if (!before) return "create"
    const touched = (k: keyof Snapshot) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
    if (touched("title") || touched("body")) return "edit"
    if (touched("label") || touched("sublabel")) return "move"
    if (touched("channels")) return "channels"
    return "connect"
  }

  /**
   * Records a change: the one write path. Consecutive edits to the text by the same person or agent
   * within five minutes join one line, so typing makes one change, not one per keystroke.
   */
  function recordChange(doc: Doc, op: ChangeOp, opts: { reason?: string; at?: Date; by?: Actor } = {}) {
    const at = opts.at ?? new Date(), who = opts.by ?? acting
    const after = snap(doc)
    const version = versionOf(after)
    const before = currentVersion(doc.id)
    if (before === version) return null
    versions.set(version, after)
    const last = linesFor(doc.id).at(-1)
    const joins = last && op === "edit" && last.op === "edit" && last.actor.kind === who.kind && last.actor.name === who.name
      && journal.at(-1) === last && at.getTime() - Date.parse(last.at) < 5 * 60_000 && !opts.reason
    if (joins) {
      Object.assign(last, { after: version, at: at.toISOString(), ...describe(last.before ? versions.get(last.before) : undefined, after, "edit") })
      return last
    }
    return push<ChangeLine>({
      at: at.toISOString(), actor: who, type: "change", node: doc.id, op, before, after: version,
      ...(opts.reason ? { reason: opts.reason } : {}), ...describe(before ? versions.get(before) : undefined, after, op),
    })
  }

  /**
   * After any change to the repository, every block that differs from its last version gets a change
   * line by whoever is acting, and every block that is gone gets a removal. `next` names the op and
   * reason for a change that has one, such as a restore.
   */
  function syncJournal(next?: { op: ChangeOp; reason?: string }) {
    for (const p of all) {
      const s = snap(p)
      const held = currentVersion(p.id)
      if (held === versionOf(s)) continue
      recordChange(p, next?.op ?? opOf(held ? versions.get(held) : undefined, s), { reason: next?.reason })
    }
    const here = new Set(all.map(p => p.id))
    for (const node of new Set(journal.flatMap(l => (l.type === "change" ? [l.node] : [])))) {
      const last = linesFor(node).at(-1)!
      if (here.has(node) || last.op === "remove") continue
      const { seq: _s, id: _i, reason: _r, ...rest } = last
      push<ChangeLine>({ ...rest, at: new Date().toISOString(), actor: acting, op: "remove", fields: [], before: last.after, summary: "Removed it" })
    }
  }

  /** An agent finishing a task: what it did, its changes since its last session, and its dead ends. */
  function recordSession(who: Actor, done: string, dead: DeadEnd[] = [], at = new Date()) {
    const lastAt = journal.filter((l): l is SessionLine => l.type === "session" && l.actor.name === who.name).at(-1)?.at ?? ""
    const changes = journal.filter(l => l.type === "change" && l.actor.name === who.name && l.at > lastAt && l.at <= at.toISOString()).map(l => l.id)
    return push<SessionLine>({ at: at.toISOString(), actor: who, type: "session", done: done.trim(), changes, deadEnds: dead })
  }

  /** Names this point in history. It changes nothing. */
  function save(name: string, note?: string, at = new Date()) {
    return push<SaveLine>({ at: at.toISOString(), actor: acting, type: "save", name: name.trim(), ...(note?.trim() ? { note: note.trim() } : {}) })
  }

  const day = (d: string, t = "10:00") => new Date(`${d}T${t}:00`)
  function seed() {
    const claude: Actor = { kind: "agent", name: "Claude Code" }
    const muse: Actor = { kind: "agent", name: "Muse" }
    const current = new Map(all.map(p => [p.id, snap(p)]))
    const doc = (id: string) => byId(id)!
    const edit = (id: string, s: Snapshot, op: ChangeOp, by: Actor, at: Date, reason?: string) => { applySnapshot(doc(id), s); recordChange(doc(id), op, { by, at, reason }) }

    // Every block and cortex page starts as it is now, made by you on its date, except two with earlier versions.
    for (const p of all) if (p.id !== "p4" && p.id !== "p2") recordChange(p, "create", { at: day(p.updated, "09:00"), by: YOU })

    const p2Now = current.get("p2")!, p4Now = current.get("p4")!
    edit("p2", { ...p2Now, body: "# Slow software\n\nTools that wait for you." }, "create", YOU, day("2026-10-18", "21:10"))
    edit("p2", { ...p2Now, body: "# Slow software\n\nTools that wait for you. A draft that is private until you say otherwise." }, "edit", YOU, day("2026-10-20", "08:40"))
    edit("p2", p2Now, "edit", muse, day("2026-10-21", "11:02"), "Linked the two pages you said say the same thing")
    recordSession(muse, "Linked Slow software to the pages it echoes", [
      { tried: "Filing Slow software under projects", why: "You keep essays in writing, and moved it back the last time" },
    ], day("2026-10-21", "11:05"))

    edit("p4", { ...p4Now, body: "# Monday, rain\n\nNothing shipped.", channels: undefined }, "create", YOU, day("2026-11-10", "22:15"))
    save("Before the slowness channel", "Everything as it was before I started collecting slowness", day("2026-11-10", "23:00"))
    edit("p4", { ...p4Now, body: "# Monday, rain\n\nNothing shipped. Read for an hour.", channels: undefined }, "edit", claude, day("2026-11-11", "07:30"), "Added the line you dictated")
    recordSession(claude, "Added the line you dictated to Monday, rain", [
      { tried: "Turning the entry into a checklist", why: "You said journal entries stay as prose", recheck: "Read the working-style memory" },
    ], day("2026-11-11", "07:32"))
    edit("p4", p4Now, "edit", YOU, day("2026-11-11", "08:05"))

    // Recent agent edits, marked as theirs: a cortex page and a connection. Revert either if you don't want it.
    const c3 = current.get("c3")!
    edit("c3", { ...c3, body: "# Photo captions are one line\n\nSeen in two sessions, project photos. Three recent photo posts used two lines: one for the place, one for the light." },
      "edit", claude, day("2026-11-18", "18:20"), "Your last three photo captions used two lines")
    recordSession(claude, "Checked your caption memory against recent photos", [], day("2026-11-18", "18:21"))
    const p9 = current.get("p9")!
    edit("p9", { ...p9, connect: [{ to: "garden-of-notes", why: "A pattern language is where the garden idea started" }] }, "connect", muse, day("2026-11-19", "09:10"), "Your garden essay quotes the first book on this list")
    recordSession(muse, "Looked for pages that belong together", [
      { tried: "Connecting Reading list to Tokyo walks, day one", why: "Nothing on the list is about the walks" },
    ], day("2026-11-19", "09:12"))
  }
  if (all.length) seed()
  return { journal, actor, actingAs, changeById, linesFor, currentVersion, snapshotAt, syncJournal, recordSession, save }
}
