import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/storage.js';
import { createAdmin } from '../server/auth.js';
import { createAppServer } from '../server/http.js';
test('free competitions save and accept submissions without payment credentials; paid entries remain protected', async t => {
 const dir=await mkdtemp(join(tmpdir(),'compete-free-'));const store=new FileStore(dir);await store.init();await createAdmin(store,'owner@example.com','Owner-password-123');const server=await createAppServer(store,{});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
 async function req(path,body,cookie){const multipart=body instanceof FormData;const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{Origin:origin,...(multipart?{}:{'Content-Type':'application/json'})}:{})},body:body?(multipart?body:JSON.stringify(body)):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const admin=await req('/api/auth/login',{email:'owner@example.com',password:'Owner-password-123'});const user=await req('/api/auth/register',{email:'artist@example.com',name:'Artist',password:'1234'});
 const c={title:'Free art',category:'Art',description:'Original work',rules:'Original images',fee:0,prizes:[0,0,0],deadline:'2099-12-31',status:'open'};
 const saved=await req('/api/admin/competition',c,admin.cookie);assert.equal(saved.status,200);c.id=saved.data.id;
 assert.equal((await req('/api/order',{competition:c.id},user.cookie)).data.free,true);
 const form=()=>{const f=new FormData();f.set('competition',c.id);f.set('name','Artist');f.set('title','Free entry');f.set('original','yes');f.set('image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'art.png');return f;};
 const entry=await req('/api/submit',form(),user.cookie);assert.equal(entry.status,200);assert(entry.data.certificate);
 assert.equal((await req('/api/submit',form(),user.cookie)).status,409);
 assert.equal((await req('/api/admin/competition',{...c,fee:100},admin.cookie)).status,409);
 const paid=await req('/api/admin/competition',{...c,id:undefined,title:'Paid art',fee:100},admin.cookie);c.id=paid.data.id;
 assert.equal((await req('/api/order',{competition:c.id},user.cookie)).status,503);
 assert.equal((await req('/api/submit',form(),user.cookie)).status,403);
 const negative=await req('/api/admin/competition',{...c,id:undefined,fee:-1},admin.cookie);assert.equal(negative.status,400);
});
