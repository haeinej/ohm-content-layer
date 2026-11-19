import { isPostId, postFile } from "../../../vault/vault/file.mjs"
import { readNode, readVault } from "../../../vault/vault/node.mjs"
import { words } from "../../../vault/vault/words.mjs"
import {
  blockOf, loadVault, moveVisibility, readEvidence, searchInput, visibilityMove,
  type Account, type BlockFile, type BlockHead, type BlockRef, type Friend, type HistoryVersion,
  type HomeFile, type HomeSource, type Layer, type PublishPlan,
} from "./source"
import type { SearchHit } from "./search"

type RemoteBlock = { id: string; path: string; title?: string; version: string; kind: string }
type PostHead = { id: string; slug: string; title?: string; visibility: Layer }
type Tree = { labels: { label: string; posts: PostHead[]; sublabels: { sublabel: string; posts: PostHead[] }[] }[] }
type SealedRow<Sealed> = { id: string; sealed: Sealed; version: string }
type Keys<Master, Sealed> = {
  vaultPrivateFiles(options: { baseUrl: string; fetch: typeof fetch }): {
    list(): Promise<SealedRow<Sealed>[]>
    get(id: string): Promise<SealedRow<Sealed> | null>
    replace(file: { id: string; sealed: Sealed; replaces: string | null }): Promise<unknown>
  }
  openFile(master: Master, did: string, id: string, file: Sealed): Promise<Uint8Array>
  sealFile(master: Master, did: string, id: string, plain: Uint8Array<ArrayBuffer>): Promise<Sealed>
}

type ServiceOptions<Master, Sealed> = {
  origin: string
  did: string
  fetch?: typeof fetch
  sharedServiceToken?: (method: "com.ohmmmm.vault.listShared" | "com.ohmmmm.vault.getShared") => Promise<string>
  /** Supplied by the account's browser session using ohm-onboarding packages/keys. */
  privateSession?: { keys: Keys<Master, Sealed>; unlocked(): { did: string; master: Master } | null }
}

export class HomeRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

const friendsHead = (block: RemoteBlock): BlockHead => ({
  id: block.id, path: block.path, title: block.title, version: block.version,
  layer: "friends", store: block.kind === "post" ? "post" : "block",
})
const visibleLayers: readonly Layer[] = ["public", "friends"]

export function createServiceSource<Master, Sealed>(options: ServiceOptions<Master, Sealed>): HomeSource {
  const { did, origin, privateSession, fetch: send = fetch } = options
  const base = new URL("/vault/", origin)
  if (typeof location !== "undefined" && base.origin !== location.origin) {
    throw new HomeRefusal("WrongOrigin", "Vault requests need the signed-in app's origin.")
  }
  const boundFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base)
    if (url.origin !== base.origin || !url.pathname.startsWith("/vault/xrpc/")) {
      throw new HomeRefusal("WrongOrigin", "Vault requests need the signed-in app's origin.")
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("X-Ohm-Did", did)
    return send(input, { ...init, headers, credentials: "same-origin", redirect: "error" })
  }
  const ask = async <T>(name: string, input: {
    query?: Record<string, string>; body?: unknown; signal?: AbortSignal; account?: boolean; token?: string
  } = {}): Promise<T> => {
    const url = new URL(`xrpc/com.ohmmmm.${name}`, base)
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value)
    const init: RequestInit = {
      signal: input.signal, credentials: "same-origin", redirect: "error",
      ...(input.body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body),
      }),
    }
    if (input.token) init.headers = { ...init.headers, Authorization: `Bearer ${input.token}` }
    const response = await (input.account ? send : boundFetch)(url, init)
    if (!response.ok) {
      const { error, message } = await response.json().catch(() => ({}))
      throw new HomeRefusal(error ?? "HttpError", message ?? `Vault request failed (HTTP ${response.status}).`)
    }
    return response.json() as Promise<T>
  }
  const vaultAsk = <T>(name: string, input?: Parameters<typeof ask>[1]) => ask<T>(`vault.${name}`, input)
  const sharedToken = (method: "listShared" | "getShared") => {
    if (!options.sharedServiceToken) throw new HomeRefusal("TokenRequired", "Shared reads need a service token for your DID.")
    return options.sharedServiceToken(`com.ohmmmm.vault.${method}`)
  }
  const files = privateSession?.keys.vaultPrivateFiles({ baseUrl: base.href, fetch: boundFetch })
  const unlocked = () => {
    const session = privateSession?.unlocked()
    if (!privateSession || !files || !session || session.did !== did) {
      throw new HomeRefusal("PrivateLocked", "Unlock this account's private vault on this device.")
    }
    return { ...session, keys: privateSession.keys, files }
  }
  const decode = async (id: string, sealed: Sealed): Promise<HomeFile> => {
    const { keys, master } = unlocked()
    const plain = await keys.openFile(master, did, id, sealed)
    unlocked()
    const file = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain))
    if (!file || typeof file.path !== "string" || typeof file.text !== "string") {
      throw new HomeRefusal("InvalidFile", "The private file can't be read as a vault file.")
    }
    return { path: file.path, text: file.text }
  }
  const checkRef = (ref: BlockRef) => {
    const valid = ref.layer === "private"
      ? ref.store === "sealed" && /^[A-Za-z0-9_-]{16,64}$/.test(ref.id)
      : isPostId(ref.id) && (ref.store === "post" || (ref.layer === "friends" && ref.store === "block"))
    if (!valid) {
      throw new HomeRefusal("InvalidBlock", "Choose an ID and storage layer for this block.")
    }
  }
  const postHeads = async (): Promise<BlockHead[]> => {
    const { labels } = await vaultAsk<Tree>("getTree")
    const at = (posts: PostHead[], path: string): BlockHead[] => posts
      .filter(post => post.visibility === "public" || post.visibility === "friends")
      .map(post => ({ id: post.id, layer: post.visibility, title: post.title, store: "post", path: `${path}/${post.slug}.md` }))
    return labels.flatMap(label => [
      ...at(label.posts, label.label),
      ...label.sublabels.flatMap(group => at(group.posts, `${label.label}/${group.sublabel}`)),
    ])
  }
  const friendBlocks = async (): Promise<BlockHead[]> => {
    const found = new Map<string, BlockHead>()
    let since: string | undefined
    for (;;) {
      const page: { blocks: (RemoteBlock & { removed?: boolean })[]; cursor: string; more?: boolean }
        = await vaultAsk("listBlocks", { query: since === undefined ? {} : { since } })
      for (const block of page.blocks) {
        if (block.removed) found.delete(block.id)
        else found.set(block.id, friendsHead(block))
      }
      if (!page.more) return [...found.values()]
      if (!page.cursor || page.cursor === since) throw new HomeRefusal("InvalidCursor", "The friends list did not advance.")
      since = page.cursor
    }
  }
  const source: HomeSource = {
    account: () => ask<Account>("account.get", { account: true }),
    async listBlocks(layers = visibleLayers) {
      const [posts, friends, privateFiles] = await Promise.all([
        layers.some(layer => layer !== "private") ? postHeads() : [],
        layers.includes("friends") ? friendBlocks() : [],
        layers.includes("private") ? unlocked().files.list() : [],
      ])
      if (layers.includes("private")) unlocked()
      return [
        ...posts.filter(post => layers.includes(post.layer)), ...friends,
        ...privateFiles.map(({ id, version }): BlockHead => ({ id, version, layer: "private", store: "sealed" })),
      ]
    },
    async readBlock(ref) {
      checkRef(ref)
      if (ref.store === "sealed") {
        const file = await unlocked().files.get(ref.id)
        if (!file) throw new HomeRefusal("NotFound", "There is no such private file.")
        return { ...await decode(ref.id, file.sealed), version: file.version }
      }
      if (ref.store === "block") {
        const { block, version } = await vaultAsk<{ block: HomeFile; version: string }>("getBlock", { query: { id: ref.id } })
        if (blockOf(block)?.visibility !== "friends") {
          throw new HomeRefusal("LayerChanged", "The block is outside the friends layer.")
        }
        return { path: block.path, text: block.text, version }
      }
      const { post, version } = await vaultAsk<{ post: Parameters<typeof postFile>[0]; version: string }>("getPost", { query: { id: ref.id } })
      if (post.visibility !== ref.layer) throw new HomeRefusal("LayerChanged", "The post changed visibility. Refresh the vault.")
      return { ...postFile(post), version }
    },
    async saveBlock(ref, file, replaces) {
      checkRef(ref)
      const read = readNode(file.path, file.text)
      const block = blockOf(file)
      if (!read?.node || read.problems.length || (ref.store !== "sealed" && read.node.id && read.node.id !== ref.id)
        || (block && block.visibility !== ref.layer) || (ref.store !== "sealed" && !block)) {
        throw new HomeRefusal("InvalidFile", "Give a valid vault file for this ID and layer.")
      }
      if (ref.store === "sealed") {
        const { keys, master, files } = unlocked()
        const sealed = await keys.sealFile(master, did, ref.id, new TextEncoder().encode(JSON.stringify({ path: file.path, text: file.text })))
        unlocked()
        const result = await files.replace({ id: ref.id, sealed, replaces }) as { version: string }
        unlocked()
        return { version: result.version }
      }
      if (ref.store === "post" && block && "post" in block) {
        return vaultAsk("putPost", { body: { post: { ...block.post, id: ref.id }, replaces } })
      }
      if (ref.store === "block" && block?.kind !== "post") {
        return vaultAsk("putBlock", { body: { block: { id: ref.id, path: file.path, text: file.text }, replaces } })
      }
      throw new HomeRefusal("InvalidFile", "This file does not match its post or block store.")
    },
    async deleteBlock(ref, replaces) {
      checkRef(ref)
      if (!replaces) throw new HomeRefusal("InvalidVersion", "Read the block's current version before deleting it.")
      if (ref.store === "sealed") unlocked()
      const name = ref.store === "sealed" ? "deletePrivateBlock" : ref.store === "post" ? "deletePost" : "deleteBlock"
      await vaultAsk(name, { body: { id: ref.id, replaces } })
    },
    async vault(layers = visibleLayers) {
      if (!layers.includes("private")) return loadVault(source, layers)
      // The keys package already loaded the sealed files. Open them once, on this device.
      const privateFiles = await unlocked().files.list()
      const shared = await source.listBlocks(layers.filter(layer => layer !== "private"))
      const all = await Promise.all([
        ...shared.map(ref => source.readBlock(ref)),
        ...privateFiles.map(file => decode(file.id, file.sealed)),
      ])
      unlocked()
      return readVault(all)
    },
    connections: layers => readEvidence(source, layers),
    async search(input, signal) {
      const { query, limit } = searchInput(input)
      if (!query || (input.scope && !["all", "vault"].includes(input.scope))) return []
      signal?.throwIfAborted()
      const queryWords = [...new Set(words(query))]
      const matches = ({ id, file }: { id: string; file: HomeFile }): SearchHit[] => {
        const node = blockOf(file)
        if (!node) return []
        const tokens = new Set(words(`${node.title ?? ""} ${node.body}`))
        if (!queryWords.length || !queryWords.every(word => tokens.has(word))) return []
        return [{ id, title: node.title ?? node.slug, kind: "post", label: node.home, excerpt: node.body.slice(0, 120) }]
      }
      if (privateSession?.unlocked()?.did === did) {
        const [shared, sealed] = await Promise.all([source.listBlocks(), unlocked().files.list()])
        const files = await Promise.all([
          ...shared.map(async ref => ({ id: ref.id, file: await source.readBlock(ref) })),
          ...sealed.map(async row => ({ id: row.id, file: await decode(row.id, row.sealed) })),
        ])
        signal?.throwIfAborted()
        unlocked()
        return files.flatMap(matches).slice(0, limit)
      }
      type Match = { id: string; title?: string; slug: string; label: string; sublabel?: string; passage: string; visibility: Layer }
      const searchPosts = async (visibility: Layer) => {
        const result = await vaultAsk<{ posts: Match[] }>("searchPosts", { query: { q: query, visibility, limit: String(limit) }, signal })
        return result.posts.filter(post => post.visibility === visibility).map((post): SearchHit => ({
          id: post.id, title: post.title ?? post.slug, kind: "post", label: [post.label, post.sublabel].filter(Boolean).join(" › "), excerpt: post.passage,
        }))
      }
      const [publicPosts, friendsPosts, friendsFiles] = await Promise.all([
        searchPosts("public"), searchPosts("friends"), friendBlocks(),
      ])
      signal?.throwIfAborted()
      const local = (await Promise.all(friendsFiles.map(async ref => ({ id: ref.id, file: await source.readBlock(ref) })))).flatMap(matches)
      signal?.throwIfAborted()
      return [...publicPosts, ...friendsPosts, ...local].slice(0, limit)
    },
    async history(ref) {
      checkRef(ref)
      if (ref.store !== "sealed") return []
      unlocked()
      const result = await vaultAsk<{ versions: HistoryVersion[] }>("listPrivateVersions", { query: { id: ref.id } })
      unlocked()
      return result.versions
    },
    async readVersion(ref, rev) {
      checkRef(ref)
      if (ref.store !== "sealed") throw new HomeRefusal("NotSupported", "Kept versions are available for private files.")
      unlocked()
      const { ciphertext } = await vaultAsk<{ ciphertext: Sealed }>("getPrivateVersion", { query: { id: ref.id, rev: String(rev) } })
      return decode(ref.id, ciphertext)
    },
    visibilityMove,
    moveVisibility: (ref, to, version) => moveVisibility(source, ref, to, version),
    async listFriends() { return (await vaultAsk<{ friends: Friend[] }>("listFriends")).friends },
    async removeFriend(id) { await vaultAsk("removeFriend", { body: { did: id } }) },
    async listShared(owner) {
      return (await vaultAsk<{ blocks: RemoteBlock[] }>("listShared", { query: { owner }, token: await sharedToken("listShared") })).blocks.map(friendsHead)
    },
    async readShared(owner, id): Promise<BlockFile> {
      const { block, version } = await vaultAsk<{ block: HomeFile; version: string }>("getShared", { query: { owner, id }, token: await sharedToken("getShared") })
      if (blockOf(block)?.visibility !== "friends") throw new HomeRefusal("LayerChanged", "The block is outside the friends layer.")
      return { path: block.path, text: block.text, version }
    },
    publishPlan: prepare => vaultAsk<PublishPlan>("getPublishPlan", { query: prepare ? { prepare: "1" } : {} }),
  }
  return source
}
