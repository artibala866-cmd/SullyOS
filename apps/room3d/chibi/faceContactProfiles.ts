import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {BLANK_SCALE,BLANK_HEAD_SCALE,fitBlankHeadY} from './blankBody';
import {lipWorld} from './headContactIK';

/**
 * Face anchors for future interactions. This does not replace the approved
 * kissing solver. All positions are in the original blank-body source frame
 * and follow the same height/head-size deformation as the existing lips.
 * Cheek names refer to the local head X axis (negative / positive).
 */
export type FaceContactPoint='mouth'|'forehead'|'nose'|'leftCheek'|'rightCheek';
type SourcePoint=readonly [number,number,number];
const sources:Readonly<Record<FaceContactPoint,SourcePoint>>={
 mouth:[0,.235,.132],
 forehead:[0,.365,.112],
 nose:[0,.290,.152],
 leftCheek:[-.093,.269,.115],
 rightCheek:[.093,.269,.115],
};

export type FaceContactRecipe={
 from:FaceContactPoint;
 to:FaceContactPoint;
 enter:readonly [number,number];
 exit?:readonly [number,number];
 tolerance:number;
};
/** Future templates only: these do not register any selectable motion. */
export const faceContactRecipes:Readonly<Record<string,FaceContactRecipe>>={
 foreheadTouch:{from:'forehead',to:'forehead',enter:[0,.4],tolerance:.07},
 foreheadKiss:{from:'mouth',to:'forehead',enter:[0,.4],tolerance:.07},
 cheekKissLeft:{from:'mouth',to:'leftCheek',enter:[0,.4],tolerance:.07},
 cheekKissRight:{from:'mouth',to:'rightCheek',enter:[0,.4],tolerance:.07},
 noseTouch:{from:'nose',to:'nose',enter:[0,.4],tolerance:.06},
};

type AnchorCache={height:number;size:number;points:Partial<Record<FaceContactPoint,T.Vector3>>};
const anchorCache=new WeakMap<object,AnchorCache>();

/**
 * Resolve an anatomical landmark after the body is posed. Local anchor data
 * is computed lazily per rig (or when its proportions change); there is no
 * animation scan, mesh collision check or IK solver allocated here.
 */
export function faceContactWorld(v:ChibiVisitor,point:FaceContactPoint,out=new T.Vector3()):T.Vector3|null{
 const rig=v.rig;
 if(!rig)return null;
 // Preserve the existing approved lip computation exactly for mouth actions.
 if(point==='mouth')return out.copy(lipWorld(v));
 const head=rig.bones.head;
 const index=rig.skeleton.bones.indexOf(head);
 const inverse=index>=0?rig.skeleton.boneInverses[index]:undefined;
 if(!inverse)return null;
 const height=rig.bodyHeight,size=(rig.mesh.geometry.userData.headSize as number|undefined)??1;
 let entry=anchorCache.get(rig);
 if(!entry||entry.height!==height||entry.size!==size){
  entry={height,size,points:{}};
  anchorCache.set(rig,entry);
 }
 let local=entry.points[point];
 if(!local){
  const [x,y,z]=sources[point];
  local=new T.Vector3(
   x*BLANK_SCALE*BLANK_HEAD_SCALE.x*size,
   fitBlankHeadY((y+.5)*BLANK_SCALE,{bodyHeight:height,headSize:size}),
   z*BLANK_SCALE*BLANK_HEAD_SCALE.z*size
  ).applyMatrix4(inverse);
  entry.points[point]=local;
 }
 v.root.updateWorldMatrix(true,true);
 return out.copy(local).applyMatrix4(head.matrixWorld);
}

/** Optional, on-demand contact diagnostic. Do not call every idle frame. */
export function faceContactError(
 initiator:ChibiVisitor,recipient:ChibiVisitor,recipe:FaceContactRecipe
){
 const source=faceContactWorld(initiator,recipe.from);
 const target=faceContactWorld(recipient,recipe.to);
 if(!source||!target)return null;
 const error=source.distanceTo(target);
 return {error,reached:error<=recipe.tolerance};
}

export function faceContactEnvelope(recipe:FaceContactRecipe,time:number){
 if(!Number.isFinite(time))return 0;
 const enter=T.MathUtils.smootherstep(time,recipe.enter[0],recipe.enter[1]);
 return enter*(recipe.exit?1-T.MathUtils.smootherstep(time,recipe.exit[0],recipe.exit[1]):1);
}
