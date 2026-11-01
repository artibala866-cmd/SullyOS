import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {calculateToolTracePlacement} from '../components/chat/ChatToolTrace';

const rect=(left:number,top:number,width:number,bottom=top+14)=>({left,top,width,bottom});
describe('tool trace stays in normal flow across built-in whiteboxes',()=>{
 it.each([
  ['small Friend Rain bubble',320,54,112,129],
  ['compact QQ bubble',360,38,88,98],
  ['centered card',390,103,150,178],
  ['wide iOS6 bubble',430,57,184,203],
 ])('%s: follows the actual message column and clears absolute timestamp',
 (_name,width,columnX,rowTop,stampBottom)=>{
  const result=calculateToolTracePlacement(rect(0,rowTop,width),{left:columnX},{bottom:stampBottom});
  expect(result).toEqual({paddingLeft:columnX,paddingTop:stampBottom-rowTop+4});
  expect(rowTop+result.paddingTop).toBeGreaterThan(stampBottom);
 });
 it('does not shift upward if the message has no timestamp or the timestamp ends above the tool trace',()=>{
  expect(calculateToolTracePlacement(rect(0,90,320),{left:56},null)).toEqual({paddingLeft:56,paddingTop:0});
  expect(calculateToolTracePlacement(rect(0,110,360),{left:48},{bottom:101})).toEqual({paddingLeft:48,paddingTop:0});
 });
 it('keeps long tool names inside narrow mobile screens and falls back when modules have no bubble',()=>{
  expect(calculateToolTracePlacement(rect(0,110,320),{left:300},null).paddingLeft).toBe(240);
  expect(calculateToolTracePlacement(rect(0,110,320),null,null).paddingLeft).toBe(48);
  expect(calculateToolTracePlacement(rect(0,110,60),{left:50},null).paddingLeft).toBe(0);
 });
 it('is wired only to the actual trace, with no spacing-specific negative offsets',()=>{
  const chat=readFileSync(resolve(process.cwd(),'apps/Chat.tsx'),'utf8');
  expect(chat).toContain('<ChatToolTrace text={toolTraceText} />');
  expect(chat).not.toContain('toolTracePullClass');
  expect(chat).toContain('const showToolTrace = !!toolTraceText');
  expect(chat).toContain('selectionMode\n                        ? \'\'');
 });
});
