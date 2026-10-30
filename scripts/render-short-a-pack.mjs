// Original textbook-style teaching pages. Raster illustrations are generated
// separately; all spelling, breve marks and geometry are deterministic SVG.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {phonemeDiagramSvg} from '../src/articulation/phonemeDiagrams.js';
import {PHONEME_ARTICULATION_CARDS} from '../src/data/phonemeArticulation.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'content/lessons/short-a-teaching-pack');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
const data=async(file,type)=>`data:${type};base64,${(await readFile(file)).toString('base64')}`;
const C={ink:'#182134',muted:'#526277',line:'#dce3ec',purple:'#6d35d5',pale:'#f7f4fc',gold:'#f4b544',aqua:'#a8d5df'};
const text=(s,x,y,size,options='')=>`<text x="${x}" y="${y}" font-size="${size}" ${options}>${esc(s)}</text>`;
const rect=(x,y,w,h,fill='white',stroke=C.line,rx=24)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const image=(href,x,y,w,h,extra='')=>`<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" ${extra}/>`;
function page(id,number,title,subtitle,target,body){return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1700" viewBox="0 0 1600 1700" role="img" aria-labelledby="title desc" data-min-target-font-size="${target}"><title id="title">${esc(title)}</title><desc id="desc">${esc(subtitle)}</desc><defs><clipPath id="mouth"><rect x="136" y="1130" width="336" height="380" rx="22"/></clipPath></defs><rect width="1600" height="1700" fill="white"/>${rect(28,28,1544,1644,'white',C.line,34)}<g font-family="Arial, Helvetica, sans-serif" fill="${C.ink}">${text('MY PRIVATE TEACHER',104,113,30,'font-weight="700" letter-spacing="3"')}<circle cx="1450" cy="101" r="24" fill="${C.gold}"/>${text(number,1450,112,27,'text-anchor="middle" font-weight="700"')}<path d="M104 158H1496" stroke="${C.line}" stroke-width="2"/><path d="M104 158H224" stroke="${C.purple}" stroke-width="7"/>${text(title,104,273,84,'font-weight="700" letter-spacing="-2"')}${text(subtitle,108,346,42,`fill="${C.muted}"`)}${body}<path d="M104 1588H1496" stroke="${C.line}" stroke-width="2"/>${text('SHORT A',104,1641,30,`fill="${C.muted}" font-weight="700" letter-spacing="2"`)}${text(id==='reading'?'Read with ordinary print.':'Original guided practice',1496,1641,28,`text-anchor="end" fill="${C.muted}"`)}</g></svg>`;}
await mkdir(dir,{recursive:true});
const apple=await data(path.join(dir,'illustrations/apple.png'),'image/png');
const mat=await data(path.join(dir,'illustrations/mat.png'),'image/png');
const map=await data(path.join(dir,'illustrations/map.png'),'image/png');
const mouth=await data(path.join(root,'src/assets/articulation/photos/short-a.webp'),'image/webp');
const shortA=PHONEME_ARTICULATION_CARDS.find(card=>card.id==='short-a');
if(!shortA)throw new Error('Missing existing short-a anatomy reference.');
const diagram='data:image/svg+xml;base64,'+Buffer.from(phonemeDiagramSvg(shortA)).toString('base64');
const sheets=[];
sheets.push(['sound-cue',page('sound-cue','1','Meet short a','Look. Listen. Say the sound.',440,
 rect(104,399,1392,640,C.pale,'#e8e0f5',30)+text('ă',440,914,500,'text-anchor="middle" font-weight="400" data-target="short-a"')+image(apple,815,421,576,580)+
 rect(104,1085,1392,450,'white',C.line,28)+image(mouth,136,1130,336,380,'clip-path="url(#mouth)"')+image(diagram,520,1150,330,330)+text('Open jaw.',922,1223,58,'font-weight="700"')+text('Lips unrounded.',922,1301,50)+text('Tongue low',922,1384,46,`fill="${C.muted}"`)+text('and forward.',922,1449,46,`fill="${C.muted}"`))]);
let boxes='';
for(const[i,letter]of['m','a','t'].entries()){boxes+=rect(398+i*278,653,248,230,i===1?C.pale:'white',i===1?'#bda5e8':C.line,22)+text(letter,522+i*278,817,150,`text-anchor="middle" data-target="sound-box-${i}"`);}
let words='';
for(const[i,word]of['măt','păt','săt','săp','tăp','măp'].entries()){
 const col=i%2,row=Math.floor(i/2),x=450+col*700,y=1110+row*190;
 words+=text(word,x,y,150,`text-anchor="middle" data-target="marked-word"`);
}
sheets.push(['word-work',page('word-work','2','Mark and read','The curve above a marks a short vowel.',150,
 text('măt',800,585,240,'text-anchor="middle" data-target="model-word"')+boxes+`<path d="M104 952H1496" stroke="${C.line}" stroke-width="2"/>`+words)]);
const lesson=JSON.parse(await readFile(path.join(dir,'lesson.json'),'utf8'));
sheets.push(['reading',page('reading','3','Pat','Read. Then read again.',128,
 lesson.readingLines.map((line,i)=>text(line,151,565+i*258,128,'data-target="passage-line"')).join(''))]);
sheets.push(['meaning',page('meaning','4','Words and meaning','Read the word. Match it to the picture.',200,
 rect(104,412,1392,510,'white',C.line,28)+image(mat,145,438,670,450)+text('mat',1126,736,200,'text-anchor="middle" data-target="meaning-word"')+
 rect(104,970,1392,535,'white',C.line,28)+image(map,145,1007,670,450)+text('map',1126,1311,200,'text-anchor="middle" data-target="meaning-word"'))]);
const browser=await chromium.launch({channel:'chrome'});const results=[];
try{
 const p=await browser.newPage({viewport:{width:1600,height:1700},deviceScaleFactor:1});
 for(const[id,svg]of sheets){
  await writeFile(path.join(dir,id+'.svg'),svg+'\n');
  await p.setContent(`<html><head><style>html,body{margin:0;background:white}svg{display:block}</style></head><body>${svg}</body></html>`);
  await p.evaluate(()=>document.fonts.ready);
  await p.evaluate(async()=>{for(const img of document.querySelectorAll('svg image')){const image=new Image();image.src=img.getAttribute('href');await image.decode();}});
  const qa=await p.evaluate(()=>{
   const bounds=[...document.querySelectorAll('svg text')].map(el=>({text:el.textContent,...(()=>{const b=el.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};})()}));
   return{targets:[...document.querySelectorAll('[data-target]')].map(el=>({text:el.textContent,font:Number(el.getAttribute('font-size'))})),outOfBounds:bounds.filter(b=>b.x<40||b.y<30||b.x+b.w>1560||b.y+b.h>1660)};
  });
  if(qa.outOfBounds.length)throw new Error(`${id} has clipped text: ${JSON.stringify(qa.outOfBounds)}`);
  const bytes=await p.screenshot({type:'png',animations:'disabled'});
  if(bytes.length>1_500_000)throw new Error(`${id} exceeds room image budget: ${bytes.length}`);
  await writeFile(path.join(dir,id+'.png'),bytes);
  results.push({id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...qa});
 }
 await writeFile(path.join(dir,'render-check.json'),JSON.stringify({renderedAt:new Date().toISOString(),size:{w:1600,h:1700},sheets:results},null,2)+'\n');
 console.log(JSON.stringify(results.map(({id,bytes,outOfBounds})=>({id,bytes,outOfBounds}))))
}finally{await browser.close();}
