import type { HomeSource } from "./source"

const refuse = () => { throw new DOMException("The local home bridge is unavailable.", "NotSupportedError") }
const unavailable = async () => refuse()

export const localSource: HomeSource = {
  account: unavailable,
  listBlocks: unavailable,
  readBlock: unavailable,
  saveBlock: unavailable,
  deleteBlock: unavailable,
  vault: unavailable,
  connections: unavailable,
  search: unavailable,
  history: unavailable,
  readVersion: unavailable,
  visibilityMove: refuse,
  moveVisibility: unavailable,
  listFriends: unavailable,
  removeFriend: unavailable,
  listShared: unavailable,
  readShared: unavailable,
  publishPlan: unavailable,
}
