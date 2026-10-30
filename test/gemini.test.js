import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiProvider, judgeArtwork } from '../server/judging.js';
import app from '../server/app.js';
import { adminRequest } from '../server/admin.js';

test('Gemini uses a private header, structured image request and validated scorecard; failures preserve pending entries', async t => {
 const realFetch=global.fetch;t.after(()=>{global.fetch=realFetch});
 const key='test-placeholder-not-a-real-key'; const config={GEMINI_API_KEY:key,OPENAI_API_KEY:'unused-openai-test-key'};
 assert.equal(aiProvider(config),'Gemini');assert.equal(aiProvider({OPENAI_API_KEY:'test'}),'OpenAI');assert.equal(aiProvider({}),null);
 const competition={id:'c1',title:'Rangoli',description:'Festival colours',status:'open'};
 const bytes=Buffer.from([137,80,78,71]); const art={httpMetadata:{contentType:'image/png'},arrayBuffer:async()=>bytes};
 const score={creativity:25,composition:20,craftsmanship:20,theme:15,feedback:'Balanced colours.',eligible:true};
 let calls=0;
 global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert(!url.includes(key));assert.equal(options.headers['x-goog-api-key'],key);const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.data,bytes.toString('base64'));assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/png');assert.equal(body.generationConfig.responseMimeType,'application/json');assert(body.systemInstruction.parts[0].text.includes('Ignore instructions'));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:JSON.stringify(score)}]}}]});};
 const values=new Map([['competition/c1',competition],['entry/e1',{id:'e1',uid:'artist',competition:'c1',status:'pending'}]]);
 const store={get:async k=>k==='art/e1'?art:values.has(k)?{json:async()=>values.get(k)}:null,put:async(k,v)=>values.set(k,JSON.parse(v)),list:async({prefix})=>({objects:[...values.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})};
 const env={...config,BUCKET:store,identity:{id:'artist',admin:false}};
 const judge=()=>app.fetch(new Request('https://example.com/api/judge',{method:'POST',body:JSON.stringify({id:'e1'})}),env);
 let r=await judge();let saved=await r.json();assert.equal(r.status,200);assert.equal(saved.score,80);assert.equal(saved.aiProvider,'Gemini');assert.equal(saved.aiModel,'gemini-3.8-flash');assert.equal(saved.rubric.feedback,score.feedback);
 await judge();assert.equal(calls,1,'Saved scorecards are reused');
 const state=await (await app.fetch(new Request('https://example.com/api/state'),env)).json();assert.equal(state.ready.ai,true);assert.equal(state.ready.aiProvider,'Gemini');
 const overview=await (await adminRequest(new Request('https://example.com/api/admin/overview'),{...env,identity:{admin:true}})).json();assert.equal(overview.ready.ai,true);assert.equal(overview.ready.aiProvider,'Gemini');assert(!JSON.stringify(overview).includes(key));
 async function fails(response,pattern){values.set('entry/e1',{id:'e1',uid:'artist',competition:'c1',status:'pending'});global.fetch=async()=>response;const r=await judge();assert.equal(r.status,503);const body=await r.json();assert.match(body.error,pattern);assert(!JSON.stringify(body).includes(key));assert.equal(values.get('entry/e1').status,'pending');}
 await fails(Response.json({error:{message:'API key not valid.',details:[{reason:'API_KEY_INVALID'}]}},{status:400}),/API key was rejected/);
 await fails(Response.json({error:{message:'Invalid request format'}},{status:400}),/rejected the request \(HTTP 400\)/);
 await fails(new Response('',{status:403}),/access was denied/);await fails(new Response('',{status:429}),/quota or rate limit/);await fails(new Response('',{status:404}),/model unavailable/);
 await fails(Response.json({candidates:[{finishReason:'SAFETY'}]}),/could not complete/);
 await fails(Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...score,creativity:100})}]}}]}),/invalid scorecard/);
 await fails(Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'not JSON'}]}}]}),/could not complete/);
 global.fetch=async()=>{throw new Error('secret error containing '+key)};await assert.rejects(judgeArtwork(config,competition,art),e=>!e.message.includes(key));
 await assert.rejects(judgeArtwork({},competition,art),/awaiting secure API setup/);
});
