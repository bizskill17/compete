import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {FileStore} from '../server/storage.js';
import {createAdmin,emailKey} from '../server/auth.js';
import {createAppServer} from '../server/http.js';
import {validatePassport,decodePassport} from '../server/passport.js';
import {passportBytes,passportForm,passportJPEG} from './helpers/passport.js';
const settle=()=>new Promise(r=>setImmediate(r));
test('passport validation enforces image type, 2 MB limit, minimum size and portrait ratio',()=>{
 assert.deepEqual(validatePassport(passportBytes,'image/png'),passportBytes);assert.deepEqual(validatePassport(passportJPEG,'image/jpeg'),passportJPEG);
 assert.throws(()=>validatePassport(passportBytes,'image/svg+xml'),/2 MB/);
 assert.throws(()=>validatePassport(Buffer.alloc(2*1024*1024+1),'image/png'),/2 MB/);
 assert.throws(()=>validatePassport(Buffer.from('not an image'),'image/png'),/3:4/);
 const square=Buffer.from(passportBytes);square.writeUInt32BE(200,16);assert.throws(()=>validatePassport(square,'image/png'),/3:4/);
 const small=Buffer.from(passportBytes);small.writeUInt32BE(3,16);small.writeUInt32BE(4,20);assert.throws(()=>validatePassport(small,'image/png'),/150/);
 assert.throws(()=>decodePassport({data:'!!!!',type:'image/png'}),/Invalid/);
 assert.deepEqual(decodePassport({data:passportBytes.toString('base64'),type:'image/png'}).bytes,passportBytes);
});
test('private passport photos survive storage recreation, support signup/replace/remove, and are admin-only for other users',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'compete-passport-')),store=new FileStore(dir);await store.init();await createAdmin(store,'admin@example.com','1234');const server=await createAppServer(store,{});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
 async function req(path,body,cookie){const multi=body instanceof FormData,r=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{Origin:origin,...(multi?{}:{'Content-Type':'application/json'})}:{}),...(cookie?{Cookie:cookie}:{})},body:body?(multi?body:JSON.stringify(body)):undefined});const bytes=Buffer.from(await r.arrayBuffer());let data;try{data=JSON.parse(bytes)}catch{}return {status:r.status,data,bytes,headers:r.headers,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const base={name:'Artist',mobile:'9876543210',password:'1234'};assert.equal((await req('/api/auth/register',{...base,email:'invalid@example.com',photoUpload:{type:'image/png',data:'aGVsbG8='}})).status,400);assert.equal(await store.get(emailKey('invalid@example.com')),null);
 const user=await req('/api/auth/register',{...base,email:'artist@example.com',photoUpload:{type:'image/png',data:passportBytes.toString('base64')}}),other=await req('/api/auth/register',{...base,email:'other@example.com'}),admin=await req('/api/auth/login',{email:'admin@example.com',password:'1234'});assert.equal(user.status,200);
 const key=emailKey('artist@example.com'),account=await(await store.get(key)).json();assert(account.photoKey);const restored=new FileStore(dir);await restored.init();assert(await restored.get(account.photoKey));
 assert.equal((await req('/api/participant/photo')).status,401);assert.equal((await req('/api/participant/photo',null,other.cookie)).status,404);
 const own=await req('/api/participant/photo',null,user.cookie);assert.equal(own.headers.get('content-type'),'image/png');assert.match(own.headers.get('cache-control'),/no-store/);assert.deepEqual(own.bytes,passportBytes);
 assert.equal((await req('/api/admin/participant-photo/'+account.id,null,other.cookie)).status,403);assert.deepEqual((await req('/api/admin/participant-photo/'+account.id,null,admin.cookie)).bytes,passportBytes);
 const publicState=await req('/api/state');assert(!JSON.stringify(publicState.data).includes('photoKey'));const overview=await req('/api/participant/overview',null,user.cookie);assert.equal(overview.data.profile.photo,true);assert(!JSON.stringify(overview.data).includes('passport/'));
 assert.equal((await req('/api/participant/photo',passportForm(),user.cookie)).status,200);const replaced=await(await store.get(key)).json();assert.notEqual(replaced.photoKey,account.photoKey);assert.equal(await store.get(account.photoKey),null);
 const bad=new FormData();bad.set('photo',new Blob(['fake'],{type:'image/png'}),'bad.png');assert.equal((await req('/api/participant/photo',bad,user.cookie)).status,400);assert.equal((await(await store.get(key)).json()).photoKey,replaced.photoKey);
 assert.equal((await req('/api/participant/photo',{remove:true},user.cookie)).status,200);assert.equal(await store.get(replaced.photoKey),null);assert.equal((await req('/api/participant/photo',null,user.cookie)).status,404);
 await req('/api/participant/photo',passportForm(),user.cookie);const last=await(await store.get(key)).json();assert.equal((await req('/api/admin/delete',{kind:'participant',id:account.id},admin.cookie)).status,200);assert.equal(await store.get(last.photoKey),null);
});
test('profile crop controls save a 3:4 portrait, preserve unsaved text, cancel cleanly and remove photos',async t=>{
 const html=await readFile('public/index.html','utf8');let photo=false,uploads=0,removes=0,draws=[];const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});
 const w=new JSDOM(html,{url:'http://localhost/profile',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};w.Image=class{naturalWidth=800;naturalHeight=800;set src(value){Promise.resolve().then(()=>this.onload())}};w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(...args){draws.push(args)}});w.HTMLCanvasElement.prototype.toBlob=function(callback,type){assert.equal(this.width,480);assert.equal(this.height,640);assert.equal(type,'image/jpeg');callback(new w.Blob(['test-cropped-image'],{type}))};w.fetch=async(url,options)=>{let data;if(url==='/api/state')data={user:{name:'Artist',email:'artist@example.com'},competitions:[]};else if(url==='/api/participant/overview')data={profile:{name:'Artist',email:'artist@example.com',mobile:'9876543210',photo,photoUpdatedAt:'v'+uploads},competitions:[]};else if(url==='/api/participant/photo'){if(options.headers['Content-Type']==='application/json'){removes++;photo=false}else{uploads++;assert.equal(options.body.get('photo').type,'image/jpeg');photo=true}data={ok:true}}else throw Error(url);return {ok:true,json:async()=>data}};}}).window;t.after(()=>w.close());await settle();await settle();const d=w.document;assert(d.querySelector('#choosePassport'));assert.equal(d.querySelector('#removePassport').hidden,true);assert.equal(d.querySelector('#readinessProgress').getAttribute('aria-valuenow'),'75');d.querySelector('#profileName').value='Unsaved name';
 async function select(file){const input=d.querySelector('#passportFile');Object.defineProperty(input,'files',{value:[file],configurable:true});await input.onchange({target:input});}
 await select(new w.File([passportBytes],'photo.png',{type:'image/png'}));assert.equal(d.querySelector('#photoDialog').open,true);assert(draws.length);d.querySelector('#photoZoom').value='2';d.querySelector('#photoZoom').dispatchEvent(new w.Event('input'));d.querySelector('#photoX').value='100';d.querySelector('#photoX').dispatchEvent(new w.Event('input'));assert.equal(draws.at(-1)[1],0);await d.querySelector('#applyPhoto').onclick();assert.equal(uploads,1);assert.equal(d.querySelector('#photoDialog').open,false);assert.equal(d.querySelector('#profileName').value,'Unsaved name');assert.equal(d.querySelector('#choosePassport').textContent,'Replace photo');assert.equal(d.querySelector('#readinessProgress').getAttribute('aria-valuenow'),'100');assert.equal(d.querySelector('#removePassport').hidden,false);
 await select(new w.File([passportBytes],'photo.png',{type:'image/png'}));d.querySelector('#cancelCrop').click();assert.equal(uploads,1);assert.equal(d.querySelector('#photoDialog').open,false);
 await d.querySelector('#removePassport').onclick({target:d.querySelector('#removePassport')});assert.equal(removes,1);assert.equal(d.querySelector('#readinessProgress').getAttribute('aria-valuenow'),'75');assert.equal(d.querySelector('#removePassport').hidden,true);assert.match(d.querySelector('#passportPreview').textContent,/No photo/);assert.equal(errors.length,0,errors.join('\n'));
});
