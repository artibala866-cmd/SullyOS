import type {MotionCapability} from './motionCapabilities';
import type {HeightAdaptationMode} from './standingHeightAdaptation';
import {motionCapabilities} from './motionCapabilities';
import {motionContactProfiles,type MotionContactProfile,type PairedHandProfile,type BodyTouchProfile} from './motionContactProfiles';
import {motionConstraintPlans,type MotionConstraintPlan,type MotionConstraintPhase} from './motionConstraintPipeline';
import {faceContactRecipes} from './faceContactProfiles';
import {selectedMotions} from './selectedMotions';

/** Configuration only. This file never imports/loads animation JSON or creates a solver. */
export type MotionPropTemplate=
 | Readonly<{kind:'phone';hand:'L'|'R'}>
 | Readonly<{kind:'cup';handoffAt:number}>;
export type HeadTouchRecipe=Readonly<{kind:'patThenRuffle';patSide:'L'|'R';patStrokes:number;ruffleStrokes:number}>;
export type MotionPosture='standing'|'seatedTarget'|'seatedActor'|'any';
export type MotionTemplateDraft=Readonly<{
 participants:1|2;
 capabilities:readonly MotionCapability[];
 contact?:MotionContactProfile;
 face?:keyof typeof faceContactRecipes;
 headTouch?:HeadTouchRecipe;
 /** Symmetric, world-scaled standing height correction before contact IK. */
 standingHeight?:HeightAdaptationMode;
 prop?:MotionPropTemplate;
 posture?:MotionPosture;
 phases?:MotionConstraintPlan;
 /** Explicit legacy opt-out for specialized, approved motion code. */
 adapter?:'legacy';
}>;
export type MotionTemplate=Readonly<MotionTemplateDraft&{id:string}>;
type ActionDefinition=Readonly<{id:string;participants:number}>;
const standardPhases:MotionConstraintPlan=['bodyPlacement','clearance','contactIK','presentation'];

/** Common new-action templates: one catalog entry and one configuration entry.
 * The normal source clip / shared clock / approach / solver pipeline is reused.
 */
export const motionTemplatePresets={
 singlePose():MotionTemplateDraft{
  return {participants:1,capabilities:['singlePose'],posture:'standing',phases:['bodyPlacement','presentation']};
 },
 pairedHands(profile:Omit<PairedHandProfile,'kind'|'capabilities'>):MotionTemplateDraft{
  return {participants:2,capabilities:['pairedSync','residentNavigation','handContact'],
   posture:'standing',standingHeight:'contact',contact:{kind:'pairedHands',capabilities:['handContact','pairedSync'],...profile},phases:standardPhases};
 },
 bodyTouch(profile:Omit<BodyTouchProfile,'kind'|'capabilities'>):MotionTemplateDraft{
  return {participants:2,capabilities:['pairedSync','residentNavigation','bodyContact'],
   posture:'standing',standingHeight:'contact',contact:{kind:'bodyTouch',capabilities:['bodyContact'],...profile},phases:standardPhases};
 },
 faceContact(recipe:keyof typeof faceContactRecipes):MotionTemplateDraft{
  return {participants:2,capabilities:['pairedSync','residentNavigation','faceContact'],
   posture:'standing',standingHeight:'gaze',face:recipe,phases:standardPhases};
 },
 headPat(config:Partial<Omit<HeadTouchRecipe,'kind'>>={}):MotionTemplateDraft{
  return {participants:2,capabilities:['pairedSync','residentNavigation','handContact'],
   posture:'standing',standingHeight:'headReach',headTouch:{kind:'patThenRuffle',patSide:config.patSide??'R',
    patStrokes:config.patStrokes??2,ruffleStrokes:config.ruffleStrokes??2},
   phases:standardPhases};
 },
 phone(hand:'L'|'R'):MotionTemplateDraft{
  return {participants:1,capabilities:['singlePose','propInteraction'],
   posture:'standing',prop:{kind:'phone',hand},phases:['bodyPlacement','presentation']};
 },
 cup(handoffAt:number):MotionTemplateDraft{
  return {participants:2,capabilities:['pairedSync','residentNavigation','propInteraction'],
   posture:'standing',prop:{kind:'cup',handoffAt},phases:standardPhases};
 },
};

/**
 * Add future regular motions HERE after adding a metadata+clip entry to the
 * existing selectedMotionCatalog.json. Example:
 *
 * 'my-new-hand-motion':motionTemplatePresets.pairedHands({
 *   pairing:'sampledClosest',enter:[.7,1.1],exit:[2,2.3],curl:.3
 * }),
 *
 * Complex hugs/carries/seat transitions need an explicitly reviewed adapter.
 * Their current legacy handlers must never be silently overridden by a preset.
 */
export const authoredMotionTemplates:Readonly<Record<string,MotionTemplateDraft>>=Object.freeze({
 // Chibi two-person playful pet; shares the existing path planner, contactSolver,
 // stage scheduler, expression renderer and on-demand procedural clip.
 'home-head-pat':motionTemplatePresets.headPat(),
 // Reviewed specialized handler; still uses the one shared social scene.
 'home-rear-hug':{
  participants:2,capabilities:['pairedSync','residentNavigation','armWrap','handContact','bodyContact'],
  posture:'standing',adapter:'legacy',
 },
 // The shared clock and contactSolver drive a reviewed two-palm procedural pose.
 // Generic sampled pairedHands cannot preserve this hand pair and wave anchor.
 'home-hand-hold-plead':{
  participants:2,capabilities:['pairedSync','residentNavigation','handContact'],posture:'standing',
 },
});

export function compileMotionTemplates(
 entries:readonly ActionDefinition[],
 custom:Readonly<Record<string,MotionTemplateDraft>>,
 existingContacts:Readonly<Record<string,MotionContactProfile>>={},
 existingPlans:Readonly<Record<string,MotionConstraintPlan>>={}
):Readonly<Record<string,MotionTemplate>>{
 const known=new Map(entries.map(e=>[e.id,e.participants]));
 if(known.size!==entries.length)throw Error('Duplicate selected motion IDs');
 const templates:Record<string,MotionTemplate>={};
 const inherited:Record<string,MotionTemplateDraft>={};
 for(const [id,contact] of Object.entries(existingContacts))
  inherited[id]={participants:2,capabilities:[...new Set<MotionCapability>(['pairedSync','residentNavigation',...contact.capabilities])],contact,phases:existingPlans[id]};
 for(const id of Object.keys(custom))if(id in inherited)throw Error('Motion template duplicates an existing contact profile: '+id);
 const phases=new Set<MotionConstraintPhase>(['bodyPlacement','clearance','contactIK','presentation']);
 for(const [id,draft] of Object.entries({...inherited,...custom})){
  if(!known.has(id))throw Error('Motion template has no selected clip metadata: '+id);
  if(known.get(id)!==draft.participants)throw Error('Motion template participant count mismatch: '+id);
  if(!Array.isArray(draft.capabilities)||new Set(draft.capabilities).size!==draft.capabilities.length||
    draft.capabilities.some(c=>!(c in motionCapabilities)))throw Error('Motion template capability invalid: '+id);
  const has=(cap:MotionCapability)=>draft.capabilities.includes(cap);
  if(draft.participants===2&&!has('pairedSync'))throw Error('Paired motion must share one clock: '+id);
  if(draft.contact){
   const c=draft.contact;
   if(draft.participants!==2||c.kind==='pairedHands'&&!has('handContact')||
     c.kind==='bodyTouch'&&!has('bodyContact'))throw Error('Contact capability mismatch: '+id);
   if(c.kind==='pairedHands'){
    const validWindow=(w:readonly [number,number])=>Array.isArray(w)&&w.length===2&&
      w.every(Number.isFinite)&&w[0]>=0&&w[1]>w[0];
    if(c.pairing!=='sampledClosest'||!validWindow(c.enter)||c.exit&&!validWindow(c.exit)||
      c.exit&&c.exit[0]<c.enter[1]||!Number.isFinite(c.curl)||c.curl<0||c.curl>1)throw Error('Invalid paired hand timings: '+id);
   }else if(!(c.far>c.near&&c.near>=0&&Number.isFinite(c.far))||
     c.targetBones.length!==2||c.targetBones.some(x=>!['L_upperArm','R_upperArm'].includes(x)))
      throw Error('Invalid body touch profile: '+id);
  }
  if(draft.face&&(!has('faceContact')||draft.participants!==2||!(draft.face in faceContactRecipes)))
   throw Error('Invalid face contact recipe: '+id);
  if(draft.headTouch&&(draft.headTouch.kind!=='patThenRuffle'||draft.participants!==2||!has('handContact')||
    !['L','R'].includes(draft.headTouch.patSide)||!Number.isInteger(draft.headTouch.patStrokes)||
    draft.headTouch.patStrokes<1||draft.headTouch.patStrokes>4||
    !Number.isInteger(draft.headTouch.ruffleStrokes)||draft.headTouch.ruffleStrokes<1||
    draft.headTouch.ruffleStrokes>4||draft.contact||draft.face))
   throw Error('Invalid head touch template: '+id);
  if(draft.standingHeight!==undefined&&(!['none','gaze','contact','headReach'].includes(draft.standingHeight)||
   draft.participants!==2||draft.posture!=='standing'))
   throw Error('Standing height adaptation requires two standing actors: '+id);
  if(draft.prop&&(!has('propInteraction')||
    draft.prop.kind==='cup'&&(draft.participants!==2||!Number.isFinite(draft.prop.handoffAt)||draft.prop.handoffAt<0)||
    draft.prop.kind==='phone'&&!['L','R'].includes(draft.prop.hand)))
   throw Error('Invalid prop template: '+id);
  if(has('armWrap')||has('supportAndLift')||has('seatTransition')){
   // Declaring a legacy adapter is NOT sufficient. The original specialized
   // action must actually exist in selectedSocial/intimacyMotion/seat state.
   // Future IDs are rejected until a real tested adapter has been installed.
   const supported=new Set(['home-hug','home-rear-hug','home-kiss','home-princess-carry','home-princess-carried']);
   if(draft.adapter!=='legacy'||!supported.has(id))
    throw Error('Specialized motion requires reviewed adapter: '+id);
  }
  if(draft.phases){
   const plan=draft.phases;
   if(!plan.length||plan[0]!=='bodyPlacement'||plan.at(-1)!=='presentation'||
     new Set(plan).size!==plan.length||plan.some(p=>!phases.has(p))||
     (draft.contact||draft.face||draft.headTouch)&&!plan.includes('contactIK'))
    throw Error('Invalid motion constraint stage plan: '+id);
  }
  templates[id]=Object.freeze({...draft,id,capabilities:Object.freeze([...draft.capabilities]),
   ...(draft.phases?{phases:Object.freeze([...draft.phases])}:{}),
  });
 }
 for(const id of Object.keys(existingPlans))if(!templates[id]?.phases)throw Error('Motion pipeline entry lacks a template: '+id);
 return Object.freeze(templates);
}

/** All eight Stage-1 contact profiles are inherited; only the already opted-in
 * Stage-2 motion receives a pipeline schedule. New presets may opt in directly.
 */
export const motionTemplates=compileMotionTemplates(
 selectedMotions,authoredMotionTemplates,motionContactProfiles,motionConstraintPlans
);
export const motionTemplateConstraintPlans:Readonly<Record<string,MotionConstraintPlan>>=
 Object.freeze(Object.fromEntries(Object.entries(motionTemplates)
  .filter(([,spec])=>!!spec.phases).map(([id,spec])=>[id,spec.phases!])));
export function motionTemplateFor(id:string):MotionTemplate|undefined{return motionTemplates[id];}
export function motionTemplateContact(id:string):MotionContactProfile|undefined{return motionTemplates[id]?.contact;}
