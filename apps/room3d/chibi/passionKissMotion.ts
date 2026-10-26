import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {settleLegContact} from './legContactIK';
import {surfaceLipLocal} from './headContactIK';
import {hugOutsideTarget,keepHugArmOutside} from './hugArmClearance';
import {contactSolver,resolveBodyContact,bodyContactAnchor,palmContactReport} from './socialContact';

export const PASSION_KISS_ID='home-passion-kiss';
export const PASSION_KISS_SECONDS=12;
const s=T.MathUtils.smootherstep;
const envelope=(t:number,a:number,b:number,c:number,d:number)=>s(t,a,b)*(1-s(t,c,d));
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
export function passionKissPhase(t:number){
 const lead=envelope(t,.65,1.2,10,10.55),trail=envelope(t,1.2,1.8,10.55,11.1);
 return {lead,trail,step:(lead+trail)/2,height:envelope(t,0,1.7,10.8,12),
  // A single breath between kisses, not a repeating nod oscillator.
  kiss:envelope(t,.65,2.5,7.5,8.6)*(1-.22*envelope(t,4.5,4.95,5.2,5.8)),
  hands:envelope(t,.2,2,9.6,11.6),response:s(t,.65,2),
  squeeze:envelope(t,2.8,3.6,4.1,4.6)+.6*envelope(t,8.8,9.4,9.8,10.3),
  stroke:envelope(t,5.8,6.5,7,7.6),linger:envelope(t,8,8.8,9.5,10.5)};
}
type Resident={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
export type PassionKissPlan={roots:T.Vector3[];retreat:T.Vector3;headings:T.Quaternion[];mouths:T.Vector3[];knees:number[];chins:number[];error:number};
/** Joint-only reach. Pose translation compensates measured leg shortening;
 * navigation roots and both complete foot transforms remain planted. */
function articulate(v:ChibiVisitor,knee:number,height:number,lean:number,linger=0,chin=0){
 const b=v.rig!.bones;v.root.updateWorldMatrix(true,true);
 const before=b.L_toe.getWorldPosition(new T.Vector3());
 for(const side of ['L','R']){
  b[side+'_thigh'].quaternion.multiply(q(-knee*height));
  b[side+'_shin'].quaternion.multiply(q(2*knee*height));
  b[side+'_foot'].quaternion.multiply(q(-knee*height));
 }
 b.spine.quaternion.multiply(q(.03*lean));b.chest.quaternion.multiply(q(.03*lean));
 // Counter-pitch keeps lips facing each other without stretching a neck.
 // Same local roll on opposing roots produces opposite world head tilts.
 b.head.quaternion.multiply(q(-.06*lean+chin*height+.025*linger,0,.10*lean));
 v.root.updateWorldMatrix(true,true);
 v.translatePose(before.sub(b.L_toe.getWorldPosition(new T.Vector3())));
}
export function planPassionKiss(a:ChibiVisitor,b:ChibiVisitor):PassionKissPlan{
 const pair=[a,b],old=pair.map(v=>v.root.quaternion.clone());
 const forward=new T.Vector3(0,0,1).applyQuaternion(old[1]).setY(0).normalize();
 const headings=[new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.atan2(-forward.x,-forward.z)),old[1].clone()];
 pair.forEach((v,i)=>{v.root.quaternion.copy(headings[i]);v.animate(0,'idle');});
 const mouths=pair.map(surfaceLipLocal),knees=[0,0];
 const headSize=Math.max(...pair.map(v=>(v.rig!.mesh.geometry.userData.headSize as number|undefined)??1));
 // A modest chin lift clears the broad lower face and brings shoulders
 // within reach for large-head proportions; stature and bone lengths stay fixed.
 const chin=T.MathUtils.clamp((headSize-1.1)/.3,0,1)*.27;
 const chins=[-chin,-chin];
 const trial=()=>pair.map((v,i)=>{v.animate(0,'idle');articulate(v,knees[i],1,1,0,chins[i]);return v.rig!.bones.head.localToWorld(mouths[i].clone());});
 let lips=trial();const tall=lips[0].y>lips[1].y?0:1;
 let lo=0,hi=1.5;
 for(let n=0;n<22;n++){knees[tall]=(lo+hi)/2;lips=trial();if(lips[tall].y>lips[1-tall].y)lo=knees[tall];else hi=knees[tall];}
 knees[tall]=(lo+hi)/2;lips=trial();
 const error=Math.abs(lips[0].y-lips[1].y);
 const roots=[a.root.position.clone().add(lips[1].clone().sub(lips[0]).setY(0)).addScaledVector(forward,.020),b.root.position.clone()];
 pair.forEach((v,i)=>{v.root.quaternion.copy(old[i]);v.animate(0,'idle');});
 return {roots,retreat:forward.clone().multiplyScalar(.32),headings,mouths,knees,chins,error};
}
export function posePassionKiss(both:Resident[],time:number,plan:PassionKissPlan){
 const p=passionKissPhase(time);
 both.forEach((r,i)=>articulate(r.visitor,plan.knees[i],p.height,p.kiss+.42*p.linger,p.linger,plan.chins[i]));
 // Two supported foot placements finish before contact; the next step is
 // after release. During both kisses no root or foot target follows the lips.
 const actor=both[0].visitor;
 for(const [i,side] of (['L','R'] as const).entries()){
  const progress=i===0?p.lead:p.trail;
  const target=actor.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()).addScaledVector(plan.retreat,p.step-progress);
  target.y+=Math.sin(Math.PI*progress)*.045;
  for(let pass=0;pass<4;pass++)settleLegContact(actor,side,target,1);
 }
 // Shoulder protraction adds natural reach without lengthening the arms.
 both.forEach(({visitor:v},i)=>{
  const reach=p.hands*(i===1?p.response:1);
  for(const side of ['L','R'])v.rig!.bones[side+'_clavicle'].quaternion.multiply(q(0,(side==='L'?-1:1)*.95*reach));
  v.root.updateWorldMatrix(true,true);
 });
 // Re-resolve palm anchors after BOTH torsos, avoiding target chase/order bias.
 const contacts=both.flatMap((owner,i)=>{
  const target=both[1-i].visitor,b=target.rig!.bones;
  return (['L','R'] as const).map(side=>{
   const waist=side==='R'||i===1;
   const bone=waist?b.chest:b.R_upperArm;
   const sign=side==='R'?1:-1;
   const offset=waist?new T.Vector3(sign*.32,-.40+.06*p.stroke,.38):new T.Vector3(0,-.08,.09);
   const anchor=bodyContactAnchor(bone,offset,new T.Vector3(0,1,0),new T.Vector3(sign*.6,0,.8));
   const contact=resolveBodyContact(anchor,side,.12+.12*p.squeeze);
   hugOutsideTarget(target,contact.point);
   return {owner,target,contact,weight:p.hands*(i===1?p.response:1)};
  });
 });
 for(const {owner,target,contact,weight} of contacts){
  owner.solver?.(contact,weight);
  if(owner.solver)keepHugArmOutside(owner.visitor,target,contact,weight);
 }
 return contacts.map(({owner,contact,weight})=>({weight,report:palmContactReport(owner.visitor,contact)}));
}
