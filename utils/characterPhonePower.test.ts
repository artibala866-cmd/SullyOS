import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {readPhonePower} from './characterPhonePower';

const memory=new Map<string,string>();
const storage={
  getItem:(key:string)=>memory.get(key)??null,
  setItem:(key:string,value:string)=>{memory.set(key,value);},
  removeItem:(key:string)=>{memory.delete(key);},
  clear:()=>memory.clear(),
};
const at=(day:number,hour:number,minute=0)=>new Date(2026,10,day,hour,minute,0,0).getTime();
const key=(id:string)=>'sully_char_phone_power_v1:'+id;

beforeEach(()=>{memory.clear();vi.stubGlobal('localStorage',storage);});
afterEach(()=>vi.unstubAllGlobals());

describe('character virtual phone power',()=>{
  it('is deterministic across repeated status-bar reads and preserves the same model',()=>{
    const now=at(5,16,8);
    const first=readPhonePower('character-a',now);
    expect(first.level).toBeGreaterThanOrEqual(55);
    expect(first.level).toBeLessThanOrEqual(85);
    expect(first.charging).toBe(false);
    expect(readPhonePower('character-a',now)).toEqual(first);
    expect(readPhonePower('character-a',now+60_000).model).toBe(first.model);
  });

  it('drains over elapsed hours, not number of reads; maintains fractional minutes',()=>{
    const begin=at(5,10);
    memory.set(key('many'),JSON.stringify({level:75,updatedAt:begin,charging:false,model:'Pixel 9'}));
    memory.set(key('once'),JSON.stringify({level:75,updatedAt:begin,charging:false,model:'Pixel 9'}));
    for(let minute=1;minute<=120;minute++)readPhonePower('many',begin+minute*60_000);
    const repeated=readPhonePower('many',begin+120*60_000);
    const single=readPhonePower('once',begin+120*60_000);
    expect(repeated.level).toBeLessThan(75);
    expect(repeated.level).toBe(single.level);
    expect(repeated.charging).toBe(false);
    expect(single.level).toBe(69); // 3% per daytime hour
    expect(JSON.parse(memory.get(key('many'))!).preciseLevel).toBeCloseTo(69,5);
  });

  it('charges steadily at night and unplugs at 07:00 without random flips',()=>{
    const start=at(5,22,30);
    memory.set(key('night'),JSON.stringify({level:49,updatedAt:start,charging:false,model:'Xiaomi 14'}));
    const at23=readPhonePower('night',at(5,23,0));
    const at1=readPhonePower('night',at(6,1,0));
    const at6=readPhonePower('night',at(6,6,0));
    const at8=readPhonePower('night',at(6,8,0));
    expect(at23.charging).toBe(true);
    expect(at1.charging).toBe(true);
    expect(at1.level).toBeGreaterThan(at23.level);
    expect(at6.level).toBe(100);
    expect(at8.charging).toBe(false);
    expect(at8.level).toBeLessThanOrEqual(100);
    expect(at8.level).toBeGreaterThanOrEqual(96);
  });

  it('does not reset after a long absence and uses a capped catch-up window',()=>{
    const t=at(1,14);
    memory.set(key('return'),JSON.stringify({level:61,updatedAt:t,charging:false,model:'Galaxy S24'}));
    const later=readPhonePower('return',at(15,16));
    expect(later.level).toBeGreaterThan(0);
    expect(later.level).toBeLessThan(100);
    expect(later.charging).toBe(false);
    expect(later.model).toBe('Galaxy S24');
    expect(readPhonePower('return',at(15,16))).toEqual(later);
  });

  it('recharges critically low phones in the daytime until recovery and then drains again',()=>{
    const start=at(5,9);
    memory.set(key('low'),JSON.stringify({level:9,updatedAt:start,charging:false,model:'Pixel 9'}));
    const low=readPhonePower('low',start);
    expect(low.charging).toBe(true);
    const charging=readPhonePower('low',at(5,10));
    expect(charging.level).toBeGreaterThan(low.level);
    const recovered=readPhonePower('low',at(5,14));
    expect(recovered.charging).toBe(false);
    expect(recovered.level).toBeGreaterThanOrEqual(70);
    const later=readPhonePower('low',at(5,15));
    expect(later.level).toBeLessThan(recovered.level);
  });

  it('keeps legacy v1 character state and isolates different characters',()=>{
    const t=at(5,12);
    memory.set(key('old'),JSON.stringify({level:43,charging:true,updatedAt:t,model:'OPPO Find X7'}));
    memory.set(key('other'),JSON.stringify({level:86,charging:false,updatedAt:t,model:'iPhone 16 Pro'}));
    const old=readPhonePower('old',t+60_000);
    expect(old.level).toBe(43);
    expect(old.charging).toBe(false);
    expect(old.model).toBe('OPPO Find X7');
    expect(readPhonePower('other',t+60_000).level).toBe(86);
    expect(JSON.parse(memory.get(key('old'))!).preciseLevel).toBeGreaterThan(42);
  });

  it('ignores a backward clock jump instead of rewinding persisted power',()=>{
    const t=at(5,13);
    const current=readPhonePower('clock',t);
    const previous=readPhonePower('clock',t-3_600_000);
    expect(previous.level).toBe(current.level);
    expect(previous.updatedAt).toBe(current.updatedAt);
  });
});
