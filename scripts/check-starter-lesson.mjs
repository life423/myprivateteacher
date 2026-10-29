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
  else if(arg==='--help'){console.log('Usage: node scripts/check-starter-lesson.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');process.exit(0);}
  else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome','chromium','webkit'].includes(browserName));
const root=fileURLToPath(new URL('../',import.meta.url));
assert(dev||existsSync(join(root,'dist/index.html')),'Build first, or pass --dev.');
const out=output?resolve(output):mkdtempSync(join(tmpdir(),'mpt-starter-lesson-'));
mkdirSync(out,{recursive:true});
const report={browser:browserName,frontend:dev?'isolated Vite':'production build',fixtureServices:true,realWebSockets:true,
  actualUserSession:false,cloudServices:false,cases:[],pageErrors:[],
  limitations:['Authenticated cookies belong to synthetic fixture accounts; no OAuth, billing or real customer data.',
    'Actual repository logic runs against memory adapters; this does not validate live Azure permissions, network availability or durability.',
    'Chrome phone uses trusted touch; WebKit phone-sized interaction uses mouse input. No real camera or microphone.']};
const hash=value=>createHash('sha256').update(value).digest('hex');
function fingerprint(){const html=readFileSync(join(root,'dist/index.html'));return{indexSha256:hash(html),scripts:[...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>({url:m[1],sha256:hash(readFileSync(join(root,'dist',m[1].replace(/^\//,''))))}))};}
if(!dev)report.build=fingerprint();
const template=JSON.parse(readFileSync(join(root,'content/lessons/short-a-first-practice/lesson.json')));
const worksheet=readFileSync(join(root,'content/lessons/short-a-first-practice',template.asset.file));
const worksheetSvg=readFileSync(join(root,'content/lessons/short-a-first-practice',template.asset.source),'utf8');
const sourceFont=Number(worksheetSvg.match(/font-size="([\d.]+)"/)[1]);
report.template={id:template.id,sourceFontPx:sourceFont,nativeWidth:template.asset.w,nativeHeight:template.asset.h};
report.limitations.push('Font sizes are nominal SVG-source font size scaled by raster display width;20px is this starter fixture regression requirement, not a clinical or universal readability threshold.');
const templateFixture=memoryLessonTemplates(),templates=templateFixture.templates;
await templates.publish(template,worksheet);
const owners=new Set(['fixture-owner-a','fixture-owner-b']);
const fixture=memoryLessons({templates,ownerExists:async owner=>owners.has(owner)});
const accounts={clientId:null,tutorFor:async token=>{
  const id=token==='fixture-cookie-a'?'fixture-owner-a':token==='fixture-cookie-b'?'fixture-owner-b':null;
  return id?{id,name:id,email:`${id}@example.test`,roles:['owner'],picture:'',subscription:null}:null;
}};
let server,realtime,browser,vite,devTransport;
const connections=new Set(),origins=new Set(),pause=ms=>new Promise(done=>setTimeout(done,ms));
const photo=readFileSync(join(root,'src/whiteboard/fixtures/lip-biter-240.jpg'));
const card={id:'fixture-articulation-card',title:'Fixture Lip Biter',sounds:['f','v'],collection:'Fixture cards',w:240,h:240,regions:[{id:'mouth',label:'Photo',x:0,y:0,w:240,h:240,r:0}]};
async function until(test,message,timeout=15_000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await pause(25);}assert.fail(message);}
async function start(){
  const pictures=Object.fromEntries(['beginWrite','add','get','isTutor'].map(method=>[method,(...args)=>realtime.pictures[method](...args)]));
  const app=createApp({accounts,templates,lessons:fixture.lessons,pictures,library:{list:async()=>[card],image:async id=>id===card.id?{...card,bytes:photo}:null}});
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
  if(await panel(room.tutor).isVisible())return;
  const open=room.tutor.getByRole('button',{name:/^(Lesson|Prepared lesson)$/});
  if(!await open.isVisible())await activate(room,room.tutor.getByRole('button',{name:'Materials',exact:true}));
  await activate(room,open);await panel(room.tutor).waitFor({state:'visible'});
}
async function endButton(room){
  const button=room.tutor.getByRole('button',{name:'End session',exact:true});
  if(!await button.isVisible())await activate(room,room.tutor.getByRole('button',{name:'Lesson controls',exact:true}));
  await button.waitFor();return button;
}
async function waitActive(room,index){
  await panel(room.tutor).getByRole('button',{name:'Activity is on the board',exact:true}).waitFor();
  assert.equal(await panel(room.tutor).getByRole('combobox',{name:'Lesson activity',exact:true}).inputValue(),String(index));
  const live=realtime.rooms.get(room.code);assert(live);
  for(const page of[room.tutor,room.student])await page.waitForFunction(id=>window.lessonReceived.filter(msg=>msg.t==='board').at(-1)?.pageId===id,live.pageId);
  return live.board;
}
async function chooseActivity(room,index){await openLesson(room);await panel(room.tutor).getByRole('combobox',{name:'Lesson activity',exact:true}).selectOption(String(index));return waitActive(room,index);}
async function bothCount(room,selector,count){for(const page of[room.tutor,room.student])await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector,count});}
async function privacy(room){
  await Promise.allSettled([...room.responseChecks]);
  const wire=await room.student.evaluate(()=>JSON.stringify({received:window.lessonReceived,sent:window.lessonSent,storage:{...sessionStorage},text:document.body.textContent}));
  const leaked=room.markers.filter(value=>wire.includes(value));
  assert.deepEqual(leaked,[],'Private lesson content must not enter student messages, storage or DOM');
  assert.deepEqual(room.networkLeaks,[],'Private lesson content must not enter student HTTP responses or URLs');
  return{socketMessages:await room.student.evaluate(()=>window.lessonReceived.length),httpResponsesChecked:room.httpResponses,secretMarkersChecked:room.markers.length,leaks:0};
}
async function display(page){
  return page.locator('[data-picture-piece] > svg').evaluate((element,{sourceFont,nativeWidth})=>{
    const rect=element.getBoundingClientRect(),board=element.closest('[data-board-surface]').getBoundingClientRect();
    const left=Math.max(rect.left,board.left,0),right=Math.min(rect.right,board.right,innerWidth);
    const top=Math.max(rect.top,board.top,0),bottom=Math.min(rect.bottom,board.bottom,innerHeight);
    return{image:rect.toJSON(),board:board.toJSON(),estimatedFontCssPx:sourceFont*rect.width/nativeWidth,
      visibleFraction:Math.max(0,right-left)*Math.max(0,bottom-top)/(rect.width*rect.height),viewport:{width:innerWidth,height:innerHeight}};
  },{sourceFont,nativeWidth:template.asset.w});
}
async function run(base,mobile){
  const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
  const studentContext=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
  const other=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
  context.setDefaultTimeout(12_000);studentContext.setDefaultTimeout(12_000);other.setDefaultTimeout(12_000);
  await other.addCookies([{name:'mpt_session',value:'fixture-cookie-b',url:base,httpOnly:true,sameSite:'Lax'}]);
  await context.addCookies([{name:'mpt_session',value:'fixture-cookie-a',url:base,httpOnly:true,sameSite:'Lax'}]);
  const tutor=await context.newPage(),student=await studentContext.newPage(),secondTutor=await other.newPage();await instrument(tutor);await instrument(student);
  const marker=`PRIVATE_STARTER_${mobile?'PHONE':'DESKTOP'}`;
  const room={context,studentContext,tutor,student,mobile,base,id:`starter-probe-${mobile?'phone':'desktop'}`,markers:template.activities.map((_,i)=>`${marker}_${i}`),responseChecks:new Set(),networkLeaks:[],httpResponses:0};
  student.on('request',request=>{for(const marker of room.markers)if(request.url().includes(marker))room.networkLeaks.push({where:'request-url',marker});});
  student.on('response',response=>{
    const task=(async()=>{if(!/json|javascript|text\//i.test(response.headers()['content-type']||''))return;const body=await response.text().catch(()=>'');room.httpResponses++;for(const marker of room.markers)if(body.includes(marker))room.networkLeaks.push({where:response.url(),marker});})();
    room.responseChecks.add(task);task.finally(()=>room.responseChecks.delete(task));
  });
  try{
    if(!await check(room,'Both tutors can use the included lesson and receive separate private copies',async()=>{
      const listed=await studentContext.request.get(`${base}/api/lesson-templates`);assert.equal(listed.status(),200);
      assert((await listed.json()).templates.some(item=>item.id===template.id));
      assert.equal((await studentContext.request.get(`${base}/api/lesson-templates/${template.id}`)).status(),401,'Private teaching directions require a tutor account');
      const original=await context.request.get(`${base}/api/lesson-templates/${template.id}`);assert.equal(original.status(),200);room.globalTemplate=(await original.json()).template;
      for(const [page,owner]of[[tutor,'first'],[secondTutor,'second']]){
        await page.goto(`${base}/lessons`);
        const included=page.getByRole('region',{name:'Included lessons',exact:true});
        await included.getByRole('heading',{name:template.title,exact:true}).waitFor();
        const use=included.getByRole('button',{name:'Use this lesson',exact:true});
        if(mobile&&browserName!=='webkit')await use.tap();else await use.click();
        await page.waitForURL(/\/lessons\/[^/]+$/);await page.getByRole('textbox',{name:'Lesson name',exact:true}).waitFor();
        const id=new URL(page.url()).pathname.split('/').at(-1);
        if(owner==='first')room.id=id;else room.otherId=id;
      }
      assert.notEqual(room.id,room.otherId,'Copies must belong to separate tutors');
      room.assetId=(await documentFor(room)).activities.find(item=>item.type==='read').assetIds[0];
      assert.equal((await request(other,base,`/${room.id}`)).status,404);
      assert.equal(templateFixture.assets.records.size,1,'The published PNG has one immutable source');
      assert.equal(fixture.assets.records.size,0,'Private copies reference global bytes rather than copying them');
      return{visibleToBothTutors:true,separatePrivateCopies:true,sourcePngCopies:1};
    }))return;
    if(!await check(room,'Private edits survive Use this lesson again without changing the other tutor or global template',async()=>{
      const current=await documentFor(room);
      const activities=current.activities.map((activity,i)=>({...activity,directions:`${activity.directions}\n${room.markers[i]}`}));
      assert.equal((await request(context,base,`/${room.id}`,'PUT',{...current,activities})).status,200);
      await tutor.goto(`${base}/lessons`);
      await activate(room,tutor.getByRole('region',{name:'Included lessons',exact:true}).getByRole('button',{name:'Use this lesson',exact:true}));
      await tutor.waitForURL(`**/lessons/${room.id}`);await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).waitFor();
      assert.equal((await documentFor(room)).activities[0].directions,activities[0].directions,'Using again preserves the tutor edits');
      const second=await request(other,base,`/${room.otherId}`);assert.equal(second.status,200);assert(!JSON.stringify(second.data.lesson).includes('PRIVATE_STARTER_'));
      const global=await context.request.get(`${base}/api/lesson-templates/${template.id}`);assert.deepEqual((await global.json()).template,room.globalTemplate);
      assert.equal(await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).inputValue(),template.title);
      await activityList(room);assert.equal(await tutor.locator('aside ol > li').count(),4);
      await activate(room,tutor.locator('aside ol > li > button').last());
      await prep(tutor).getByRole('checkbox',{name:'Worksheet 1',exact:true}).waitFor();
      await tutor.screenshot({path:join(out,`starter-preparation-${mobile?'phone':'desktop'}.png`)});
      return{samePrivateCopy:true,editsPreserved:true,otherTutorUnchanged:true,globalTemplateUnchanged:true};
    }))return;
    if(!await check(room,'Review, Build and Dictation load the actual chosen letters and sound boxes',async()=>{
      await activate(room,tutor.getByRole('button',{name:/^Teach this lesson/}));await tutor.waitForURL(/\/whiteboard\/teach\?lesson=/);
      await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='room'));
      room.code=await tutor.evaluate(()=>window.lessonReceived.find(msg=>msg.t==='room').code);
      await student.goto(`${base}/whiteboard/${room.code}`);await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='presence'&&msg.student));
      for(const page of[tutor,student])for(const button of await page.getByRole('button',{name:'Close this message',exact:true}).all())if(await button.isVisible())await button.click();
      await openLesson(room);await activate(room,panel(tutor).getByRole('button',{name:'Start activity',exact:true}));await waitActive(room,0);
      await bothCount(room,'[data-letter-tile]',5);assert.equal(realtime.rooms.get(room.code).board.boxes,0);
      assert.deepEqual([...realtime.rooms.get(room.code).board.tiles.values()].map(item=>item.text),['a','m','s','t','p']);
      await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await waitActive(room,1);await bothCount(room,'[data-letter-tile]',5);assert.equal(realtime.rooms.get(room.code).board.boxes,3);
      await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await waitActive(room,2);await bothCount(room,'[data-letter-tile]',0);assert.equal(realtime.rooms.get(room.code).board.boxes,3);
      return{reviewLetters:5,buildLetters:5,dictationAnswerTiles:0,...await privacy(room)};
    }))return;
    await check(room,'The actual reading worksheet is shared without private prompts; its displayed text is measured',async()=>{
      await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await bothCount(room,'[data-picture-piece]',1);
      assert.equal(await tutor.locator('section[aria-label="Prepared lesson"] select[aria-label="Lesson activity"]').inputValue(),'3');
      assert.equal(realtime.rooms.get(room.code).board.boxes,0);
      await student.waitForFunction(()=>window.lessonReceived.some(message=>message.t==='focus'&&message.reading===true));
      for(const page of[tutor,student])await page.waitForFunction(({font,nativeWidth})=>{
        const element=document.querySelector('[data-picture-piece] > svg');
        return element&&font*element.getBoundingClientRect().width/nativeWidth>=20;
      },{font:sourceFont,nativeWidth:template.asset.w});
      room.readDisplay={tutor:await display(tutor),student:await display(student)};
      for(const [label,view]of Object.entries(room.readDisplay)){
        assert(view.visibleFraction>=0.95,`${label} should see the entire reading sheet without first finding it by panning`);
        assert(view.estimatedFontCssPx>=20,`${label} should receive at least20px nominal text for this starter reading sheet`);
      }
      room.readPiece=[...realtime.rooms.get(room.code).board.pieces.values()][0];
      for(const [label,page]of[['tutor',tutor],['student',student]])await page.screenshot({path:join(out,`starter-read-${mobile?'phone':'desktop'}-${label}.png`)});
      return{display:room.readDisplay,piece:room.readPiece,...await privacy(room)};
    });
    await check(room,'Deleting a private copy preserves the global PNG and the other tutor’s worksheet',async()=>{
      const current=await documentFor(room);assert.equal((await request(context,base,`/${room.id}`,'DELETE',{revision:current.revision})).status,204);
      assert.equal((await request(context,base,`/${room.id}`)).status,404);
      const publicImage=await studentContext.request.get(`${base}/api/lesson-templates/${template.id}/assets/${template.asset.id}/image`);assert.equal(publicImage.status(),200);assert.equal(hash(await publicImage.body()),hash(worksheet));
      const privateImage=await other.request.get(`${base}/api/lessons/${room.otherId}/assets/${room.assetId}`);assert.equal(privateImage.status(),200);assert.equal(hash(await privateImage.body()),hash(worksheet));
      assert.equal(templateFixture.assets.records.size,1);assert.equal(fixture.assets.records.size,0);
      return{deletedCopy:true,globalPngRetained:true,otherTutorSourceRetained:true,...await privacy(room)};
    });
  }finally{await context.close();await other.close();await studentContext.close();}
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
 report.passed=!report.fatal&&!report.cleanupError&&!report.pageErrors.length&&report.cases.every(item=>item.passed);
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output:out,passed:report.passed,cases:report.cases.length,failures:report.cases.filter(item=>!item.passed)},null,2));
 if(!report.passed)process.exitCode=1;
}
