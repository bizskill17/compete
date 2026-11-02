import { validatePassport, savePassport } from './passport.js';
import { emailKey, hashPassword, matches } from './auth.js';
export const read = async (store,key)=>(await store.get(key))?.json();
export const save = (store,key,value)=>store.put(key,JSON.stringify(value));
export async function records(store,prefix){const result=[];let cursor;do{const page=await store.list({prefix,cursor});result.push(...await Promise.all(page.objects.map(async o=>({key:o.key,value:await read(store,o.key)}))));cursor=page.truncated?page.cursor:undefined;}while(cursor);return result.filter(r=>r.value);}
export function publicEntry(entry,competition){
 const result=competition?.resultsPublished?(competition.resultSnapshot||[]).find(r=>r.id===entry.id):null;
 return {id:entry.id,competition:entry.competition,name:entry.name,title:entry.title,created:entry.created,reviewStatus:entry.reviewStatus||'pending',reviewReason:entry.reviewStatus==='rejected'?entry.reviewReason:'',status:result?'published':entry.reviewStatus==='rejected'?'rejected':entry.reviewStatus==='accepted'?'under-review':'pending',certificate:entry.reviewStatus==='accepted'?entry.certificate:null,...(result?{score:result.score,feedback:result.feedback,rank:result.rank,winner:result.rank<=3}: {})};
}
export async function participantRequest(request,env){
 const user=env.identity,store=env.BUCKET,url=new URL(request.url),path=url.pathname;
 const reply=(body,status=200)=>Response.json(body,{status});
 if(!user)return reply({error:'Please log in to continue.'},401);
 if(path==='/api/participant/overview'&&request.method==='GET'){
  const account=await read(store,emailKey(user.email));
  const all=(await records(store,'competition/')).map(r=>r.value);
  const entries=(await records(store,'entry/')).map(r=>r.value).filter(e=>e.uid===user.id);
  const registrations=(await records(store,'registration/')).filter(r=>r.key.endsWith('/'+user.id));
  const ids=new Set([...registrations.map(r=>r.key.split('/')[1]),...entries.map(e=>e.competition)]);
  const competitions=[...ids].map(id=>{const c=all.find(c=>c.id===id);if(!c)return null;const reg=registrations.find(r=>r.key==='registration/'+id+'/'+user.id)?.value,entry=entries.find(e=>e.competition===id);return {competition:{id:c.id,title:c.title,category:c.category,deadline:c.deadline,status:c.status,fee:c.fee,thumbnail:!!c.thumbnail,resultsPublished:!!c.resultsPublished},joined:!!entry||reg?.paid===true||reg?.joined===true,paymentPending:!!reg?.order&&!reg?.paid&&!entry,entry:entry?publicEntry(entry,c):null};}).filter(Boolean);
  return reply({profile:{name:account.name,email:account.email,mobile:account.mobile||'',photo:!!account.photoKey,photoUpdatedAt:account.photoUpdatedAt||''},competitions});
 }
 if(path==='/api/participant/photo'&&request.method==='GET'){
  const account=await read(store,emailKey(user.email)),photo=account?.photoKey?await store.get(account.photoKey):null;
  if(!photo)return reply({error:'Passport photo not found.'},404);
  return new Response(await photo.arrayBuffer(),{headers:{'Content-Type':photo.httpMetadata.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/participant/photo'&&request.method==='POST'){
  let bytes,type,remove=false;
  if(request.headers.get('content-type')?.startsWith('application/json')){const body=await request.json();if(body.remove!==true)return reply({error:'Choose a passport photo.'},400);remove=true;}
  else{const form=await request.formData(),image=form.get('photo');if(!image||typeof image.arrayBuffer!=='function')return reply({error:'Choose a passport photo.'},400);try{type=image.type;bytes=validatePassport(await image.arrayBuffer(),type);}catch(e){return reply({error:e.message},400);}}
  return store.lock(emailKey(user.email),async()=>{const account=await read(store,emailKey(user.email));if(!account||account.id!==user.id||account.disabled)return reply({error:'Please log in again.'},401);
   const updated=remove?{...account,photoKey:null,photoUpdatedAt:null}:await savePassport(store,account,bytes,type);
   await save(store,emailKey(user.email),updated);if(account.photoKey)await store.delete(account.photoKey);return reply({ok:true});});
 }
 if(path.startsWith('/api/participant/art/')&&request.method==='GET'){
  const id=decodeURIComponent(path.slice('/api/participant/art/'.length));const entry=await read(store,'entry/'+id);
  if(!entry||entry.uid!==user.id)return reply({error:'Entry not found.'},404);
  const image=await store.get('art/'+id);if(!image)return reply({error:'Image not found.'},404);
  return new Response(await image.arrayBuffer(),{headers:{'Content-Type':image.httpMetadata.contentType,'Cache-Control':'no-store'}});
 }
 if(path==='/api/participant/profile'&&request.method==='POST'){
  const body=await request.json(),name=String(body.name||'').trim(),mobile=String(body.mobile||'').trim();
  if(!name||name.length>100||!/^\+?[0-9 ()-]{7,20}$/.test(mobile))return reply({error:'Enter your name and a valid mobile number.'},400);
  return store.lock(emailKey(user.email),async()=>{const account=await read(store,emailKey(user.email));if(!account||account.id!==user.id||account.disabled)return reply({error:'Please log in again.'},401);await save(store,emailKey(user.email),{...account,name,mobile});return reply({ok:true});});
 }
 if(path==='/api/participant/password'&&request.method==='POST'){
  const body=await request.json();if(typeof body.password!=='string'||body.password.length<4||body.password.length>20||typeof body.currentPassword!=='string'||body.currentPassword.length>20)return reply({error:'Use a password of 4–20 characters.'},400);
  return store.lock(emailKey(user.email),async()=>{const account=await read(store,emailKey(user.email));if(!account||account.id!==user.id||account.disabled)return reply({error:'Please log in again.'},401);
   const key='password-rate/'+user.id,now=Date.now();let rate=await read(store,key);if(!rate||rate.until<now)rate={count:0,until:now+900000};if(rate.count>=10)return reply({error:'Too many attempts. Retry in 15 minutes.'},429);rate.count++;await save(store,key,rate);
   if(!await matches(body.currentPassword,account.passwordHash))return reply({error:'Current password is incorrect.'},400);
   await save(store,emailKey(user.email),{...account,passwordHash:await hashPassword(body.password),authVersion:(account.authVersion||1)+1});await store.delete(key);return reply({ok:true});});
 }
 return reply({error:'Not found'},404);
}
export async function publishResults(store,body){
 const reply=(v,status=200)=>Response.json(v,{status});
 if(typeof body.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(body.id))return reply({error:'Invalid competition.'},400);
 const c=await read(store,'competition/'+body.id);if(!c)return reply({error:'Competition not found.'},404);
 if(body.publish===false){await save(store,'competition/'+c.id,{...c,resultsPublished:false,resultSnapshot:[]});return reply({ok:true});}
 if(c.resultsPublished)return reply({ok:true});
 if(c.status!=='closed'&&Date.now()<=Date.parse(c.deadline+'T23:59:59+05:30'))return reply({error:'Close the competition or wait until its deadline before publishing results.'},409);
 const entries=(await records(store,'entry/')).map(r=>r.value).filter(e=>e.competition===c.id);
 if(!entries.length||entries.some(e=>!['accepted','rejected'].includes(e.reviewStatus)||(e.reviewStatus==='accepted'&&(!['judged','review'].includes(e.status)||!Number.isFinite(e.score)||e.score<0||e.score>100))))return reply({error:'Review every entry and score all accepted entries before publishing.'},409);
 const accepted=entries.filter(e=>e.reviewStatus==='accepted').sort((a,b)=>b.score-a.score||a.created.localeCompare(b.created)||a.id.localeCompare(b.id));
 const resultSnapshot=accepted.map((e,i)=>({id:e.id,name:e.name,title:e.title,score:e.score,feedback:e.feedback||'',rank:accepted.findIndex(a=>a.score===e.score)+1}));
 await save(store,'competition/'+c.id,{...c,resultsPublished:true,resultSnapshot,resultsPublishedAt:new Date().toISOString()});return reply({ok:true});
}
