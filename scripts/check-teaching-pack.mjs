import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';
import { memoryLessons, memoryLessonTemplates } from '../server/lessonFixtures.js';

// Isolated preparation and live-teaching checks. The real owner-scoped repository
// and routes use memory adapters, never MongoDB, Azure, Google or a user's service.
let dev=false,browserName='chrome',output;
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--dev')dev=true;
  else if(arg==='--browser')browserName=process.argv[++i];
  else if(arg==='--output')output=process.argv[++i];
  else if(arg==='--help'){console.log('Usage: node scripts/check-teaching-pack.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');process.exit(0);}
  else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome','chromium','webkit'].includes(browserName));
const root=fileURLToPath(new URL('../',import.meta.url));
assert(dev||existsSync(join(root,'dist/index.html')),'Build first, or pass --dev.');
const out=output?resolve(output):mkdtempSync(join(tmpdir(),'mpt-teaching-pack-'));
mkdirSync(out,{recursive:true});
const report={browser:browserName,frontend:dev?'isolated Vite':'production build',fixtureServices:true,realWebSockets:true,
  actualUserSession:false,cloudServices:false,cases:[],pageErrors:[],
  limitations:['Authenticated cookies belong to synthetic fixture accounts; no OAuth, billing or real customer data.',
    'Actual repository logic runs against memory adapters; this does not validate live Azure permissions, network availability or durability.',
    'Chrome phone uses trusted touch; WebKit phone-sized interaction uses mouse input. No real camera or microphone.']};
const hash=value=>createHash('sha256').update(value).digest('hex');
function fingerprint(){const html=readFileSync(join(root,'dist/index.html'));return{indexSha256:hash(html),scripts:[...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>({url:m[1],sha256:hash(readFileSync(join(root,'dist',m[1].replace(/^\//,''))))}))};}
if(!dev)report.build=fingerprint();
const legacy=JSON.parse(readFileSync(join(root,'content/lessons/short-a-first-practice/lesson.json')));
const legacyBytes=readFileSync(join(root,'content/lessons/short-a-first-practice',legacy.asset.file));
const packRoot=join(root,'content/lessons/short-a-teaching-pack');
const template=JSON.parse(readFileSync(join(packRoot,'lesson.json')));
const assetBytes=new Map(template.assets.map(asset=>[asset.id,readFileSync(join(packRoot,asset.file))]));
const expectedFonts={'sound-cue':440,'word-work':150,reading:128,meaning:200};
const assets=new Map(template.assets.map(asset=>{
  const svg=readFileSync(join(packRoot,asset.source),'utf8');
  const match=svg.match(/data-min-target-font-size="([\d.]+)"/);assert(match,`${asset.id} needs explicit target-font metadata`);
  const font=Number(match[1]);assert(font>=expectedFonts[asset.id],`${asset.id} target text must match the reviewed scale`);
  return[asset.id,{...asset,font,svg}];
}));
assert.deepEqual(template.activities.map(activity=>activity.type),['review','read','read','build','dictation','read','read']);
assert.equal(new Set([...assetBytes.values()].map(hash)).size,4,'All four teaching sheets must have distinct bytes');
for(const activity of template.activities)assert(/^[a-z ]*$/.test(activity.letters),'Board tiles remain ordinary ASCII spellings');
assert(!template.readingLines.join(' ').includes('Sam'),'This pack passage uses Pat only');
report.template={id:template.id,previousId:legacy.id,assets:[...assets.values()].map(({id,w,h,font})=>({id,w,h,minTargetSourceFontPx:font}))};
report.limitations.push('Reviewed source typography is checked from SVG metadata. The live lesson exercises native text and selected image parts; it does not measure clinical readability. Enabling sound boxes retains the established horizontal centering at phone Fill scale.');
const templateFixture=memoryLessonTemplates(),templates=templateFixture.templates;
await templates.publish(legacy,legacyBytes);
const owners=new Set(),legacyCopies=new Map(),customCopies=new Map();
const fixture=memoryLessons({templates,ownerExists:async owner=>owners.has(owner)});
const originalTemplate=JSON.parse(JSON.stringify(await templates.get(legacy.id)));
for(const size of ['desktop','phone']){
  for(const kind of ['a','b','custom'])owners.add(`fixture-owner-${size}-${kind}`);
  const owner=`fixture-owner-${size}-a`,copy=await fixtureLessonSeed(owner,false,size);
  legacyCopies.set(size,copy);
  customCopies.set(size,await fixtureLessonSeed(`fixture-owner-${size}-custom`,true,size));
}
async function fixtureLessonSeed(owner,custom,size){
  const copy=await fixture.lessons.createFromTemplate(owner,await templates.get(legacy.id));
  await fixture.lessons.save(owner,copy.id,{...copy,...(custom?{title:'Earlier customized short-a lesson'}:{}),activities:copy.activities.map((activity,index)=>({...activity,
    reviewNextTime:index%2===0,reviewNote:`PRIVATE_V1_${size.toUpperCase()}_${custom?'CUSTOM':'PRISTINE'}_${index}`}))});
  return fixture.lessons.get(owner,copy.id);
}
await templates.publish(template,assetBytes);
const accounts={clientId:null,tutorFor:async token=>{
  const match=String(token).match(/^fixture-cookie-(desktop|phone)-(a|b|custom)$/),id=match?`fixture-owner-${match[1]}-${match[2]}`:null;
  return id?{id,name:id,email:`${id}@example.test`,roles:['owner'],picture:'',subscription:null}:null;
}};
let server,realtime,browser,vite,devTransport;
const connections=new Set(),origins=new Set(),pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(test,message,timeout=15_000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await pause(25);}assert.fail(message);}
async function start(){
  const pictures=Object.fromEntries(['beginWrite','add','get','isTutor'].map(method=>[method,(...args)=>realtime.pictures[method](...args)]));
  const app=createApp({accounts,templates,lessons:fixture.lessons,pictures,library:{list:async()=>[],image:async()=>null}});
  if(dev){
    const {createServer}=await import('vite'),{default:config}=await import('../vite.config.js');
    devTransport=http.createServer();await new Promise((done,fail)=>{devTransport.once('error',fail);devTransport.listen(0,'127.0.0.1',done);});
    vite=await createServer({...config,root,configFile:false,cacheDir:join(out,'vite-cache'),server:{...config.server,middlewareMode:true,hmr:false,
      ws:{server:devTransport,host:'127.0.0.1',clientPort:devTransport.address().port},proxy:undefined},appType:'spa'});
  }
  server=http.createServer(dev?(req,res)=>{
    if(/^\/(?:api|auth)(?:\/|$)|^\/healthz(?:\?|$)/.test(req.url||''))app(req,res);
    else vite.middlewares(req,res,()=>{res.statusCode=404;res.end('Not found');});
  }:app);
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  realtime=attachRealtime(server,{allowedOrigins:origins,maxRoomsPerIp:100,canStartLesson:async()=>({ok:true})});
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const base=`http://127.0.0.1:${server.address().port}`;origins.add(base);
  browser=await(browserName==='webkit'?webkit:chromium).launch(browserName==='chrome'?{channel:'chrome'}:{});
  return base;
}
async function instrument(page){
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.addInitScript(()=>{
    window.lessonSent=[];window.lessonReceived=[];window.lessonSockets=[];
    const Native=window.WebSocket;window.WebSocket=class extends Native{
      constructor(...args){super(...args);if(String(args[0]).endsWith('/ws'))window.lessonSockets.push(this);this.addEventListener('message',event=>{try{window.lessonReceived.push(JSON.parse(event.data));}catch{}});}
      send(data){try{window.lessonSent.push(JSON.parse(data));}catch{}super.send(data);}
    };
  });
}
async function check(room,name,action){
  const item={viewport:room.mobile?'phone':'desktop',name};report.cases.push(item);
  try{Object.assign(item,await action());item.passed=true;return true;}
  catch(error){item.passed=false;item.error=error.stack;await room.tutor.locator('body').innerText().then(value=>writeFileSync(join(out,`failure-${report.cases.length}.txt`),value)).catch(()=>{});await room.tutor.screenshot({path:join(out,`failure-${report.cases.length}.png`)}).catch(()=>{});return false;}
  finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({viewport:item.viewport,name,passed:item.passed}));}
}
async function request(context,base,path,method='GET',data){
  const response=await context.request.fetch(`${base}/api/lessons${path}`,{method,...(data===undefined?{}:{data})});
  return{status:response.status(),headers:response.headers(),data:response.status()===204?null:await response.json().catch(()=>null)};
}
async function documentFor(room){const result=await request(room.context,room.base,`/${room.id}`);assert.equal(result.status,200);return result.data.lesson;}
async function activate(room,locator){if(room.mobile&&browserName!=='webkit')await locator.tap();else await locator.click();}
async function activityList(room){
  const toggle=room.tutor.getByRole('button',{name:/^Activities \(\d+\)$/});
  if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='false')await activate(room,toggle);
}
const prep=page=>page.getByRole('region',{name:'Activity editor',exact:true});
const panel=page=>page.getByRole('region',{name:'Prepared lesson',exact:true});
async function openLesson(room){
  if(!await panel(room.tutor).isVisible())await activate(room,room.tutor.getByRole('button',{name:'Tutor guide',exact:true}));
  await panel(room.tutor).waitFor({state:'visible'});
  await room.tutor.waitForFunction(()=>{const node=document.querySelector('[data-tutor-guide]');if(!node)return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.visibility==='visible'&&Number(style.opacity)===1&&rect.left>=0&&rect.right<=innerWidth+1;});
}

async function closeGuide(room){
  const guide=room.tutor.locator('[data-tutor-guide]');
  if(await guide.getAttribute('data-state')==='open')await activate(room,guide.getByRole('button',{name:'Close tutor guide',exact:true}));
  await room.tutor.waitForFunction(()=>document.querySelector('[data-tutor-guide]')?.getAttribute('data-state')==='closed');
  await guide.waitFor({state:'hidden'});
}
async function bothCount(room,selector,count){for(const page of[room.tutor,room.student])await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector,count});}
async function privacy(room){
  await Promise.allSettled([...room.responseChecks]);
  const wire=await room.student.evaluate(()=>JSON.stringify({received:window.lessonReceived,sent:window.lessonSent,storage:{...sessionStorage},text:document.body.textContent}));
  const leaked=room.markers.filter(value=>wire.includes(value));
  assert.deepEqual(leaked,[],'Private lesson content must not enter student messages, storage or DOM');
  assert.deepEqual(room.networkLeaks,[],'Private lesson content must not enter student HTTP responses or URLs');
  return{socketMessages:await room.student.evaluate(()=>window.lessonReceived.length),httpResponsesChecked:room.httpResponses,secretMarkersChecked:room.markers.length,leaks:0};
}
async function confirmActivity(room,index){
  const mounted=room.tutor.locator('section[aria-label="Prepared lesson"]');
  await mounted.getByRole('button',{name:'Activity page is open',exact:true,includeHidden:true}).waitFor({state:'attached'});
  assert.equal(await mounted.locator('select[aria-label="Lesson activity"]').inputValue(),String(index));
  const live=realtime.rooms.get(room.code),scope={pageId:live.pageId,pageEpoch:live.pageEpoch};
  for(const page of[room.tutor,room.student])await page.waitForFunction(scope=>{
    const board=window.lessonReceived.filter(message=>message.t==='board').at(-1);return board?.pageId===scope.pageId&&board?.pageEpoch===scope.pageEpoch;
  },scope);
  return live;
}
async function choose(room,index){
  await openLesson(room);await panel(room.tutor).getByRole('combobox',{name:'Lesson activity',exact:true}).selectOption(String(index));
  return confirmActivity(room,index);
}
async function sheet(room,index){
  const activity=template.activities[index],asset=assets.get(activity.assetIds[0]);assert(asset);
  const live=await choose(room,index);
  await bothCount(room,'[data-letter-tile]',0);await bothCount(room,'[data-picture-piece]',0);assert.equal(live.board.boxes,0);
  assert(!live.pictures.size||![...live.board.pieces.values()].length,'Activity navigation never deploys the source sheet');
  assert(!room.pages.has(live.pageId),'Each new sheet must have its own board page');room.pages.add(live.pageId);
  await openLesson(room);await activate(room,panel(room.tutor).getByRole('button',{name:/^Choose parts from /}).first());
  const selections={
    'sound-cue':[['Short a','letter'],['Apple picture','image'],['Mouth photo','image'],['Open jaw.','text']],
    'word-work':[['a','letter'],['Breve','breve'],['măt (model)','text'],['3 sound boxes','boxes']],
    reading:[['Pat sat.','text',0],['Tap, Pat, tap!','text'],['Pat sat.','text',1],['Tap, tap, tap!','text']],
    meaning:[['Mat picture','image'],['mat','text'],['Map picture','image'],['map','text']],
  }[asset.id];
  const baseline=await boardGeometry(room.tutor),studentBefore=await boardGeometry(room.student);
  let pieceCount=0,tileCount=0;
  for(const[label,kind,n=0]of selections){
    await activate(room,room.tutor.getByRole('group',{name:'Ready teaching pieces',exact:true}).getByRole('button',{name:label,exact:true}).nth(n));
    await activate(room,room.tutor.getByRole('button',{name:'Add selected part to board',exact:true}));
    if(kind==='letter')await bothCount(room,'[data-letter-tile]',++tileCount);
    else if(kind==='boxes'){await until(()=>live.board.boxes===3,'Sound boxes should be shared');}
    else await bothCount(room,'[data-picture-piece]',++pieceCount);
    if(kind==='boxes'){
      // Phone Fill intentionally centers newly enabled sound boxes horizontally.
      // The explicit box action preserves scale and vertical position.
      for(const[page,prior]of[[room.tutor,baseline],[room.student,studentBefore]]){
        const current=await boardGeometry(page);assert.deepEqual(current.rect,prior.rect);assert.equal(current.zoom,prior.zoom);
        assert.deepEqual(current.viewBoxes.map(value=>value.split(' ').slice(1)),prior.viewBoxes.map(value=>value.split(' ').slice(1)));
      }
    }else{
      assert.deepEqual(await boardGeometry(room.tutor),baseline,'Adding a teaching piece must not move or zoom the tutor board');
      assert.deepEqual(await boardGeometry(room.student),studentBefore,'Adding a teaching piece must not move or zoom the student board');
    }
  }
  const pieces=[...live.board.pieces.values()],picture=live.pictures.get(pieces[0].pic);
  assert.equal(hash(picture.bytes),hash(assetBytes.get(asset.id)),'Selected pieces retain the reviewed source bytes');
  assert.equal(picture.title,'Lesson material');
  assert.deepEqual(pieces.map(piece=>piece.content?.kind||'image').sort(),selections.map(([,kind])=>kind).filter(kind=>!['letter','boxes'].includes(kind)).sort());
  for(const piece of pieces)if(piece.content)for(const page of[room.tutor,room.student])assert.equal(await page.locator(`[data-picture-piece="${piece.id}"] image`).count(),0,'Native teaching text and marks have no photograph background');
  room.sheetPages.set(asset.id,{pageId:live.pageId,pieceIds:pieces.map(piece=>piece.id),pic:picture.id});
  await activate(room,room.tutor.getByRole('button',{name:'Back to tutor guide',exact:true}));await closeGuide(room);
  for(const[label,page]of[['tutor',room.tutor],['student',room.student]])await page.screenshot({path:join(out,`${asset.id}-${room.mobile?'phone':'desktop'}-${label}.png`)});
  return{asset:asset.id,pageId:live.pageId,pieces:pieceCount,tiles:tileCount,sourceSheetDeployed:false,pieceCameraUnchanged:true,explicitBoxesMayCenterOnPhone:selections.some(([,kind])=>kind==='boxes'),...await privacy(room)};
}
async function boardGeometry(page){
  return page.locator('[data-board-surface]').evaluate(node=>{const rect=node.getBoundingClientRect();return{rect:Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(rect[key]*100)/100])),viewBoxes:[...node.querySelectorAll(':scope > svg[viewBox]')].map(svg=>svg.getAttribute('viewBox')),zoom:document.querySelector('[data-board-zoom]')?.textContent};});
}
async function run(base,mobile){
  const options={viewport:mobile?{width:393,height:852}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile};
  const size=mobile?'phone':'desktop';
  const context=await browser.newContext(options),other=await browser.newContext(options),custom=await browser.newContext(options),studentContext=await browser.newContext(options);
  for(const ctx of[context,other,custom,studentContext])ctx.setDefaultTimeout(12_000);
  await context.addCookies([{name:'mpt_session',value:`fixture-cookie-${size}-a`,url:base,httpOnly:true,sameSite:'Lax'}]);
  await other.addCookies([{name:'mpt_session',value:`fixture-cookie-${size}-b`,url:base,httpOnly:true,sameSite:'Lax'}]);
  await custom.addCookies([{name:'mpt_session',value:`fixture-cookie-${size}-custom`,url:base,httpOnly:true,sameSite:'Lax'}]);
  const priorCopy=legacyCopies.get(size),preservedCustom=customCopies.get(size);
  const tutor=await context.newPage(),secondTutor=await other.newPage(),student=await studentContext.newPage();await instrument(tutor);await instrument(student);
  const marker=`PRIVATE_PACK_${mobile?'PHONE':'DESKTOP'}`;
  const room={context,other,studentContext,tutor,student,mobile,base,pages:new Set(),sheetPages:new Map(),markers:[...template.activities.map((_,index)=>`${marker}_${index}`),...priorCopy.activities.map(activity=>activity.reviewNote),...preservedCustom.activities.map(activity=>activity.reviewNote),`${marker}_LESSON_TITLE`,`${marker}_ACTIVITY_TITLE`,`${marker}_DICTATION_TARGET`],responseChecks:new Set(),networkLeaks:[],httpResponses:0};
  student.on('request',request=>{for(const marker of room.markers)if(request.url().includes(marker))room.networkLeaks.push({where:'request-url',marker});});
  student.on('response',response=>{
    const task=(async()=>{if(!/json|javascript|text\//i.test(response.headers()['content-type']||''))return;const body=await response.text().catch(()=>'');room.httpResponses++;for(const marker of room.markers)if(body.includes(marker))room.networkLeaks.push({where:response.url(),marker});})();
    room.responseChecks.add(task);task.finally(()=>room.responseChecks.delete(task));
  });
  try{
    if(!await check(room,'The gallery shows only v2 while v1 sources and customized private content remain intact',async()=>{
      const response=await studentContext.request.get(`${base}/api/lesson-templates`);assert.equal(response.status(),200);assert.deepEqual((await response.json()).templates.map(item=>item.id),[template.id]);
      assert.equal((await studentContext.request.get(`${base}/api/lesson-templates/${template.id}`)).status(),401);
      const old=await context.request.get(`${base}/api/lesson-templates/${legacy.id}`);assert.equal(old.status(),200);assert.deepEqual((await old.json()).template,originalTemplate);
      const image=await studentContext.request.get(`${base}/api/lesson-templates/${legacy.id}/assets/${legacy.asset.id}/image`);assert.equal(image.status(),200);assert.equal(hash(await image.body()),hash(legacyBytes));
      const reused=await request(custom,base,`/from-template/${template.id}`,'POST');assert.equal(reused.status,201);assert.deepEqual(reused.data.lesson,preservedCustom);
      assert.equal((await request(custom,base,'')).data.lessons.length,1,'A customized earlier copy must not acquire a duplicate lesson');
      return{latestVisibleOnly:true,previousVersionRetained:true,customizedEarlierCopyPreserved:true};
    }))return;
    if(!await check(room,'Use opens the classroom and upgrades only the pristine v1 copy in place while preserving all four notes',async()=>{
      const response=await context.request.get(`${base}/api/lesson-templates/${template.id}`);room.originalPack=(await response.json()).template;
      for(const[page,owner]of[[tutor,'first'],[secondTutor,'second']]){
        await page.goto(`${base}/lessons`);const included=page.getByRole('region',{name:'Included lessons',exact:true});
        await included.getByRole('heading',{name:template.title,exact:true}).waitFor();assert.equal(await included.getByRole('button',{name:'Use this lesson',exact:true}).count(),1);
        if(owner==='first')await page.screenshot({path:join(out,`included-pack-${size}.png`)});
        const requested=page.waitForResponse(reply=>reply.request().method()==='POST'&&reply.url().endsWith(`/api/lessons/from-template/${template.id}`));
        const use=included.getByRole('button',{name:'Use this lesson',exact:true});if(mobile&&browserName!=='webkit')await use.tap();else await use.click();assert.equal((await requested).status(),201);
        await page.waitForURL(/\/whiteboard\/teach\?lesson=/);
        const id=new URL(page.url()).searchParams.get('lesson');if(owner==='first')room.id=id;else room.otherId=id;
      }
      assert.equal(room.id,priorCopy.id,'A pristine prior copy upgrades without a second private lesson');assert.notEqual(room.id,room.otherId);
      const current=await documentFor(room);assert.equal(current.activities.length,7);assert.equal(current.assets.length,4);
      for(const prior of priorCopy.activities){const updated=current.activities.find(activity=>activity.id===prior.id);assert(updated,`Stable prior activity ${prior.id} survives`);assert.equal(updated.reviewNote,prior.reviewNote);assert.equal(updated.reviewNextTime,prior.reviewNextTime);}
      assert.equal((await request(context,base,'')).data.lessons.length,1);
      const activities=current.activities.map((activity,index)=>({...activity,title:index===4?`${activity.title} ${marker}_ACTIVITY_TITLE`:activity.title,
        directions:`${activity.directions}\n${room.markers[index]}`,targets:index===4?`${activity.targets}\n${marker}_DICTATION_TARGET`:activity.targets}));
      const edited={...current,title:`${current.title} ${marker}_LESSON_TITLE`,activities};
      assert.equal((await request(context,base,`/${room.id}`,'PUT',edited)).status,200);room.privateDictationTargets=activities[4].targets;
      await tutor.goto(`${base}/lessons`);await activate(room,tutor.getByRole('region',{name:'Included lessons',exact:true}).getByRole('button',{name:'Use this lesson',exact:true}));
      await tutor.waitForURL(`**/whiteboard/teach?lesson=${room.id}`);assert.equal((await documentFor(room)).activities[0].directions,activities[0].directions);
      assert(!JSON.stringify((await request(other,base,`/${room.otherId}`)).data.lesson).includes('PRIVATE_PACK_'));
      assert.equal((await request(other,base,`/${room.id}`)).status,404);
      assert.deepEqual((await (await context.request.get(`${base}/api/lesson-templates/${template.id}`)).json()).template,room.originalPack);
      assert.deepEqual((await request(custom,base,`/${preservedCustom.id}`)).data.lesson,preservedCustom);
      assert.equal(templateFixture.assets.records.size,5);assert.equal(fixture.assets.records.size,0);
      return{samePrivateCopy:true,preservedReviewNotes:4,separateOwnerCopies:true,usingAgainPreservesEdits:true,globalPngSources:5,duplicatedPrivateSources:0};
    }))return;
    if(!await check(room,'The first Review starts automatically exactly once and reconnect preserves the working board',async()=>{
      await tutor.waitForFunction(()=>window.lessonReceived.some(message=>message.t==='room'));room.code=await tutor.evaluate(()=>window.lessonReceived.find(message=>message.t==='room').code);
      await student.goto(`${base}/whiteboard/${room.code}`);await tutor.waitForFunction(()=>window.lessonReceived.some(message=>message.t==='presence'&&message.student));
      await closeGuide(room);
      for(const page of[tutor,student])for(const button of await page.getByRole('button',{name:'Close this message',exact:true}).all())if(await button.isVisible())await button.click();
      let live=await confirmActivity(room,0);await bothCount(room,'[data-letter-tile]',5);await bothCount(room,'[data-picture-piece]',0);
      assert.deepEqual([...live.board.tiles.values()].map(tile=>tile.text),['a','m','s','t','p']);assert.equal(live.board.boxes,0);assert.equal(live.pages.size,1);
      await closeGuide(room);
      if(mobile){const close=tutor.getByRole('button',{name:'Close Materials',exact:true});if(await close.isVisible())await activate(room,close);}
      const tile=await tutor.locator('[data-letter-tile]').first().boundingBox(),board=await tutor.locator('[data-board-surface]').boundingBox();assert(tile&&board);
      const before=live.board.tiles.get(await tutor.locator('[data-letter-tile]').first().getAttribute('data-letter-tile')),oldPoint={x:before.x,y:before.y};
      await tutor.mouse.move(tile.x+tile.width/2,tile.y+tile.height/2);await tutor.mouse.down();await tutor.mouse.move(board.x+board.width*0.28,board.y+board.height*0.58,{steps:12});await tutor.mouse.up();
      await until(()=>{const moved=live.board.tiles.get(before.id);return !moved.heldBy&&(Math.abs(moved.x-oldPoint.x)>5||Math.abs(moved.y-oldPoint.y)>5);},'A real board tile move must be accepted before reconnect');
      const expected=[...live.board.tiles.values()].map(tile=>({...tile})),pageId=live.pageId,count=await tutor.evaluate(()=>window.lessonReceived.length);
      await tutor.evaluate(()=>window.lessonSockets.findLast(socket=>socket.readyState===WebSocket.OPEN)?.close(1000,'fixture reconnect'));
      await tutor.waitForFunction(index=>window.lessonReceived.slice(index).some(message=>message.t==='board'&&message.reason==='sync'),count);
      await bothCount(room,'[data-letter-tile]',5);live=await confirmActivity(room,0);assert.equal(live.pageId,pageId);assert.equal(live.pages.size,1);assert.deepEqual([...live.board.tiles.values()],expected);
      await tutor.reload();await tutor.waitForFunction(()=>window.lessonReceived.some(message=>message.t==='board'&&message.reason==='sync'));await bothCount(room,'[data-letter-tile]',5);
      live=await confirmActivity(room,0);assert.equal(live.pageId,pageId);assert.equal(live.pages.size,1);assert.deepEqual([...live.board.tiles.values()],expected);
      await closeGuide(room);room.pages.add(live.pageId);return{automaticStart:true,tilesExactlyOnce:5,reconnectPreservesMove:true,refreshPreservesMove:true,...await privacy(room)};
    }))return;
    await check(room,'Tutor guide docks with collapsible tools on desktop, overlays phone, and preserves private drafts',async()=>{
      await closeGuide(room);
      if(!mobile){await activate(room,tutor.getByRole('button',{name:'Zoom in',exact:true}));await activate(room,tutor.getByRole('button',{name:'Zoom in',exact:true}));}
      const baseline=await boardGeometry(tutor),studentBefore=await boardGeometry(student);
      const desktopTools=tutor.locator('[data-desktop-tools]'),priorTools=mobile?null:await desktopTools.getAttribute('data-state');
      await openLesson(room);
      const guide=tutor.getByRole('complementary',{name:'Tutor guide',exact:true});
      assert.equal(await tutor.locator('section[aria-label="Prepared lesson"]').count(),1,'Only one private note panel may exist');
      assert.equal(await student.locator('[data-tutor-guide]').count(),0,'The private guide is absent from the student app');
      const docked=await guide.getAttribute('data-docked')==='true';assert.equal(docked,!mobile);
      if(docked){
        const fitted=await boardGeometry(tutor);assert(fitted.rect.width<baseline.rect.width,'The docked guide reserves its own readable column');
        assert.equal(await desktopTools.getAttribute('data-state'),'closed','Opening the desktop guide collapses the drawing rail');
        await activate(room,tutor.getByRole('button',{name:'Show tools',exact:true}));assert.equal(await desktopTools.getAttribute('data-state'),'open');
        if(priorTools==='open')await activate(room,tutor.getByRole('button',{name:'Hide tools',exact:true}));
      }else assert.deepEqual(await boardGeometry(tutor),baseline,'The phone overlay does not resize, pan or zoom the board');
      assert.deepEqual(await boardGeometry(student),studentBefore,'Opening the private guide must not change the student view');
      const geometry=await guide.evaluate(node=>{
        const rect=node.getBoundingClientRect();const hit=element=>{const r=element.getBoundingClientRect();return{label:element.getAttribute('aria-label')||element.textContent,rect:r.toJSON(),hit:element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};};
        return{rect:rect.toJSON(),viewport:{width:innerWidth,height:innerHeight},scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,
          actions:[...node.querySelectorAll('button[aria-label="Close tutor guide"],button[aria-label="Previous activity"],button[aria-label="Next activity"]')].map(hit),
          directionFonts:[...node.querySelectorAll('p.whitespace-pre-wrap')].filter(element=>element.getBoundingClientRect().height>0).map(element=>Number.parseFloat(getComputedStyle(element).fontSize))};
      });
      assert(geometry.rect.x>=0&&geometry.rect.y>=0&&geometry.rect.right<=geometry.viewport.width&&geometry.rect.bottom<=geometry.viewport.height);
      assert(geometry.rect.width>=(mobile?geometry.viewport.width-20:520),'Guide should provide a readable column');
      assert(geometry.scrollWidth<=geometry.clientWidth,'Guide should not scroll horizontally');
      assert(geometry.actions.length===3&&geometry.actions.every(action=>action.hit&&action.rect.height>=44),'Close and activity navigation remain reachable');
      assert(geometry.directionFonts.length&&geometry.directionFonts.every(size=>size>=16),'Directions use a readable text size');
      await activate(room,panel(tutor).getByRole('button',{name:/^Review next time/}));
      const note=panel(tutor).getByRole('textbox',{name:'Private review note',exact:true}),savedNote=await note.inputValue(),draft=`${savedNote}\nPRIVATE_GUIDE_DRAFT_${size}`;room.markers.push(`PRIVATE_GUIDE_DRAFT_${size}`);
      await note.fill(draft);await closeGuide(room);
      assert.deepEqual(await boardGeometry(tutor),baseline,'Closing restores the previous desktop workspace and view, or preserves the phone view');
      if(docked)assert.equal(await desktopTools.getAttribute('data-state'),priorTools,'Closing restores the tutor’s previous tools choice');
      assert.equal(await tutor.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Tutor guide','Close restores focus to the persistent header entry');
      await openLesson(room);assert.equal(await note.inputValue(),draft,'Closing must retain an unsaved private note');
      await tutor.keyboard.press('Escape');await tutor.waitForFunction(()=>document.querySelector('[data-tutor-guide]')?.getAttribute('data-state')==='closed');
      assert.equal(await tutor.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Tutor guide','Escape restores focus');
      await openLesson(room);assert.equal(await note.inputValue(),draft);await note.fill(savedNote);
      if(!mobile){
        const live=realtime.rooms.get(room.code),before=[...live.board.tiles.values()][0],tile=tutor.locator(`[data-letter-tile="${before.id}"]`),target=await tile.boundingBox();assert(target&&target.x+target.width/2<geometry.rect.x,'An exposed board tile remains outside the nonmodal guide');
        const prior={x:before.x,y:before.y};
        await tutor.mouse.move(target.x+target.width/2,target.y+target.height/2);await tutor.mouse.down();await tutor.mouse.move(target.x+target.width/2+24,target.y+target.height/2+12,{steps:6});await tutor.mouse.up();
        await until(()=>{const moved=live.board.tiles.get(before.id);return !moved.heldBy&&(Math.abs(moved.x-prior.x)>2||Math.abs(moved.y-prior.y)>2);},'The exposed board remains interactive while the guide is open');
      }
      await tutor.screenshot({path:join(out,`tutor-guide-${size}.png`)});await closeGuide(room);
      assert.deepEqual(await boardGeometry(tutor),baseline);assert.deepEqual(await boardGeometry(student),studentBefore);
      return{geometry,docked,phoneBoardSizeAndZoomUnchanged:mobile,desktopWorkspaceRestored:!mobile,toolsCanReopen:!mobile,notesPreserved:true,escapeRestoresFocus:true,exposedBoardInteractive:!mobile,...await privacy(room)};
    });
    if(!mobile)await check(room,'A newer manual zoom while the desktop guide is open survives closing it',async()=>{
      await closeGuide(room);const studentBefore=await boardGeometry(student);await openLesson(room);
      // Pick a scale above the closed board's minimum Fit; a smaller scale is
      // intentionally clamped when the wider board returns.
      await activate(room,tutor.getByRole('button',{name:'Zoom in',exact:true}));await activate(room,tutor.getByRole('button',{name:'Zoom in',exact:true}));const manual=(await boardGeometry(tutor)).zoom;
      await closeGuide(room);assert.equal((await boardGeometry(tutor)).zoom,manual,'Closing must not overwrite the tutor’s newer zoom choice');
      assert.deepEqual(await boardGeometry(student),studentBefore,'Private guide zoom changes do not refocus the student');
      return{manualZoomPreserved:manual,studentViewUnchanged:true,...await privacy(room)};
    });
    await check(room,'The loaded lesson header and guide entry fit the full viewport width sweep',async()=>{
      await closeGuide(room);const previous=tutor.viewportSize(),sweep=[];
      try{
        for(const width of[320,360,393,640,768,820,1024,1280]){
          await tutor.setViewportSize({width,height:852});await tutor.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const sample=await tutor.locator('[data-whiteboard-topbar]').evaluate(node=>{
            const shown=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
            return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,header:node.getBoundingClientRect().toJSON(),buttons:[...node.querySelectorAll('button')].filter(shown).map(button=>{const r=button.getBoundingClientRect();return{label:button.getAttribute('aria-label')||button.textContent.trim(),rect:r.toJSON(),hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};
          });
          sweep.push(sample);await tutor.screenshot({path:join(out,`header-${size}-${width}.png`)});
        }
      }finally{await tutor.setViewportSize(previous);}
      writeFileSync(join(out,`header-sweep-${size}.json`),JSON.stringify(sweep,null,2));
      const failures=sweep.filter(sample=>sample.documentWidth>sample.width+1||sample.buttons.some(button=>button.rect.left<0||button.rect.right>sample.width+1||!button.hit));
      assert.deepEqual(failures,[],'Every displayed header action must fit and remain clickable');return{widths:sweep.map(sample=>sample.width),allActionsFit:true};
    });
    if(!await check(room,'The tutor chooses the sound-cue letter, pictures and native instruction without deploying a sheet',()=>sheet(room,1)))return;
    if(!await check(room,'The tutor chooses an individual letter, clean breve, native word and sound boxes',()=>sheet(room,2)))return;
    if(!await check(room,'Build words uses five ASCII tiles and three boxes on its own page',async()=>{
      const live=await choose(room,3);await bothCount(room,'[data-letter-tile]',5);await bothCount(room,'[data-picture-piece]',0);assert.equal(live.board.boxes,3);
      assert.deepEqual([...live.board.tiles.values()].map(tile=>tile.text),['m','a','t','p','s']);assert(!room.pages.has(live.pageId));room.pages.add(live.pageId);
      return{tiles:5,soundBoxes:3,...await privacy(room)};
    }))return;
    if(!await check(room,'Dictation keeps the answers private and supplies three empty sound boxes',async()=>{
      const live=await choose(room,4);await bothCount(room,'[data-letter-tile]',0);await bothCount(room,'[data-picture-piece]',0);assert.equal(live.board.boxes,3);assert(!room.pages.has(live.pageId));room.pages.add(live.pageId);
      assert.deepEqual(await panel(tutor).getByRole('list',{name:'Private practice words or sentences',exact:true}).getByRole('listitem').allTextContents(),room.privateDictationTargets.split('\n'));
      return{answerTiles:0,soundBoxes:3,...await privacy(room)};
    }))return;
    if(!await check(room,'Reading sentences are added individually as native board text',()=>sheet(room,5)))return;
    if(!await check(room,'Meaning pictures and matching words are selected after reading',()=>sheet(room,6)))return;
    await check(room,'Revisiting teaching pieces preserves their page and reuses all four shared sources',async()=>{
      const prior=room.sheetPages.get('word-work'),live=await choose(room,2);await bothCount(room,'[data-picture-piece]',prior.pieceIds.length);
      assert.equal(live.pages.size,7);assert.equal(live.pageId,prior.pageId);assert.deepEqual([...live.board.pieces.keys()],prior.pieceIds);assert.equal(live.pictures.size,4);
      return{pages:7,sharedRoomSources:4,noSourceSheetDeployed:true,...await privacy(room)};
    });
    await check(room,'Deleting a prepared activity page preserves the saved lesson and reopens a fresh teacher-controlled board',async()=>{
      const saved=await documentFor(room),live=realtime.rooms.get(room.code),deletedId=live.pageId;
      const otherIds=[...live.pages.keys()].filter(id=>id!==deletedId);
      await closeGuide(room);await activate(room,tutor.getByRole('button',{name:/^Board pages, page /}));
      await activate(room,tutor.getByRole('dialog',{name:'Board pages',exact:true}).getByRole('button',{name:'Delete page',exact:true}));
      const confirmation=tutor.getByRole('dialog',{name:/^Delete “/});
      assert.equal(await confirmation.getByRole('button',{name:'Cancel',exact:true}).evaluate(node=>node===document.activeElement),true);
      await activate(room,confirmation.getByRole('button',{name:'Delete page',exact:true}));
      await until(()=>!live.pages.has(deletedId),'Deleted live activity page must disappear');
      for(const page of[tutor,student])await page.waitForFunction(id=>window.lessonReceived.filter(message=>message.t==='board').at(-1)?.pageId===id,live.pageId);
      assert.deepEqual([...live.pages.keys()],otherIds);assert.deepEqual(await documentFor(room),saved);
      await openLesson(room);await activate(room,panel(tutor).getByRole('button',{name:'Start activity',exact:true}));
      await confirmActivity(room,2);assert.notEqual(live.pageId,deletedId);assert.equal(live.pages.size,7);
      await bothCount(room,'[data-picture-piece]',0);await bothCount(room,'[data-letter-tile]',0);assert.equal(live.board.boxes,0);
      assert.deepEqual(await documentFor(room),saved);assert(otherIds.every(id=>live.pages.has(id)));
      return{savedLessonUnchanged:true,otherPagesRetained:6,freshActivityPieces:0,explicitRestart:true,...await privacy(room)};
    });
    await check(room,'Removing the v2 private copy preserves v1, v2 and every other owner source',async()=>{
      const current=await documentFor(room);assert.equal((await request(context,base,`/${room.id}`,'DELETE',{revision:current.revision})).status,204);
      for(const asset of template.assets){
        const global=await studentContext.request.get(`${base}/api/lesson-templates/${template.id}/assets/${asset.id}/image`);assert.equal(global.status(),200);assert.equal(hash(await global.body()),hash(assetBytes.get(asset.id)));
        const otherPlan=(await request(other,base,`/${room.otherId}`)).data.lesson;const privateAssetId=otherPlan.activities[template.activities.findIndex(activity=>activity.assetIds.includes(asset.id))].assetIds[0];
        const otherImage=await other.request.get(`${base}/api/lessons/${room.otherId}/assets/${privateAssetId}`);assert.equal(otherImage.status(),200);assert.equal(hash(await otherImage.body()),hash(assetBytes.get(asset.id)));
      }
      assert.deepEqual((await request(custom,base,`/${preservedCustom.id}`)).data.lesson,preservedCustom);
      assert.equal(templateFixture.assets.records.size,5);assert.equal(fixture.assets.records.size,0);
      return{immutableV1AndV2Sources:5,customizedPrivateCopyUnchanged:true,otherOwnerSourceRetained:true,...await privacy(room)};
    });
  }finally{await context.close();await other.close();await custom.close();await studentContext.close();}
}
try{const base=await start();for(const mobile of[false,true])await run(base,mobile);}
catch(error){report.fatal=error.stack;}
finally{
 await browser?.close();realtime?.close();await vite?.close();
 if(server?.listening)await new Promise(done=>server.close(done));
 await until(()=>connections.size===0,'Fixture sockets must close').catch(error=>{report.cleanupError=error.message;});
 for(const room of realtime?.rooms.values()||[])clearTimeout(room.closeTimer);
 if(devTransport?.listening)await new Promise(done=>devTransport.close(done));
 if(!dev){report.buildUnchanged=JSON.stringify(report.build)===JSON.stringify(fingerprint());if(!report.buildUnchanged)report.fatal='Production build changed during this run.';}
 report.passed=!report.fatal&&!report.cleanupError&&!report.pageErrors.length&&report.cases.length>0&&report.cases.every(item=>item.passed);
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output:out,passed:report.passed,cases:report.cases.length,failures:report.cases.filter(item=>!item.passed)},null,2));
 if(!report.passed)process.exitCode=1;
}
