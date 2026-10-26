import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {captureLegSupport,restoreLegSupport} from './legContactIK';

/**
 * Shared standing-pair height adapter. No distinction between User / Char or
 * initiator / recipient: the actual posed, world-scaled head height decides.
 *
 * Run AFTER the authored/idle base pose and BEFORE any hand/head contact IK.
 * Never write the navigation root position; only the existing pose skeleton
 * and motionBody (through translatePose) may be adjusted.
 */
export type HeightAdaptationMode='gaze'|'contact'|'headReach'|'none';
export type HeightAdaptationOptions={
 mode:HeightAdaptationMode;
 weight:number;
 /** Head-reach actions use the initiator index to detect an unreachable crown. */
 actorIndex?:0|1;
};
export type StandingHeightPlan=Readonly<{
 tallIndex:0|1;
 shortIndex:0|1;
 gap:number;
 crouch:number;
 bow:number;
 shortLook:number;
 tallLook:number;
 neededDrop:number;
 reachDeficit:number;
}>;
const clamp=T.MathUtils.clamp;
const smooth=T.MathUtils.smootherstep;
const FLOOR_BONES=['L_foot','R_foot','L_toe','R_toe'] as const;
const vec=()=>new T.Vector3();
function crown(v:ChibiVisitor){return v.getHeadTopWorldPosition();}
function footFloor(v:ChibiVisitor):number|null{
 if(!v.rig)return null;
 v.root.updateWorldMatrix(true,true);
 return Math.min(...FLOOR_BONES.map(n=>v.rig!.bones[n].getWorldPosition(vec()).y));
}
function shoulder(v:ChibiVisitor,side:'L'|'R'){
 return v.rig?.bones[side+'_upperArm']?.getWorldPosition(vec())??null;
}
function armLength(v:ChibiVisitor,side:'L'|'R'){
 const bones=v.rig?.bones;
 if(!bones)return null;
 const a=bones[side+'_upperArm'],b=bones[side+'_forearm'],c=bones[side+'_hand'];
 if(!a||!b||!c)return null;
 return a.getWorldPosition(vec()).distanceTo(b.getWorldPosition(vec()))+
  b.getWorldPosition(vec()).distanceTo(c.getWorldPosition(vec()));
}
export function standingHeightPlan(
 heights:readonly [number,number],
 mode:HeightAdaptationMode,
 reachDeficit=0
):StandingHeightPlan{
 const tallIndex:0|1=heights[0]>=heights[1]?0:1;
 const shortIndex:0|1=tallIndex===0?1:0;
 const gap=Number.isFinite(heights[0])&&Number.isFinite(heights[1])?
  Math.abs(heights[0]-heights[1]):0;
 const active=mode==='none'?0:smooth(gap,.12,.34);
 const effort=mode==='headReach'?1:mode==='contact'?.68:.35;
 // Deficit is measured from the actual short actor's shoulder to the target
 // head. It can increase the tall actor's bow/crouch (but never teleport them).
 const neededDrop=clamp(Math.max(gap*(mode==='headReach'?.78:mode==='contact'?.54:.3),
  mode==='headReach'?reachDeficit*.96:0),0,mode==='headReach'?.88:.44)*active;
 const crouch=clamp((neededDrop*.95+.10*active)*1.6,0,mode==='headReach'?1.20:.75)*effort;
 const bow=clamp((neededDrop*.56+.07*active),0,mode==='headReach'?.48:.29)*effort;
 return {
  tallIndex,shortIndex,gap,crouch,bow,
  shortLook:clamp(gap*.34,0,.31)*active,
  tallLook:clamp(gap*.29,0,.30)*active,
  neededDrop,reachDeficit,
 };
}
/** Optional reach measurement for the head-touch template; performed only for
 * active paired contact, never in an idle render tick. */
export function headReachDeficit(both:readonly [ChibiVisitor,ChibiVisitor],actorIndex:0|1){
 const actor=both[actorIndex],other=both[1-actorIndex];
 if(!actor.rig||!other.rig)return 0;
 actor.root.updateWorldMatrix(true,true);
 const goal=crown(other);
 const possible=(['L','R'] as const).map(side=>{
  const start=shoulder(actor,side),length=armLength(actor,side);
  return start&&length?start.distanceTo(goal)-length*.93:Infinity;
 });
 return Math.max(0,Math.min(...possible));
}
export function applyStandingHeightAdaptation(
 both:readonly [ChibiVisitor,ChibiVisitor],
 options:HeightAdaptationOptions
):StandingHeightPlan|null{
 if(options.mode==='none'||!both[0]?.rig||!both[1]?.rig||
  !Number.isFinite(options.weight)||options.weight<=0)return null;
 const heads:[number,number]=[crown(both[0]).y,crown(both[1]).y];
 const deficit=options.mode==='headReach'&&options.actorIndex!==undefined?
  headReachDeficit(both,options.actorIndex):0;
 const plan=standingHeightPlan(heads,options.mode,deficit);
 const w=clamp(options.weight,0,1);
 if(plan.gap<.12)return plan;
 const tall=both[plan.tallIndex],short=both[plan.shortIndex];
 const rig=tall.rig!,bones=rig.bones;
 const support=captureLegSupport(tall);
 const knee=plan.crouch*w;
 if(knee>.0001){
  // One standing-ground solver for head pats, embraces and carried poses;
  // changing knee rotations must not move the planted toes or bone lengths.
  const r=(angle:number)=>new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),angle);
  for(const side of ['L','R'] as const){
   bones[side+'_thigh'].quaternion.multiply(r(-knee));
   bones[side+'_shin'].quaternion.multiply(r(knee*1.88));
   bones[side+'_foot'].quaternion.multiply(r(-knee*.88));
  }
  tall.root.updateWorldMatrix(true,true);
  restoreLegSupport(tall,support,true,.82);
 }
 // Upper-body bow shifts the taller actor's face/shoulders forward and lower.
 const pitch=plan.bow*w;
 if(pitch>.0001){
  bones.spine.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(pitch*.55,0,0)));
  bones.chest.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(pitch*.75,0,0)));
 }
 tall.root.updateWorldMatrix(true,true);
 // Natural mutual eye line: tall tilts DOWN, short looks UP. The actual
 // world-space positions, not actor IDs nor unscaled bodyHeight, drive signs.
 const lowerHead=tall.rig!.bones.head,higherHead=short.rig!.bones.head;
 const shortPitch=plan.shortLook*w;
 const tallPitch=plan.tallLook*w;
 if(shortPitch>.0001){
  short.rig!.bones.neck.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(-shortPitch*.4,0,0)));
  higherHead.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(-shortPitch*.6,0,0)));
 }
 if(tallPitch>.0001){
  bones.neck.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(tallPitch*.4,0,0)));
  lowerHead.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(tallPitch*.6,0,0)));
 }
 for(const v of both)v.root.updateWorldMatrix(true,true);
 return plan;
}
