import {describe,expect,it} from 'vitest';
import {renderAutonomyCrossDayHint} from './amsgAutonomyPolicy';
import {verifiedXhsToolSucceeded} from './amsgVerifiedXhs';
import {renderFirePack,FIRE_PACK_VERSION,type AmsgFirePack} from './amsgFirePack';
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
  it('only the automatic daily cloud wake receives the cross-day caution, not manual reminders or private chat',()=>{
    const now=Date.parse('2026-10-29T12:00:00Z');
    const pack:AmsgFirePack={v:FIRE_PACK_VERSION,builtAt:now-3*86400000,
      template:'角色自身原设保持不变',pendingTasks:[],scene:{
        charId:'role-1',dateKey:'2026-10-25',schedule:{
          slots:[{startTime:'19:00',activity:'在办公室加班'}],
        },songPool:[],
      },selfScheduleEnabled:true,lastUserMessageAt:null,
      tzId:'Asia/Shanghai',userTzId:'Asia/Shanghai',targetName:'用户',
    };
    const wake=renderFirePack(pack,now,'自主联系',{autonomyWake:true});
    const manual=renderFirePack(pack,now,'用户指定的提醒');
    expect(wake).toContain('角色自身原设保持不变');
    expect(wake).toContain('今天没有从角色手机确认');
    expect(wake).not.toContain('你正在在办公室加班');
    expect(manual).not.toContain('【自主联系：手机离线后的日程可信度】');
    expect(renderFirePack({...pack,scene:null},now,'自主联系',{autonomyWake:true})).toContain('[[SILENT]]');
    expect(renderFirePack({...pack,scene:{...pack.scene!,dateKey:'2026-10-29'}},now,'自主联系',{autonomyWake:true}))
      .not.toContain('【自主联系：手机离线后的日程可信度】');
  });
  it('never records a failed tool as an actual XHS life event',()=>{
    expect(verifiedXhsToolSucceeded('xhs_search',{ok:false,reason:'no_results'})).toBe(false);
  });
});