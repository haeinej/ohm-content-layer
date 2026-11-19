import { isPostId, setProperty, writeNoteFile } from "../../../vault/vault/file.mjs"
import { readVault } from "../../../vault/vault/node.mjs"
import * as journal from "./journal"
import * as sample from "./sample"
import { sampleSearch } from "./sample-search"
import { blockOf, emptyPlan, readEvidence, visibilityMove, type BlockHead, type HomeFile, type HomeSource, type Layer } from "./source"
import type { Doc } from "./sample"

function fileOf(doc: Doc): HomeFile {
  return {
    path: `${sample.sectionOf(doc)}/${doc.slug}.md`,
    text: writeNoteFile({
      properties: {
        id: isPostId(doc.id) ? doc.id : undefined, kind: doc.kind, title: doc.title, slug: doc.slug, channels: doc.channels,
        visibility: doc.visibility, updated: doc.updated, connect: doc.connect?.map(each => each.to),
      },
      body: doc.body,
    }),
  }
}

const visibleLayers: readonly Layer[] = ["public", "friends", "private"]
const revisions = new Map<string, { content: string; version: string }>()
let sequence = 0

function versionOf(doc: Doc): string {
  const content = JSON.stringify(doc)
  const held = revisions.get(doc.id)
  if (held?.content === content) return held.version
  const version = `sample-${++sequence}`
  revisions.set(doc.id, { content, version })
  return version
}

function addDoc(doc: Doc) {
  sample.posts.push(doc)
  sample.all.push(doc)
}

function removeDoc(id: string) {
  for (const list of [sample.posts, sample.all]) {
    const index = list.findIndex(doc => doc.id === id)
    if (index >= 0) list.splice(index, 1)
  }
  revisions.delete(id)
}

function removeChannel(path: string) {
  const index = sample.channelRecords.findIndex(channel => channel.path === path)
  if (index >= 0) sample.channelRecords.splice(index, 1)
}

const missing = () => new DOMException("There is no such sample block.", "NotFoundError")
const stale = () => new DOMException("The sample block changed. Read it again before saving.", "InvalidStateError")
const friendList = sample.people.filter(person => person.did !== sample.owner.did)
  .map(person => ({ did: person.did, added: "2026-11-01" }))

/**
 * The imported prototype still uses synchronous workspace actions for editing, history and drag
 * and drop. Keep those actions on the sample adapter while the service adapter is readied for
 * the app's member-side flows.
 */
const workspace = {
  getDoc: sample.byId, posts: () => sample.posts, channels: () => sample.channelRecords,
  slugs: () => sample.all.map(doc => doc.slug),
  owner: sample.owner, inbox: () => sample.inbox,
  getChannel: sample.channelByPath, ensureChannel: sample.ensureChannel,
  addDoc, removeDoc, removeChannel, inOrder: sample.inOrder,
  journal,
}

export const sampleSource: HomeSource & { workspace: typeof workspace } = {
  workspace,
  async account() { return { did: sample.owner.did, user: { name: sample.owner.name }, mirrored: false, service: null } },
  async listBlocks(layers = visibleLayers) {
    return sample.posts.filter(post => layers.includes(post.visibility)).map((post): BlockHead => ({
      id: post.id, layer: post.visibility, path: fileOf(post).path, title: post.title, version: versionOf(post),
      store: post.visibility === "private" ? "sealed" : "post",
    }))
  },
  async readBlock(ref) {
    const doc = sample.posts.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    return { ...fileOf(doc), version: versionOf(doc) }
  },
  async saveBlock(ref, file, replaces) {
    const held = sample.byId(ref.id)
    if ((held ? versionOf(held) : null) !== replaces || (held && held.visibility !== ref.layer)) throw stale()
    const text = setProperty(file.text, "visibility", ref.layer)
    const next = blockOf({ path: file.path, text })
    if (!next) throw new DOMException("Give a sample block file.", "DataError")
    const rawConnections = "post" in next ? next.post.connect : next.properties.connect
    const connections = [rawConnections ?? []].flat().map(String)
    const connect = connections.map(to => held?.connect?.find(link => link.to === to) ?? { to })
    const [label, sublabel] = next.home.split("/")
    const doc: Doc = {
      ...held, id: ref.id, kind: "post", slug: next.slug, title: next.title ?? "",
      label, sublabel, body: next.body, channels: next.channels, visibility: ref.layer,
      connect: connect.length ? connect : undefined,
      updated: "updated" in next && next.updated ? next.updated : new Date().toISOString().slice(0, 10),
    }
    if (held) Object.assign(held, doc)
    else addDoc(doc)
    for (const path of sample.channelsOf(doc).filter(Boolean)) sample.ensureChannel(path)
    journal.syncJournal()
    return { version: versionOf(held ?? doc) }
  },
  async deleteBlock(ref, replaces) {
    const doc = sample.posts.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    if (versionOf(doc) !== replaces) throw stale()
    removeDoc(ref.id)
    journal.syncJournal()
  },
  async vault(layers = visibleLayers) {
    const blocks = sample.posts.filter(post => layers.includes(post.visibility)).map(fileOf)
    const channels = sample.channelRecords.map(channel => ({
      path: `${channel.path}/_channel.md`,
      text: writeNoteFile({
        properties: { order: channel.order.map(id => sample.byId(id)?.slug).filter(Boolean) },
        body: channel.description,
      }),
    }))
    const entities = sample.people.map(person => ({
      path: `_entities/person/${person.handle}.md`,
      text: writeNoteFile({ properties: { name: person.name, aliases: [person.handle], uri: `at://${person.did}` } }),
    }))
    return readVault([...blocks, ...channels, ...entities])
  },
  connections: layers => readEvidence(sampleSource, layers),
  search: sampleSearch,
  async history(ref) {
    return journal.linesFor(ref.id).filter(line => line.op !== "remove")
      .map(line => ({ rev: line.id, version: line.after, created: line.at })).reverse()
  },
  async readVersion(ref, rev) {
    const line = typeof rev === "string" ? journal.changeById(rev) : undefined
    const doc = sample.byId(ref.id)
    const snapshot = line && line.node === ref.id && journal.snapshotAt(line.after)
    if (!doc || !snapshot) throw missing()
    return fileOf({ ...doc, ...snapshot })
  },
  visibilityMove,
  async moveVisibility(ref, { layer: to }, replaces) {
    visibilityMove(ref, to)
    const doc = sample.posts.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    if (versionOf(doc) !== replaces) throw stale()
    // The sample presents a single view of a block across layers.
    doc.visibility = to
    journal.syncJournal()
    return { ref: { id: ref.id, layer: to, store: to === "private" ? "sealed" : "post" }, version: versionOf(doc), cleanupPending: false }
  },
  async listFriends() { return structuredClone(friendList) },
  async removeFriend(did) {
    const index = friendList.findIndex(friend => friend.did === did)
    if (index >= 0) friendList.splice(index, 1)
  },
  async listShared() { return [] },
  async readShared() { throw missing() },
  async publishPlan() { return emptyPlan() },
}
