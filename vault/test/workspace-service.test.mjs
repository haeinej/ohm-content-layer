import assert from 'node:assert/strict';
import test from 'node:test';
import { testDatabase } from './d1.mjs';
import { createService } from '../service/src/worker.mjs';
import { links } from '../service/src/ohm.mjs';
import mirror from '../service/src/capabilities/mirror.mjs';

const A = 'did:web:a.test', B = 'did:web:b.test';
let serial = 0;
async function setup(t) {
  const DB = await testDatabase(), linked = links(DB), user = `user-${serial++}`;
  t.after(() => DB.sqlite.close());
  const env = { DB, MEMBERS: '*', SERVICE_DID: 'did:web:vault.test', OHM_APP_ORIGIN: 'https://app.test', AUTH: { fetch: async () => Response.json({ user: { id: user } }) } };
  await linked.connect(user, A);
  const service = createService();
  const ask = (name, body, expected = A) => service(new Request(`https://app.test/xrpc/${name}`, { method: body ? 'POST' : 'GET', headers: { Cookie: `session=${user}`, Origin: env.OHM_APP_ORIGIN, ...(expected ? { 'X-Ohm-Did': expected } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? {body: JSON.stringify(body)} : {}) }), env);
  return { DB, linked, user, env, ask };
}
test('cookie data access honors MEMBERS but account recovery stays available', async t => {
  const { env, ask } = await setup(t);
  env.MEMBERS = B;
  for (const [name, body] of [['com.ohmmmm.vault.getTree'], ['com.ohmmmm.vault.putPost', {post:{}}]]) {
    const response = await ask(name, body);
    assert.equal(response.status,403); assert.equal((await response.json()).error,'NotAMember');
  }
  assert.equal((await ask('com.ohmmmm.account.get')).status,200);
  assert.equal((await ask('com.ohmmmm.account.disconnect',{})).status,200);
  assert.equal((await ask('com.ohmmmm.account.get',null,null)).status,200);
  assert.equal((await ask('com.ohmmmm.vault.getTree',null,null)).status,409);
});

test('old mirror completion cannot mark a reconnected DID mirrored', async t => {
  const {DB,linked,user}=await setup(t); let changed=false;
  await assert.rejects(mirror.requests['com.ohmmmm.vault.importPublished'].run({env:{DB},did:A,user:{id:user},linked,body:async()=>({apply:true,site:'https://site.test'}),identify:{pdsFor:async()=> 'https://pds.test'},posts:{},get:async url=>{if(!changed){changed=true;await linked.disconnect(user);await linked.connect(user,B);}return Response.json(new URL(url).pathname.endsWith('describeRepo')?{collections:[]}:{records:[]});}}),error=>error.code==='AccountChanged');
  assert.deepEqual(await linked.of(user),{did:B,mirrored:false});
});
