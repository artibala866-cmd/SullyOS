import * as T from 'three';
import type {MotionCapability} from './motionCapabilities';

export type PairedHandProfile={
 kind:'pairedHands';
 capabilities:readonly MotionCapability[];
 /** Shared clock (seconds after approach). */
 enter:readonly [number,number];
 exit?:readonly [number,number];
 curl:number;
 /** Sample authored contact poses once per clip to select the hand pair. */
 pairing:'sampledClosest';
};
export type BodyTouchProfile={
 kind:'bodyTouch';
 capabilities:readonly MotionCapability[];
 targetBones:readonly ['L_upperArm','R_upperArm'];
 near:number;
 far:number;
};
export type MotionContactProfile=PairedHandProfile|BodyTouchProfile;

/**
 * First-phase migration only. The rest of the 43 selected motions continue
 * through the unchanged legacy contact path.
 *
 * Avoid a new generic solver: profiles describe WHEN and WHERE to apply the
 * existing cached hand IK. No motion is preloaded by this module.
 */
export const motionContactProfiles:Readonly<Record<string,MotionContactProfile>>={
 'cmu-20_10':{kind:'pairedHands',capabilities:['handContact','pairedSync'],pairing:'sampledClosest',enter:[.15,.85],curl:.38},
 'cmu-18_03':{kind:'pairedHands',capabilities:['handContact','pairedSync'],pairing:'sampledClosest',enter:[.12,.55],curl:.45},
 'cmu-20_12':{kind:'pairedHands',capabilities:['handContact','pairedSync'],pairing:'sampledClosest',enter:[.10,.35],exit:[.65,1.10],curl:.12},
 'cmu-22_07':{kind:'bodyTouch',capabilities:['bodyContact'],targetBones:['L_upperArm','R_upperArm'],near:.47,far:.64},
 'cmu-22_05':{kind:'bodyTouch',capabilities:['bodyContact'],targetBones:['L_upperArm','R_upperArm'],near:.47,far:.64},
 'cmu-22_04':{kind:'bodyTouch',capabilities:['bodyContact'],targetBones:['L_upperArm','R_upperArm'],near:.47,far:.64},
 'cmu-22_09':{kind:'bodyTouch',capabilities:['bodyContact'],targetBones:['L_upperArm','R_upperArm'],near:.47,far:.64},
 'cmu-22_03':{kind:'bodyTouch',capabilities:['bodyContact'],targetBones:['L_upperArm','R_upperArm'],near:.47,far:.64},
};
export function motionContactProfile(id:string):MotionContactProfile|undefined{
 return motionContactProfiles[id];
}
export function contactEnvelope(profile:PairedHandProfile,time:number){
 if(!Number.isFinite(time))return 0;
 const enter=T.MathUtils.smootherstep(time,profile.enter[0],profile.enter[1]);
 return enter*(profile.exit?1-T.MathUtils.smootherstep(time,profile.exit[0],profile.exit[1]):1);
}
