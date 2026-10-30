import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import {studentProjection} from '../shared/lessons.js';
import {validateStarterTemplate} from '../server/starterLesson.js';
const folder=fileURLToPath(new URL('../content/lessons/short-a-teaching-pack/',import.meta.url));
const lesson=JSON.parse(readFileSync(folder+'lesson.json','utf8'));
const source=id=>readFileSync(folder+id+'.svg','utf8');
const targets=(svg,role)=>[...svg.matchAll(new RegExp(`<text[^>]*data-target="${role}"[^>]*>([^<]+)<\\/text>`,'g'))].map(match=>match[1]);
describe('original short-a teaching pack content',()=>{
 it('prints one breve above each guided vowel without changing the practiced spellings',()=>{
  const words=targets(source('word-work'),'marked-word');
  expect(words).toHaveLength(lesson.wordChain.length);
  expect(words.map(word=>word.normalize('NFD').replace(/\p{M}/gu,''))).toEqual(lesson.wordChain);
  for(const word of words){expect([...word].filter(letter=>letter==='ă')).toHaveLength(1);expect(word).not.toMatch(/[āēīōū\/]/u);}
 });
 it('keeps connected reading in ordinary print with only the stated taught letters',()=>{
  const lines=targets(source('reading'),'passage-line');expect(lines).toEqual(lesson.readingLines);
  const letters=new Set(lesson.knownLetters);
  for(const line of lines){expect(line).not.toMatch(/\p{M}|[ăā]/u);for(const letter of line.toLowerCase().match(/[a-z]/g)||[])expect(letters.has(letter)).toBe(true);expect(line.toLowerCase()).not.toMatch(/am|an|all/);}
 });
 it('uses separate source sheets and keeps dictation answers off every student projection',()=>{
  const data=new Map(lesson.assets.map(asset=>[asset.id,readFileSync(folder+asset.file)]));
  const validated=validateStarterTemplate(lesson,data);expect(validated.content.activities).toHaveLength(7);
  const dictation=lesson.activities.find(activity=>activity.type==='dictation');
  expect(studentProjection(dictation)).toEqual({type:'dictation',letters:'',cardIds:[],assetIds:[],boxes:3});
  expect(lesson.activities.filter(activity=>activity.type==='read').map(activity=>activity.assetIds)).toEqual([['sound-cue'],['word-work'],['reading'],['meaning']]);
 });
 it('contains the requested original picture sources and no clipped target text',()=>{
  const provenance=JSON.parse(readFileSync(folder+'illustrations/generation-provenance.json','utf8'));
  expect(JSON.stringify(provenance)).toContain('image_gen');
  for(const id of ['apple','mat','map'])expect(readFileSync(folder+'illustrations/'+id+'.png').subarray(1,4).toString()).toBe('PNG');
  const report=JSON.parse(readFileSync(folder+'render-check.json','utf8'));
  expect(report.sheets.map(sheet=>sheet.id)).toEqual(lesson.assets.map(asset=>asset.id));
  for(const sheet of report.sheets){expect(sheet.outOfBounds).toEqual([]);expect(sheet.bytes).toBeLessThanOrEqual(1_500_000);}
 });
});
