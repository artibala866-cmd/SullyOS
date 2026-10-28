import {describe,expect,it} from 'vitest';
import {extractVerifiedXhsActions,verifiedXhsToolSucceeded} from './amsgVerifiedXhs';
import {eventsForVerifiedXhsActions} from './amsgPhoneEvent';
describe('confirmed cloud XHS activity only',()=>{
  it('requires structured actual success, not no-results, unreachable, or AI text',()=>{
    expect(verifiedXhsToolSucceeded('xhs_search',{ok:true,notes:['confirmed']})).toBe(true);
    expect(verifiedXhsToolSucceeded('xhs_search',{ok:false,reason:'no_results'})).toBe(false);
    expect(verifiedXhsToolSucceeded('xhs_browse',{ok:false,reason:'unreachable'})).toBe(false);
    expect(verifiedXhsToolSucceeded('xhs_detail','I saw it!')).toBe(false);
    expect(verifiedXhsToolSucceeded('web_search',{ok:true})).toBe(false);
  });
 it('excludes failed and duplicated actions, private keywords and unrelated tools',()=>{
  expect(extractVerifiedXhsActions([
   {name:'xhs_search',fingerprint:'secret-keyword',ran:true},
   {name:'xhs_browse',fingerprint:'browse',ran:false},
   {name:'xhs_detail',fingerprint:'note',ran:true},
   {name:'xhs_search',fingerprint:'second',ran:true},
   {name:'web_search',fingerprint:'other',ran:true},
  ])).toEqual(['xhs_search','xhs_detail']);
 });
 it('records only successful scheduled delivery metadata, never AI prose',()=>{
  const base={charId:'char',messageId:'sent-123',source:'scheduled',messageType:'auto',
    instant:false,timestamp:100000,verifiedActions:['xhs_search','xhs_detail','xhs_search','invented']};
  const records=eventsForVerifiedXhsActions(base);
  expect(records).toHaveLength(2);
  expect(records.map(x=>x.kind)).toEqual(['browser-search','browser-search']);
  expect(records.every(x=>x.source==='xiaohongshu'&&x.id.startsWith('amsg2:verified-xhs:'))).toBe(true);
  expect(eventsForVerifiedXhsActions({...base,source:'pending'})).toEqual([]);
  expect(eventsForVerifiedXhsActions({...base,instant:true})).toEqual([]);
  expect(eventsForVerifiedXhsActions({...base,verifiedActions:undefined})).toEqual([]);
  expect(eventsForVerifiedXhsActions(base)).toEqual(records);
 });
});
