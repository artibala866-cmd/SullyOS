import {afterEach,describe,expect,it,vi} from 'vitest';
import {warmHomeResidentForEntry} from './entryWarmup';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('3D house entry shader warmup',()=>{
 it('finishes immediately after successful GPU preparation',async()=>{
  const warm=vi.fn(async()=>{});
  await warmHomeResidentForEntry({warmResidentShaders:warm},1000);
  expect(warm).toHaveBeenCalledTimes(1);
 });
 it('never holds entry indefinitely if GPU shader compilation stalls',async()=>{
  vi.useFakeTimers();
  const warm=vi.fn(()=>new Promise<void>(()=>{}));
  const promise=warmHomeResidentForEntry({warmResidentShaders:warm},120);
  await vi.advanceTimersByTimeAsync(121);
  await expect(promise).resolves.toBeUndefined();
  expect(warm).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
 });
 it('tolerates renderer errors and missing optional prewarm method',async()=>{
  await expect(warmHomeResidentForEntry({warmResidentShaders:async()=>{throw Error('driver');}})).resolves.toBeUndefined();
  await expect(warmHomeResidentForEntry({})).resolves.toBeUndefined();
 });
});
