import {describe,expect,it} from 'vitest';
import {renderAutonomyCrossDayHint} from './amsgAutonomyPolicy';
import {verifiedXhsToolSucceeded} from './amsgVerifiedXhs';
describe('cross-day cloud contact safety',()=>{
  it('does not reuse a yesterday schedule as if it was today',()=>{
    const at=Date.parse('2026-10-29T12:00:00Z');
    const scene:any={dateKey:'2026-10-25',schedule:{slots:[{startTime:'19:00',activity:'加班'}]}};
    const msg=renderAutonomyCrossDayHint(scene,at,'Asia/Shanghai');
    expect(msg).toContain('今天没有从角色手机确认');
    expect(msg).toContain('2026-10-25');
    expect(msg).toContain('[[SILENT]]');
    expect(msg).not.toContain('你正在加班');
  });
  it('never records a failed tool as an actual XHS life event',()=>{
    expect(verifiedXhsToolSucceeded('xhs_search',{ok:false,reason:'no_results'})).toBe(false);
  });
});