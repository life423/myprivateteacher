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
import { memoryLessons } from '../server/lessonFixtures.js';

// Isolated preparation and live-teaching checks. The real owner-scoped repository
// and routes use memory adapters, never MongoDB, Azure, Google or a user's service.
let dev=false,browserName='chrome',output;
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--dev')dev=true;
  else if(arg==='--browser')browserName=process.argv[++i];
  else if(arg==='--output')output=process.argv[++i];
  else if(arg==='--help'){console.log('Usage: node scripts/check-saved-lessons.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');process.exit(0);}
  else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome','chromium','webkit'].includes(browserName));
const root=fileURLToPath(new URL('../',import.meta.url));
assert(dev||existsSync(join(root,'dist/index.html')),'Build first, or pass --dev.');
const out=output?resolve(output):mkdtempSync(join(tmpdir(),'mpt-saved-lessons-'));
mkdirSync(out,{recursive:true});
const report={browser:browserName,frontend:dev?'isolated Vite':'production build',fixtureServices:true,realWebSockets:true,
  actualUserSession:false,cloudServices:false,cases:[],pageErrors:[],
  limitations:['Authenticated cookies belong to synthetic fixture accounts; no OAuth, billing or real customer data.',
    'Actual repository logic runs against memory adapters; this does not validate live Azure permissions, network availability or durability.',
    'Chrome phone uses trusted touch; WebKit phone-sized interaction uses mouse input. No real camera or microphone.']};
const hash=value=>createHash('sha256').update(value).digest('hex');
function fingerprint(){const html=readFileSync(join(root,'dist/index.html'));return{indexSha256:hash(html),scripts:[...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>({url:m[1],sha256:hash(readFileSync(join(root,'dist',m[1].replace(/^\//,''))))}))};}
if(!dev)report.build=fingerprint();
const owners=new Set(['fixture-owner-a','fixture-owner-b']);
const fixture=memoryLessons({ownerExists:async owner=>owners.has(owner)});
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
  const app=createApp({accounts,lessons:fixture.lessons,pictures,library:{list:async()=>[card],image:async id=>id===card.id?{...card,bytes:photo}:null}});
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
  const direct=room.tutor.getByRole('button',{name:'Tutor guide',exact:true});
  if(await direct.isVisible()){await activate(room,direct);await panel(room.tutor).waitFor({state:'visible'});return;}
  const open=room.tutor.getByRole('button',{name:'Lesson',exact:true});
  if(!await open.isVisible())await activate(room,room.tutor.getByRole('button',{name:'Materials',exact:true}));
  await activate(room,open);await panel(room.tutor).waitFor({state:'visible'});
}
async function endButton(room){
  const close=room.tutor.getByRole('button',{name:'Close tutor guide',exact:true});
  if(await close.isVisible())await activate(room,close);
  const button=room.tutor.getByRole('button',{name:'End session',exact:true});
  if(!await button.isVisible())await activate(room,room.tutor.getByRole('button',{name:'Lesson controls',exact:true}));
  await button.waitFor();return button;
}
async function waitActive(room,index){
  const reading=room.saved?.activities[index]?.type==='read';
  if(reading){
    // Reading intentionally closes the phone sheet. Confirm the runner's real
    // completed state in its mounted private panel, not visible sheet chrome.
    const mounted=room.tutor.locator('section[aria-label="Prepared lesson"]');
    await mounted.getByRole('button',{name:'Activity is on the board',exact:true,includeHidden:true}).waitFor({state:'attached'});
    assert.equal(await mounted.locator('select[aria-label="Lesson activity"]').inputValue(),String(index));
  }else{
    await panel(room.tutor).getByRole('button',{name:'Activity is on the board',exact:true}).waitFor();
    assert.equal(await panel(room.tutor).getByRole('combobox',{name:'Lesson activity',exact:true}).inputValue(),String(index));
  }
  const live=realtime.rooms.get(room.code);assert(live);
  for(const page of[room.tutor,room.student])await page.waitForFunction(id=>window.lessonReceived.filter(msg=>msg.t==='board').at(-1)?.pageId===id,live.pageId);
  if(reading){
    const scope={pageId:live.pageId,pageEpoch:live.pageEpoch};
    await room.tutor.waitForFunction(scope=>window.lessonSent.some(msg=>msg.t==='focus'&&msg.reading===true&&msg.pageId===scope.pageId&&msg.pageEpoch===scope.pageEpoch),scope);
    await room.student.waitForFunction(scope=>window.lessonReceived.some(msg=>msg.t==='focus'&&msg.reading===true&&msg.pageId===scope.pageId&&msg.pageEpoch===scope.pageEpoch),scope);
  }
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
async function run(base,mobile){
  const options={viewport:mobile?{width:393,height:852}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile};
  const context=await browser.newContext(options),other=await browser.newContext(options),studentContext=await browser.newContext(options);
  for(const ctx of[context,other,studentContext])ctx.setDefaultTimeout(12_000);
  await context.addCookies([{name:'mpt_session',value:'fixture-cookie-a',url:base,httpOnly:true,sameSite:'Lax'}]);
  await other.addCookies([{name:'mpt_session',value:'fixture-cookie-b',url:base,httpOnly:true,sameSite:'Lax'}]);
  const tutor=await context.newPage(),student=await studentContext.newPage();await instrument(tutor);await instrument(student);
  const suffix=mobile?'PHONE_20261029':'DESKTOP_20261029';
  const title=`SECRET_PLAN_${suffix}`,filename=`SECRET_FILENAME_${suffix}.jpg`,note=`SECRET_REVIEW_NOTE_${suffix}`;
  const activityTitles=['review','build','dictation','read'].map(type=>`SECRET_${type.toUpperCase()}_TITLE_${suffix}`);
  const directions=['review','build','dictation','read'].map(type=>`SECRET_${type.toUpperCase()}_DIRECTIONS_${suffix}`);
  const buildTarget=`SECRET_BUILD_TARGET_${suffix}`,dictationTarget=`SECRET_DICTATION_ANSWER_${suffix}`;
  const markers=[title,filename,note,...activityTitles,...directions,buildTarget,dictationTarget];
  const room={context,other,studentContext,tutor,student,mobile,base,markers,note,responseChecks:new Set(),networkLeaks:[],httpResponses:0};
  student.on('request',req=>{for(const marker of markers)if(req.url().includes(marker))room.networkLeaks.push({where:'request-url',marker});});
  student.on('response',response=>{
    const task=(async()=>{const type=response.headers()['content-type']||'';if(!/json|javascript|text\//i.test(type))return;const body=await response.text().catch(()=>'');room.httpResponses++;for(const marker of markers)if(body.includes(marker))room.networkLeaks.push({where:response.url(),marker});})();
    room.responseChecks.add(task);task.finally(()=>room.responseChecks.delete(task));
  });
  try{
    if(!await check(room,'A tutor prepares all four activity types with private directions and a worksheet',async()=>{
      await tutor.goto(`${base}/lessons`);await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).fill(title);
      await activate(room,tutor.getByRole('button',{name:'Prepare lesson',exact:true}));
      await tutor.waitForURL(/\/lessons\/[A-Za-z0-9_-]+$/);room.id=new URL(tutor.url()).pathname.split('/').at(-1);
      const names=['Review','Build words','Dictation','Read'];
      for(let i=0;i<names.length;i++){
        await activityList(room);
        await activate(room,tutor.getByRole('group',{name:'Add activity',exact:true}).getByRole('button',{name:names[i],exact:true}));
        await prep(tutor).getByRole('textbox',{name:/^Activity name/}).fill(activityTitles[i]);
        await prep(tutor).getByRole('textbox',{name:/^Directions for you/}).fill(directions[i]);
        if(i===0){
          await prep(tutor).getByRole('textbox',{name:/^Letters and sounds to review/}).fill('m s');
          await activate(room,prep(tutor).locator('summary').filter({hasText:'Articulation cards'}));
          await prep(tutor).getByRole('checkbox',{name:card.title,exact:true}).check();
        }else if(i===1){
          await prep(tutor).getByRole('textbox',{name:/^Word list/}).fill(buildTarget);
          await prep(tutor).getByRole('textbox',{name:/^Starting letter tiles/}).fill('c a t');
          await prep(tutor).getByRole('combobox',{name:/^Sound boxes/}).selectOption('3');
        }else if(i===2)await prep(tutor).getByRole('textbox',{name:/^Words or sentences/}).fill(dictationTarget);
        else{
          await prep(tutor).getByLabel('Choose a worksheet file',{exact:true}).setInputFiles({name:filename,mimeType:'image/jpeg',buffer:photo});
          await until(()=>fixture.assets.records.size>0,'Private worksheet upload must complete');
          await prep(tutor).getByRole('checkbox',{name:/Worksheet 1/}).waitFor();
        }
      }
      await activate(room,tutor.getByRole('button',{name:'Save lesson',exact:true}));
      await tutor.getByRole('status').filter({hasText:/^Lesson saved\.$/}).waitFor();
      room.saved=await documentFor(room);assert.equal(room.saved.title,title);assert.deepEqual(room.saved.activities.map(a=>a.type),['review','build','dictation','read']);
      assert.equal(room.saved.activities[0].cardIds[0],card.id);assert.equal(room.saved.activities[1].boxes,3);assert.equal(room.saved.activities[2].targets,dictationTarget);assert.equal(room.saved.activities[3].assetIds.length,1);
      room.assetId=room.saved.activities[3].assetIds[0];
      assert(!JSON.stringify(room.saved.assets).includes(filename),'Original filename must not become saved asset metadata');
      await tutor.screenshot({path:join(out,`preparation-${mobile?'phone':'desktop'}.png`)});
      return{activities:4,worksheetAssets:room.saved.assets.length,privateDirectionsSaved:true};
    }))return;
    await check(room,'Reordering and reloading preserve the tutor’s saved preparation',async()=>{
      await activityList(room);
      await activate(room,tutor.getByRole('button',{name:'Move activity 3 up',exact:true}));
      await activate(room,tutor.getByRole('button',{name:'Save lesson',exact:true}));
      await until(async()=>JSON.stringify((await documentFor(room)).activities.map(a=>a.type))===JSON.stringify(['review','dictation','build','read']),'Reordered plan must be saved');
      await tutor.reload();await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).waitFor();
      assert.equal(await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).inputValue(),title);
      const order=await tutor.locator('aside ol > li > button').allTextContents();assert.equal(order.length,4);assert(order[1].includes(activityTitles[2]));
      room.saved=await documentFor(room);return{order:room.saved.activities.map(a=>a.type),revision:room.saved.revision};
    });
    await check(room,'Owner isolation and anonymous denial apply to lesson documents and worksheet bytes',async()=>{
      const list=await request(other,base,'');assert.equal(list.status,200);assert.deepEqual(list.data.lessons,[]);
      const forbidden=[];
      for(const[path,method,data]of[[`/${room.id}`,'GET'],[`/${room.id}`,'PUT',room.saved],[`/${room.id}`,'DELETE',{revision:room.saved.revision}],[`/${room.id}/assets/${room.assetId}`,'GET']]){
        const res=await request(other,base,path,method,data);assert.equal(res.status,404);assert(!JSON.stringify(res.data).includes(title));forbidden.push({method,status:res.status});
      }
      for(const path of['',`/${room.id}`,`/${room.id}/assets/${room.assetId}`])assert.equal((await request(studentContext,base,path)).status,401);
      const owned=await request(context,base,`/${room.id}`);assert.equal(owned.status,200);assert.match(owned.headers['cache-control'],/no-store/);
      const stale=await request(context,base,`/${room.id}`,'PUT',{...room.saved,revision:room.saved.revision-1});assert.equal(stale.status,409);assert.deepEqual(await documentFor(room),room.saved);
      return{crossOwner:forbidden,anonymousStatus:401,staleRevisionStatus:409};
    });
    await check(room,'Saved stale material fields cannot reveal a dictation answer or unrelated worksheet',async()=>{
      const document=await documentFor(room);
      const input={...document,activities:document.activities.map(activity=>activity.type==='dictation'?{...activity,letters:'q u i z',cardIds:[card.id],assetIds:[room.assetId]}:activity)};
      const saved=await request(context,base,`/${room.id}`,'PUT',input);assert.equal(saved.status,200);
      room.saved=saved.data.lesson;
      await tutor.reload();await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).waitFor();
      return{type:'dictation',staleFieldsPresentInPrivateRecord:true,activationMustRemainBlank:true};
    });
    if(!await check(room,'Teach this lesson automatically opens Review while keeping the plan and later materials private',async()=>{
      await activate(room,tutor.getByRole('button',{name:/^Teach this lesson/}));await tutor.waitForURL(/\/whiteboard\/teach\?lesson=/);
      await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='room'));
      room.code=await tutor.evaluate(()=>window.lessonReceived.find(msg=>msg.t==='room').code);
      await student.goto(`${base}/whiteboard/${room.code}`);await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='presence'&&msg.student));
      // The explicit teaching URL must open its private panel and load Review
      // without another click. Do not call openLesson here: that would hide a
      // regression in automatic discovery on the phone sheet.
      await panel(tutor).waitFor({state:'visible'});await waitActive(room,0);
      await bothCount(room,'[data-letter-tile]',2);await bothCount(room,'[data-picture-piece]',1);
      assert.equal(realtime.rooms.get(room.code).pages.size,1);assert.equal(realtime.rooms.get(room.code).pictures.size,1,'Only the opened Review card may enter the room; later private worksheets must remain unloaded');
      assert(await panel(tutor).getByRole('button',{name:'Activity is on the board',exact:true}).isDisabled());
      const guide=tutor.getByRole('complementary',{name:'Tutor guide',exact:true}),surface=tutor.locator('[data-board-surface]');
      const geometry=async(page=tutor)=>({bounds:await page.locator('[data-board-surface]').boundingBox(),zoom:await page.getByRole('button',{name:'Zoom to 100%',exact:true}).innerText()});
      const docked=await guide.getAttribute('data-docked')==='true';
      const opened=await geometry(),studentView=await geometry(student);await activate(room,tutor.getByRole('button',{name:'Close tutor guide',exact:true}));
      await tutor.locator('[data-tutor-guide][data-state="closed"]').waitFor({state:'attached'});await pause(220);
      const closed=await geometry();
      if(docked)assert(closed.bounds.width>opened.bounds.width+80,'Closing the docked guide must restore useful tutor board space');
      else assert.deepEqual(closed,opened,'Closing the overlay must not resize, move or zoom the board');
      assert.deepEqual(await geometry(student),studentView,'Tutor guide boundaries must not alter the student viewport');
      assert.equal(await tutor.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Tutor guide','Close returns focus to its visible launcher');
      await openLesson(room);await pause(220);assert.deepEqual(await geometry(),opened,docked?'Reopening the dock must fit the same tutor board space':'Opening the overlay must not resize, move or zoom the board');
      assert.deepEqual(await geometry(student),studentView,'Opening the tutor guide must not focus or resize the student board');
      const guideBounds=await guide.boundingBox();assert(guideBounds&&guideBounds.width<=600.5&&guideBounds.x>=0&&guideBounds.y>=0);
      if(docked){
        assert(opened.bounds.x+opened.bounds.width<=guideBounds.x+1,'The fitted tutor board must not overlap its docked guide');
        assert(guideBounds.width>=520&&guideBounds.width<=560.5,'The dock keeps a readable wide column');
        const show=tutor.getByRole('button',{name:'Show tools',exact:true});await show.waitFor();const target=await show.boundingBox();assert(target.width>=44&&target.height>=44);
        await activate(room,show);await tutor.getByRole('button',{name:'Hide tools',exact:true}).waitFor();
        await activate(room,tutor.getByRole('button',{name:'Hide tools',exact:true}));await show.waitFor();
      }
      for(const name of['Previous activity','Next activity']){const bounds=await panel(tutor).getByRole('button',{name,exact:true}).boundingBox();assert(bounds&&bounds.height>=44&&bounds.y+bounds.height<=options.viewport.height+1,'Activity footer remains usable inside the viewport');}
      await tutor.keyboard.press('Escape');await tutor.locator('[data-tutor-guide][data-state="closed"]').waitFor({state:'attached'});await pause(220);
      assert.equal(await tutor.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Tutor guide','Escape returns focus to the visible launcher');await openLesson(room);
      return{automaticFirstActivity:true,privatePanelOpened:true,laterMaterialsUnloaded:true,guideWidth:guideBounds.width,guideDocked:docked,tutorBoardFitsBesideGuide:docked,overlayGeometryUnchanged:!docked,studentViewUnchanged:true,closeAndEscapeFocusReturn:true,...await privacy(room)};
    }))return;
    await check(room,'Review opens only its chosen letters/card; Next provides a blank private-dictation page',async()=>{
      await waitActive(room,0);
      assert(await panel(tutor).getByRole('button',{name:'Activity is on the board',exact:true}).isDisabled());
      await bothCount(room,'[data-letter-tile]',2);await bothCount(room,'[data-picture-piece]',1);
      room.reviewPage=realtime.rooms.get(room.code).pageId;
      await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await waitActive(room,1);
      await bothCount(room,'[data-letter-tile]',0);await bothCount(room,'[data-picture-piece]',0);
      assert(await panel(tutor).getByText(dictationTarget,{exact:true}).isVisible());assert.equal(realtime.rooms.get(room.code).board.boxes,0);
      room.dictationPage=realtime.rooms.get(room.code).pageId;
      return{reviewTiles:2,reviewCards:1,dictationBlank:true,...await privacy(room)};
    });
    await check(room,'Build words and Read use separate pages; Previous retains the learner’s work',async()=>{
      await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await waitActive(room,2);
      await bothCount(room,'[data-letter-tile]',3);assert.equal(realtime.rooms.get(room.code).board.boxes,3);
      room.buildPage=realtime.rooms.get(room.code).pageId;
      await activate(room,tutor.getByRole('button',{name:'Close tutor guide',exact:true}));
      if(!await tutor.getByRole('tab',{name:'Letters',exact:true}).isVisible())await activate(room,tutor.getByRole('button',{name:'Materials',exact:true}));
      await activate(room,tutor.getByRole('tab',{name:'Letters',exact:true}));
      await tutor.getByRole('textbox',{name:'Add tiles',exact:true}).fill('x');await activate(room,tutor.getByRole('button',{name:'Add',exact:true}));await bothCount(room,'[data-letter-tile]',4);
      const ids=[...realtime.rooms.get(room.code).board.tiles.keys()];
      await openLesson(room);await activate(room,panel(tutor).getByRole('button',{name:'Next activity',exact:true}));await waitActive(room,3);
      await bothCount(room,'[data-letter-tile]',0);await bothCount(room,'[data-picture-piece]',1);
      room.readPage=realtime.rooms.get(room.code).pageId;
      const picture=[...realtime.rooms.get(room.code).board.pieces.values()][0];assert.equal(realtime.rooms.get(room.code).pictures.get(picture.pic).title,'Lesson worksheet');
      const source=await student.locator('[data-picture-piece] image').getAttribute('href');const res=await studentContext.request.get(new URL(source,base).href);assert.equal(res.status(),200);
      await openLesson(room);await activate(room,panel(tutor).getByRole('button',{name:'Previous activity',exact:true}));await waitActive(room,2);await bothCount(room,'[data-letter-tile]',4);
      assert.deepEqual([...realtime.rooms.get(room.code).board.tiles.keys()],ids);assert.equal(realtime.rooms.get(room.code).pageId,room.buildPage);assert.equal(realtime.rooms.get(room.code).pages.size,4);
      return{learnerTilesRetained:4,activityPages:4,worksheetTitleGeneric:true,...await privacy(room)};
    });
    await check(room,'Review-next-time flag and private note persist in the tutor’s account',async()=>{
      await activate(room,panel(tutor).getByRole('button',{name:/^Review next time/}));
      await panel(tutor).getByRole('checkbox',{name:'Review next time',exact:true}).check();
      await panel(tutor).getByRole('textbox',{name:'Private review note',exact:true}).fill(note);
      await activate(room,panel(tutor).getByRole('button',{name:'Save review note',exact:true}));
      await panel(tutor).getByRole('status').filter({hasText:'Review note saved'}).waitFor();
      const stored=await documentFor(room),activity=stored.activities[2];assert.equal(activity.reviewNextTime,true);assert.equal(activity.reviewNote,note);
      const list=await request(context,base,'');assert.equal(list.data.lessons.find(item=>item.id===room.id).reviewCount,1);
      return{flagSaved:true,noteSaved:true,...await privacy(room)};
    });
    await check(room,'A delayed note save preserves newer edits and keeps the unsaved-navigation guard',async()=>{
      const field=panel(tutor).getByRole('textbox',{name:'Private review note',exact:true});
      const snapshot=`${note} earlier snapshot`,newer=`${note} revised while saving`;
      let release,intercepted=false,payload;
      const gate=new Promise(done=>{release=done;});
      const matcher=`**/api/lessons/${room.id}`;
      const handler=async route=>{
        if(route.request().method()!=='PUT')return route.continue();
        intercepted=true;payload=route.request().postDataJSON();await gate;await route.continue();
      };
      await context.route(matcher,handler);
      try{
        await field.fill(snapshot);await activate(room,panel(tutor).getByRole('button',{name:'Save review note',exact:true}));
        await until(()=>intercepted,'The private review PUT must actually be held');
        assert.equal(payload.activities[2].reviewNote,snapshot);
        await field.fill(newer);
        release();
        await until(async()=>!await panel(tutor).getByRole('button',{name:'Save review note',exact:true}).isDisabled(),'The earlier save must finish');
        assert.equal((await documentFor(room)).activities[2].reviewNote,snapshot);
        assert.equal(await field.inputValue(),newer,'A late response must not replace newer typing');
        assert(await panel(tutor).getByText('Unsaved note. Save before leaving this room.',{exact:true}).isVisible());
        assert.equal(await panel(tutor).getByRole('status').filter({hasText:'Review note saved'}).count(),0,'Do not claim newer text was saved');
        const current=tutor.url(),waiting=tutor.waitForEvent('dialog');
        const clicking=activate(room,panel(tutor).getByRole('link',{name:'Edit preparation',exact:true}));
        const dialog=await waiting;assert.equal(dialog.type(),'confirm');assert.match(dialog.message(),/private review note/);await dialog.dismiss();await clicking;
        assert.equal(tutor.url(),current,'Dismissing the warning retains the live lesson');
        const credentials=await tutor.evaluate(()=>sessionStorage.getItem('wb-tutor'));
        const ends=await tutor.evaluate(()=>window.lessonSent.filter(msg=>msg.t==='end').length);
        assert(credentials,'An active tutor must retain resume credentials');
        const end=await endButton(room),endWarning=tutor.waitForEvent('dialog');
        const ending=activate(room,end);const warning=await endWarning;assert.equal(warning.type(),'confirm');await warning.dismiss();await ending;
        assert.equal(tutor.url(),current);assert.equal(await tutor.evaluate(()=>sessionStorage.getItem('wb-tutor')),credentials);
        assert.equal(await tutor.evaluate(()=>window.lessonSent.filter(msg=>msg.t==='end').length),ends,'Cancel must not send a destructive end message');
        assert(realtime.rooms.get(room.code)?.tutor&&realtime.rooms.get(room.code)?.student,'Cancelling retains both room members');
        for(const page of[tutor,student])assert(await page.evaluate(()=>window.lessonSockets.some(ws=>ws.readyState===WebSocket.OPEN)));
        const controls=tutor.getByRole('dialog',{name:'Lesson controls',exact:true});
        if(await controls.isVisible())await activate(room,controls.getByRole('button',{name:'Close lesson controls',exact:true}));

      }finally{release();await context.unroute(matcher,handler);}
      await openLesson(room);
      await activate(room,panel(tutor).getByRole('button',{name:'Save review note',exact:true}));
      await panel(tutor).getByRole('status').filter({hasText:'Review note saved'}).waitFor();
      assert.equal((await documentFor(room)).activities[2].reviewNote,newer);room.expectedNote=newer;
      return{heldPrivatePut:true,newerDraftRetained:true,navigationGuardConfirmed:true,endCancellationNonDestructive:true,...await privacy(room)};
    });
    await check(room,'Reconnect, page changes and tutor refresh never expose private preparation to the student',async()=>{
      const before=await student.evaluate(()=>window.lessonReceived.length);
      await student.evaluate(()=>window.lessonSockets.findLast(ws=>ws.readyState===WebSocket.OPEN)?.close(1000,'fixture reconnect'));
      await student.waitForFunction(n=>window.lessonReceived.slice(n).some(msg=>msg.t==='board'&&msg.reason==='sync'),before);
      await chooseActivity(room,0);await chooseActivity(room,3);await chooseActivity(room,2);await bothCount(room,'[data-letter-tile]',4);
      const count=realtime.rooms.get(room.code).pages.size;await tutor.reload();await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='board'));
      await panel(tutor).waitFor({state:'visible'});await waitActive(room,2);await bothCount(room,'[data-letter-tile]',4);
      assert.equal(realtime.rooms.get(room.code).pageId,room.buildPage,'Refresh must recover the current mapped activity instead of returning to Review');
      assert.equal(realtime.rooms.get(room.code).pages.size,count,'Refresh must reuse activity pages rather than duplicate them');
      await tutor.screenshot({path:join(out,`private-tutor-plan-${mobile?'phone':'desktop'}.png`)});
      await student.screenshot({path:join(out,`student-materials-only-${mobile?'phone':'desktop'}.png`)});
      return{sameActivityPage:true,...await privacy(room)};
    });
    await check(room,'Changing a used Build template to Dictation opens a fresh blank board, preserving earlier work',async()=>{
      const before=await documentFor(room),live=realtime.rooms.get(room.code),oldPage=room.buildPage;
      const ids=[...live.pages.get(oldPage).tiles.keys()],pageCount=live.pages.size;
      const changed={...before,activities:before.activities.map((activity,index)=>index===2?{...activity,type:'dictation',boxes:0,letters:'c a t',cardIds:[card.id],assetIds:[room.assetId],targets:`${dictationTarget} revised template`}:activity)};
      assert.equal((await request(context,base,`/${room.id}`,'PUT',changed)).status,200);
      await tutor.reload();await tutor.waitForFunction(()=>window.lessonReceived.some(msg=>msg.t==='board'));
      await panel(tutor).waitFor({state:'visible'});await waitActive(room,2);await bothCount(room,'[data-letter-tile]',0);await bothCount(room,'[data-picture-piece]',0);
      assert.equal(live.board.boxes,0);assert.notEqual(live.pageId,oldPage,'A changed student projection cannot reuse a board containing the earlier answer');
      assert.equal(live.pages.size,pageCount+1);assert.deepEqual([...live.pages.get(oldPage).tiles.keys()],ids,'The earlier board remains intact');
      assert(await panel(tutor).getByText(`${dictationTarget} revised template`,{exact:true}).isVisible());
      assert(await panel(tutor).evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Long private prompts must fit the sidebar width');
      return{freshDictationPage:true,earlierLearnerTilesPreserved:ids.length,...await privacy(room)};
    });
    await check(room,'After saving private drafts, ending the lesson closes both screens and removes resume credentials',async()=>{
      await activate(room,await endButton(room));await tutor.waitForURL(/\/whiteboard$/);
      await until(()=>!realtime.rooms.has(room.code),'Ending must close the real fixture room');
      await student.getByRole('heading',{name:'The session is over',exact:true}).waitFor();
      assert.equal(await tutor.evaluate(()=>sessionStorage.getItem('wb-tutor')),null);
      return{roomEnded:true,resumeCredentialsRemoved:true,...await privacy(room)};
    });
    await check(room,'Reopening preparation displays the saved review note and deletion cleans private assets',async()=>{
      await tutor.goto(`${base}/lessons/${room.id}`);await tutor.getByRole('textbox',{name:'Lesson name',exact:true}).waitFor();
      await activityList(room);
      await activate(room,tutor.locator('aside ol > li > button').nth(2));
      assert.equal(await prep(tutor).getByRole('textbox',{name:/^Review note/}).inputValue(),room.expectedNote||note);assert(await prep(tutor).getByRole('checkbox',{name:'Review next time',exact:true}).isChecked());
      const value=await documentFor(room);assert.equal((await request(context,base,`/${room.id}`,'DELETE',{revision:value.revision})).status,204);
      assert.equal((await request(context,base,`/${room.id}`)).status,404);assert.equal((await request(context,base,`/${room.id}/assets/${room.assetId}`)).status,404);
      assert(![...fixture.assets.records.keys()].some(path=>path.includes(`/${room.id}/`)));
      return{savedNoteReloaded:true,privateAssetsDeleted:true,...await privacy(room)};
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
  report.passed=!report.fatal&&!report.cleanupError&&!report.pageErrors.length&&report.cases.length>0&&report.cases.every(item=>item.passed);
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
  const failed=report.cases.filter(item=>!item.passed);console.log(JSON.stringify({output:out,passed:report.cases.length-failed.length,total:report.cases.length,pageErrors:report.pageErrors,fatal:report.fatal,failures:failed.map(({viewport,name,error})=>({viewport,name,error}))},null,2));
  if(!report.passed)process.exitCode=1;
}
