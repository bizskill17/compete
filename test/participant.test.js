import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {FileStore} from '../server/storage.js';
import {createAdmin,emailKey} from '../server/auth.js';
import {createAppServer} from '../server/http.js';
const realFetch=global.fetch;
test('participant journey protects registration, private entries, review, publication, profile and reset tokens',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'compete-participant-')),store=new FileStore(dir);await store.init();await createAdmin(store,'owner@example.com','1234');
 const config={APP_URL:'http://127.0.0.1',RESEND_API_KEY:'test-mail-key',EMAIL_FROM:'Compete <test@example.com>'};const server=await createAppServer(store,{});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{global.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
 async function req(path,body,cookie){const multi=body instanceof FormData,r=await realFetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{Origin:origin,...(multi?{}:{'Content-Type':'application/json'})}:{}),...(cookie?{Cookie:cookie}:{})},body:body?(multi?body:JSON.stringify(body)):undefined});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 for(const path of ['/login','/signup','/dashboard','/my-competitions','/profile','/results','/competition?id=c1','/forgot-password','/reset-password'])assert.equal((await req(path)).status,200);
 const admin=await req('/api/auth/login',{email:'owner@example.com',password:'1234'});
 assert.equal((await req('/api/auth/register',{email:'invalid@example.com',name:'Artist',password:'1234'})).status,400);
 const user=await req('/api/auth/register',{email:'artist@example.com',name:'Artist',mobile:'9876543210',password:'1234'}),other=await req('/api/auth/register',{email:'other@example.com',name:'Other',mobile:'9876543210',password:'5678'});assert.equal(user.status,200);
 assert.equal((await req('/api/participant/overview')).status,401);const c=(await req('/api/admin/competition',{title:'Free drawing',category:'Drawing',description:'Draw',rules:'Original',fee:0,prizes:[100,50,25],deadline:'2099-12-31',status:'open'},admin.cookie)).data;
 const form=()=>{const f=new FormData();f.set('competition',c.id);f.set('name','Artist');f.set('title','My drawing');f.set('original','yes');f.set('image',new Blob([Buffer.from('iVBORw0KGgo=','base64')],{type:'image/png'}),'art.png');return f};
 assert.equal((await req('/api/submit',form(),user.cookie)).status,403);assert.equal((await req('/api/order',{competition:c.id},user.cookie)).data.joined,true);await req('/api/order',{competition:c.id},user.cookie);let mine=(await req('/api/participant/overview',null,user.cookie)).data;assert.equal(mine.competitions.length,1);assert.equal(mine.competitions[0].joined,true);assert.equal(mine.competitions[0].entry,null);
 assert.equal((await req('/api/admin/competition',{...c,fee:199},admin.cookie)).status,409);
 const e=(await req('/api/submit',form(),user.cookie)).data;assert(e.id);assert.equal((await req('/api/participant/art/'+e.id,null,other.cookie)).status,404);assert.equal((await req('/api/participant/art/'+e.id,null,user.cookie)).status,200);
 assert.equal((await req('/certificate/'+e.id,null,user.cookie)).status,409);assert.equal((await req('/api/judge',{id:e.id},user.cookie)).status,403);assert.equal((await req('/api/admin/results',{id:c.id,publish:true},user.cookie)).status,403);
 await store.put('entry/'+e.id,JSON.stringify({...e,status:'judged',score:85,feedback:'Balanced work',rubric:{private:'hidden'}}));
 assert.equal((await req('/api/mine',null,user.cookie)).data[0].score,undefined);assert.equal((await req('/api/leaderboard?id='+c.id)).data.length,0);
 await req('/api/admin/competition',{...c,status:'closed'},admin.cookie);assert.equal((await req('/api/admin/results',{id:c.id,publish:true},admin.cookie)).status,409);
 await req('/api/admin/review',{id:e.id,reviewStatus:'accepted'},admin.cookie);assert.equal((await req('/certificate/'+e.id,null,user.cookie)).status,200);assert.equal((await req('/certificate/'+e.id+'?kind=winner',null,user.cookie)).status,409);
 assert.equal((await req('/api/admin/results',{id:c.id,publish:true},admin.cookie)).status,200);const board=(await req('/api/leaderboard?id='+c.id)).data;assert.equal(board[0].rank,1);assert.equal(board[0].uid,undefined);assert.equal((await req('/certificate/'+e.id+'?kind=winner',null,user.cookie)).status,200);
 assert.equal((await req('/api/admin/review',{id:e.id,reviewStatus:'rejected',reason:'Changed'},admin.cookie)).status,409);
 assert.equal((await req('/api/admin/competition',{...c,status:'open'},admin.cookie)).status,409);
 await req('/api/admin/results',{id:c.id,publish:false},admin.cookie);assert.equal((await req('/api/mine',null,user.cookie)).data[0].score,undefined);assert.equal((await req('/certificate/'+e.id+'?kind=winner',null,user.cookie)).status,409);
 assert.equal((await req('/api/participant/profile',{name:'New artist',mobile:'9123456789',email:'hacked@example.com'},user.cookie)).status,200);assert.equal((await req('/api/participant/overview',null,user.cookie)).data.profile.email,'artist@example.com');
 assert.equal((await req('/api/participant/password',{currentPassword:'wrong',password:'5678'},user.cookie)).status,400);assert.equal((await req('/api/participant/password',{currentPassword:'1234',password:'5678'},user.cookie)).status,200);assert.equal((await req('/api/participant/overview',null,user.cookie)).status,401);
 // Exercise configured reset delivery without sending real email.
 const {authenticate}=await import('../server/auth.js');let resetURL;global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const body=JSON.parse(options.body);assert.deepEqual(body.to,['artist@example.com']);resetURL=body.text.match(/https?:\/\/\S+/)[0];return Response.json({id:'email-test'})};
 const sent=await authenticate(store,config,'/api/auth/forgot',{email:'artist@example.com'},'');assert(sent.body.message);assert(resetURL);assert(!JSON.stringify(sent).includes('token='));
 const token=new URL(resetURL).searchParams.get('token');const invalid=await authenticate(store,config,'/api/auth/reset',{token:'0'.repeat(64),password:'abcd'},'');assert.equal(invalid.status,400);
 assert.equal((await authenticate(store,config,'/api/auth/reset',{token,password:'abcd'},'')).body.ok,true);assert.equal((await authenticate(store,config,'/api/auth/reset',{token,password:'abcd'},'')).status,400);
 assert.equal((await authenticate(store,config,'/api/auth/login',{email:'artist@example.com',password:'abcd'},'')).body.ok,true);
 await store.delete('reset-rate/'+createHash('sha256').update('artist@example.com').digest('hex'));
 await authenticate(store,config,'/api/auth/forgot',{email:'artist@example.com'},'');const secondToken=new URL(resetURL).searchParams.get('token'),resetKey='reset/'+createHash('sha256').update(secondToken).digest('hex');
 const reset=await (await store.get(resetKey)).json();await store.put(resetKey,JSON.stringify({...reset,expires:0}));assert.equal((await authenticate(store,config,'/api/auth/reset',{token:secondToken,password:'1234'},'')).status,400);
 await store.put(resetKey,JSON.stringify({...reset,accountId:'different-account',expires:Date.now()+10000}));assert.equal((await authenticate(store,config,'/api/auth/reset',{token:secondToken,password:'1234'},'')).status,400);

});
