import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { generateCompetitionDraft } from '../server/competition-ai.js';
const facts={kind:'text',title:'Code Warriors',category:'Coding',fee:0,prizes:[0,0,0],deadline:'2099-12-31'};
test('competition AI validates input, protects secrets, parses drafts and image options, and handles provider failures',async()=>{
 const config={GEMINI_API_KEY:'private-test-key'};
 await assert.rejects(generateCompetitionDraft({},facts),/GEMINI_API_KEY/);
 await assert.rejects(generateCompetitionDraft(config,{...facts,title:''}),/competition name/);
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert(!url.includes(config.GEMINI_API_KEY));assert.equal(options.headers['x-goog-api-key'],config.GEMINI_API_KEY);const b=JSON.parse(options.body);assert.match(b.systemInstruction.parts[0].text,/ONLY one original/);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({description:'Draft description',rules:'1. Original images only.'})}]}}]});};
 assert.equal((await generateCompetitionDraft(config,facts,fetcher)).description,'Draft description');assert.equal(calls,1);
 for(let variant=0;variant<3;variant++){const image=await generateCompetitionDraft(config,{...facts,kind:'image',variant},async(url,options)=>{assert.match(url,/gemini-nano-banana-2.1/);const b=JSON.parse(options.body);assert.equal(b.generationConfig.imageConfig.aspectRatio,'3:2');return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'iVBORw0KGgo='}}]}}]});});assert.equal(image.type,'image/png');}
 await assert.rejects(generateCompetitionDraft(config,facts,async()=>new Response('secret raw provider details',{status:429})),/quota/);
 await assert.rejects(generateCompetitionDraft(config,facts,async()=>Response.json({candidates:[{content:{parts:[{text:'bad JSON'}]}}]})),/could not complete/);
});
test('competition editor generates selectable images, preserves text typed during AI requests, and sends only selected thumbnail on save',async t=>{
 let resolveText,saved;let calls=0;
 const image={type:'image/png',data:'iVBORw0KGgo='};
 const overview={competitions:[],participants:[],entries:[],payments:[],categories:[{name:'Coding',active:true}],stats:{},ready:{ai:true}};
 const w=new JSDOM(await readFile('public/admin.html','utf8'),{url:'http://localhost/admin',runScripts:'dangerously',beforeParse(w){w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;w.fetch=async(url,opt)=>{let value;if(url==='/api/state')value={admin:true,user:{email:'admin@example.com'}};else if(url==='/api/admin/overview')value=overview;else if(url==='/api/admin/generate'){calls++;const body=JSON.parse(opt.body);value=body.kind==='text'?await new Promise(r=>resolveText=r):image;}else if(url==='/api/admin/competition'){saved=JSON.parse(opt.body);value={ok:true};}else throw Error(url);return {ok:true,json:async()=>value}};}}).window;t.after(()=>w.close());
 await new Promise(r=>setImmediate(r));const d=w.document;d.querySelector('[data-new=competition]').click();const f=d.querySelector('#editorForm');assert.equal(d.querySelector('#generateAll').disabled,true);assert.equal(d.querySelector('#generateImages').disabled,true);assert.equal(d.querySelector('#removeThumbnail').hidden,true);assert.equal(f.elements.description.previousElementSibling.querySelector('button').textContent,'✧ Generate with AI');assert.equal(d.querySelectorAll('.prize-grid input').length,3);assert(!d.querySelector('.prize-grid').textContent.includes(','));f.elements.title.value='Code Warriors';f.elements.category.value='Coding';f.elements.title.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.querySelector('#generateAll').disabled,false);
 d.querySelector('#generateAll').click();f.elements.description.value='My own text';resolveText({description:'AI text',rules:'1. Original work.'});await new Promise(r=>setImmediate(r));
 assert.equal(f.elements.rules.previousElementSibling.querySelector('button').textContent,'✧ Regenerate');assert.equal(d.querySelector('#generateImages').textContent,'Regenerate thumbnails');assert.equal(calls,4);assert.equal(f.elements.description.value,'My own text');assert.equal(f.elements.rules.value,'1. Original work.');assert.equal(d.querySelectorAll('.ai-option img').length,3);
 d.querySelectorAll('.ai-option')[0].click();assert.equal(d.querySelector('#removeThumbnail').hidden,false);d.querySelector('#removeThumbnail').click();assert.equal(d.querySelector('#removeThumbnail').hidden,true);d.querySelectorAll('.ai-option')[1].click();assert.equal(d.querySelectorAll('.ai-option[aria-pressed=true]').length,1);
 await f.onsubmit({preventDefault(){},target:f});assert.deepEqual(saved.thumbnailUpload,image);assert.equal(d.querySelector('#editor').open,false);await new Promise(r=>setImmediate(r));
});
