import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/storage.js';
import { adminRequest } from '../server/admin.js';
import { createAdmin, authenticate, identity, emailKey } from '../server/auth.js';

test('admin deletion blocks linked records and admins; removes unlinked records and invalidates deleted-user sessions', async t => {
 const dir=await mkdtemp(join(tmpdir(),'compete-delete-'));const store=new FileStore(dir);await store.init();t.after(()=>rm(dir,{recursive:true,force:true}));
 const put=(k,v)=>store.put(k,JSON.stringify(v));
 const remove=(kind,id,admin=true)=>adminRequest(new Request('https://example.com/api/admin/delete',{method:'POST',body:JSON.stringify({kind,id})}),{BUCKET:store,identity:{admin}});
 assert.equal((await remove('category','c1',false)).status,403);assert.equal((await remove('unknown','x')).status,400);
 await put('category/c1',{id:'c1',name:'Art'});await put('competition/m1',{id:'m1',category:'Art'});
 assert.equal((await remove('category','c1')).status,409);assert.equal((await remove('competition','m1')).status,200);assert.equal((await remove('category','c1')).status,200);assert.equal(await store.get('category/c1'),null);
 await put('competition/used',{id:'used'});await put('entry/e1',{competition:'used',uid:'used-user'});assert.equal((await remove('competition','used')).status,409);assert(await store.get('entry/e1'));
 await put('competition/ordered',{id:'ordered'});await put('order/o1',{competition:'ordered',uid:'pay-user'});assert.equal((await remove('competition','ordered')).status,409);
 await put('competition/registered',{id:'registered'});await put('registration/registered/reg-user',{paid:false});assert.equal((await remove('competition','registered')).status,409);
 await createAdmin(store,'owner@example.com','1234');const owner=await (await store.get(emailKey('owner@example.com'))).json();assert.equal((await remove('participant',owner.id)).status,403);
 await authenticate(store,{},'/api/auth/register',{email:'artist@example.com',name:'Artist',password:'1234'},'');const login=await authenticate(store,{},'/api/auth/login',{email:'artist@example.com',password:'1234'},'');const cookie=login.cookie.split(';')[0];const user=await identity(store,cookie);
 assert(user);assert.equal((await remove('participant',user.id)).status,200);assert.equal(await identity(store,cookie),null);
 await authenticate(store,{},'/api/auth/register',{email:'artist@example.com',name:'New artist',password:'5678'},'');assert.equal(await identity(store,cookie),null,'Old token must not authenticate recreated account');
 for(const id of ['used-user','pay-user','reg-user']){await put('account/'+id,{id,email:id+'@example.com',role:'participant'});assert.equal((await remove('participant',id)).status,409);}
 assert.equal((await remove('participant','missing')).status,404);
});
