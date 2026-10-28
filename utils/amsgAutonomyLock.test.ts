import {describe,it,expect} from 'vitest';
import {withAutonomyWakeLock} from './amsgAutonomyLock';
describe('AMSG2 same-origin exclusive scheduling',()=>{
 it('serializes the entire remote-read / create lifecycle when Web Locks exists',async()=>{
   const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
   let queued=Promise.resolve();const trace:string[]=[];
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{
      locks:{request:(_key:string,_opts:any,callback:()=>Promise<any>)=>{
         const job=queued.then(callback,callback);
         queued=job.then(()=>undefined,()=>undefined);
         return job;
      }},
   }});
   try{
     const job=async(id:string)=>{
       trace.push('start '+id);
       await Promise.resolve();
       trace.push('end '+id);
       return id;
     };
     expect(await Promise.all([
       withAutonomyWakeLock('c',()=>job('A')),withAutonomyWakeLock('c',()=>job('B')),
     ])).toEqual(['A','B']);
     expect(trace).toEqual(['start A','end A','start B','end B']);
   }finally{
     if(previous)Object.defineProperty(globalThis,'navigator',previous);
     else delete (globalThis as any).navigator;
   }
 });
 it('local fallback never runs two overlapping mutations for the same character',async()=>{
   const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
   let finish!:()=>void;let count=0;
   const gate=new Promise<void>(resolve=>{finish=resolve});
   try{
     const first=withAutonomyWakeLock('fallback',async()=>{count++;await gate;return 1});
     const second=await withAutonomyWakeLock('fallback',async()=>{count++;return 2});
     expect(second).toBeUndefined();expect(count).toBe(1);
     finish();expect(await first).toBe(1);
     expect(await withAutonomyWakeLock('fallback',async()=>3)).toBe(3);
   }finally{
     if(old)Object.defineProperty(globalThis,'navigator',old);
     else delete (globalThis as any).navigator;
   }
 });
});

import {autonomyWakeUuid} from './amsgAutonomyIdentity';
describe('server-side D1-unique autonomous contact identities',()=>{
 it('computes one valid UUID on every device for the same owner and slot',()=>{
   const id=autonomyWakeUuid('account-1','character-1','day');
   expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
   expect(autonomyWakeUuid('account-1','character-1','day')).toBe(id);
 });
 it('different owners and slots cannot be mistaken for the same recurring task',()=>{
   const id=autonomyWakeUuid('account-1','character-1','day');
   expect(autonomyWakeUuid('account-2','character-1','day')).not.toBe(id);
   expect(autonomyWakeUuid('account-1','character-2','day')).not.toBe(id);
   expect(autonomyWakeUuid('account-1','character-1','evening')).not.toBe(id);
 });
});
