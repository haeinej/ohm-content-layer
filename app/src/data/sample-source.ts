import { setProperty, writeNoteFile } from "../../../vault/vault/file.mjs"
import { evidence, readVault } from "../../../vault/vault/node.mjs"
import * as journal from "./journal"
import * as sample from "./sample"
import { sampleSearch } from "./sample-search"
import { blockOf, emptyPlan, visibilityMove, type BlockHead, type HomeFile, type HomeSource, type Layer } from "./source"
import type { Doc } from "./sample"

function fileOf(doc: Doc): HomeFile {
  return {
    path: `${sample.locationOf(doc)}/${doc.slug}.md`,
    text: writeNoteFile({
      properties: {
        id: doc.id, kind: doc.kind, title: doc.title, slug: doc.slug, channels: doc.channels,
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
  sample.blocks.push(doc)
  sample.all.push(doc)
}

function removeDoc(id: string) {
  for (const list of [sample.blocks, sample.all]) {
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
const friendList = sample.entities.filter(person => person.did !== sample.owner.did)
  .map(person => ({ did: person.did, added: "2026-11-01" }))

/**
 * The imported prototype still uses synchronous workspace actions for editing, history and drag
 * and drop. Keep those actions on the sample adapter while the service adapter is readied for
 * the app's member-side flows.
 */
function sampleVault(layers = visibleLayers) {
  const blocks = sample.blocks.filter(block => layers.includes(block.visibility)).map(fileOf)
  const channels = sample.channelRecords.map(channel => ({
    path: `${channel.path}/_channel.md`,
    text: writeNoteFile({
      properties: { order: channel.order.map(id => sample.byId(id)?.slug).filter(Boolean) },
      body: channel.description,
    }),
  }))
  const entities = sample.entities.map(entity => ({
    path: `_entities/person/${entity.handle.replaceAll(".", "-")}.md`,
    text: writeNoteFile({ properties: { name: entity.name, aliases: [entity.handle], uri: `at://${entity.did}` } }),
  }))
  return readVault([...blocks, ...channels, ...entities])
}

function sampleEvidence(layers?: readonly Layer[]) {
  const vault = sampleVault(layers)
  const edges = evidence(vault)
  const keysBySlug = new Map(vault.blocks.map(block => [block.slug, sample.blockKey(block.id)]))
  // The wireframe has whole-block connections even on unpublished blocks. Preserve the fixture's
  // links while the vault's file format only recognizes the post's connect field.
  for (const block of sample.blocks) {
    const from = keysBySlug.get(block.slug)
    if (!from || block.kind === "post") continue
    for (const connection of block.connect ?? []) {
      const to = keysBySlug.get(connection.to)
      if (to) edges.push({ kind: "links", from, to, at: "connect" })
    }
  }
  return edges
}

const workspace = {
  getDoc: sample.byId, blocks: () => sample.blocks, channels: () => sample.channelRecords,
  evidence: sampleEvidence,
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
    return sample.blocks.filter(post => layers.includes(post.visibility)).map((post): BlockHead => ({
      id: post.id, layer: post.visibility, path: fileOf(post).path, title: post.title, version: versionOf(post),
      store: post.visibility === "private" ? "sealed" : post.kind === "post" ? "post" : "block",
    }))
  },
  async readBlock(ref) {
    const doc = sample.blocks.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    return { ...fileOf(doc), version: versionOf(doc) }
  },
  async saveBlock(ref, file, replaces) {
    const held = sample.byId(ref.id)
    if (held && !sample.isBlock(held)) throw missing()
    if ((held ? versionOf(held) : null) !== replaces || (held && held.visibility !== ref.layer)) throw stale()
    const text = setProperty(file.text, "visibility", ref.layer)
    const next = blockOf({ path: file.path, text })
    if (!next || (next.id && next.id !== ref.id)) throw new DOMException("Give a sample block file.", "DataError")
    const doc: Doc = {
      ...held, id: ref.id, kind: sample.isBlockKind(next.kind) ? next.kind : "text", slug: next.slug, title: next.title ?? "",
      homeChannel: next.home || "other", body: next.body, channels: next.channels, visibility: ref.layer,
      updated: "updated" in next && next.updated ? next.updated : new Date().toISOString().slice(0, 10),
    }
    if (held) Object.assign(held, doc)
    else addDoc(doc)
    for (const path of sample.channelsOf(doc).filter(Boolean)) sample.ensureChannel(path)
    journal.syncJournal()
    return { version: versionOf(held ?? doc) }
  },
  async deleteBlock(ref, replaces) {
    const doc = sample.blocks.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    if (versionOf(doc) !== replaces) throw stale()
    removeDoc(ref.id)
    journal.syncJournal()
  },
  async vault(layers) { return sampleVault(layers) },
  async connections(layers) { return sampleEvidence(layers) },
  search: sampleSearch,
  async history(ref) {
    return journal.linesFor(ref.id).filter(line => line.owner === "vault" && line.op !== "remove")
      .map(line => ({ rev: line.id, version: line.after, created: line.at })).reverse()
  },
  async readVersion(ref, rev) {
    const line = typeof rev === "string" ? journal.changeById(rev) : undefined
    const doc = sample.byId(ref.id)
    const snapshot = line?.owner === "vault" && line.node === ref.id && journal.snapshotAt(line.after)
    if (!doc || !snapshot) throw missing()
    return fileOf({ ...doc, ...snapshot })
  },
  visibilityMove,
  async moveVisibility(ref, { layer: to }, replaces) {
    visibilityMove(ref, to)
    const doc = sample.blocks.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    if (versionOf(doc) !== replaces) throw stale()
    // The sample presents a single view of a block across layers.
    doc.visibility = to
    journal.syncJournal()
    return { ref: { id: ref.id, layer: to, store: to === "private" ? "sealed" : doc.kind === "post" ? "post" : "block" }, version: versionOf(doc), cleanupPending: false }
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
