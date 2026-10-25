import {describe,expect,it} from 'vitest';
import {automaticWallDirectionKey,automaticWallVisible} from './automaticWalls.js';

describe('automatic walls at home entrance',()=>{
 it('keeps a stable classification throughout the same camera quadrant',()=>{
   const a=automaticWallDirectionKey(8,12);
   expect(automaticWallDirectionKey(80,120)).toBe(a);
   expect(automaticWallDirectionKey(8.01,11.99)).toBe(a);
   expect(automaticWallDirectionKey(-8,12)).not.toBe(a);
 });
 it('preserves the original wall-visibility threshold and dead band',()=>{
   const edge='left';
   const before=automaticWallDirectionKey(.079,1);
   const beyond=automaticWallDirectionKey(.081,1);
   expect(before).not.toBe(beyond);
   expect(automaticWallVisible(edge,.079,1,false)).toBe(false);
   expect(automaticWallVisible(edge,.081,1,false)).toBe(true);
   expect(automaticWallDirectionKey(0,10)).toBe(automaticWallDirectionKey(0,1));
 });
});
