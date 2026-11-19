import assert from "node:assert/strict"
import test from "node:test"
import { blockOf, moveVisibility, type BlockRef } from "../src/data/source"
import { newNodeId } from "../../vault/vault/node.mjs"

test("a Friends block with an envelope-only TID keeps it inside the private copy", async () => {
  const from: BlockRef = { id: newNodeId(), layer: "friends", store: "block" }
  const opaqueId = "fixture-opaque-private-file"
  const operations: string[] = []
  const result = await moveVisibility({
    async readBlock(ref) {
      assert.deepEqual(ref, from)
      return { path: "reading/example.md", text: "---\nkind: text\nvisibility: friends\n---\n\nAlder.", version: "friends-version" }
    },
    async saveBlock(ref, file, replaces) {
      operations.push("save")
      assert.deepEqual(ref, { id: opaqueId, layer: "private", store: "sealed" })
      assert.equal(replaces, null)
      assert.equal(blockOf(file)?.id, from.id)
      assert.equal(blockOf(file)?.visibility, "private")
      return { version: "private-version" }
    },
    async deleteBlock(ref, replaces) {
      operations.push("delete")
      assert.deepEqual(ref, from)
      assert.equal(replaces, "friends-version")
    },
  }, from, { layer: "private", opaqueId }, "friends-version")
  assert.deepEqual(operations, ["save", "delete"])
  assert.equal(result.cleanupPending, false)
})
