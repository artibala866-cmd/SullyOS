import {describe,expect,it,vi} from 'vitest';
import {selectedMotions} from './selectedMotions';
import {motionCapabilities,motionCapabilityKeys} from './motionCapabilities';
import {motionTemplatePresets,authoredMotionTemplates,compileMotionTemplates,motionTemplates,motionTemplateFor,motionTemplateContact,motionTemplateConstraintPlans} from './motionTemplates';
import {motionContactProfiles} from './motionContactProfiles';
import {createMotionTemplateScope} from './motionTemplateScope';

const metadata=[{id:'new-pair',participants:2},{id:'new-solo',participants:1},{id:'new-face',participants:2},{id:'new-cup',participants:2}];
const pair=()=>motionTemplatePresets.pairedHands({pairing:'sampledClosest',enter:[.6,1.1],exit:[1.7,2.2],curl:.3});
describe('Stage 5 motion authoring contract',()=>{
 it('preserves original motion templates while extending the catalog by four seasonal actions',()=>{
  expect(selectedMotions.filter(x=>!x.id.startsWith('halloween-')&&x.id!=='home-forehead-touch')).toHaveLength(49);
  expect(selectedMotions.filter(x=>x.id.startsWith('halloween-'))).toHaveLength(4);
  expect(selectedMotions).toHaveLength(54);
 expect(selectedMotions.find(x=>x.id==='home-forehead-touch')).toMatchObject({participants:2,category:'close'});
  expect(motionCapabilityKeys).toHaveLength(10);
  expect(Object.keys(authoredMotionTemplates).sort()).toEqual(['home-hand-hold-plead','home-head-pat','home-passion-kiss','home-rear-hug','home-sneak-kiss','home-sofa-lap-pillow']);
  expect(Object.keys(motionTemplates).sort()).toEqual([...Object.keys(motionContactProfiles),'home-hand-hold-plead','home-head-pat','home-passion-kiss','home-rear-hug','home-sneak-kiss','home-sofa-lap-pillow'].sort());
  for(const [id,c] of Object.entries(motionContactProfiles))expect(motionTemplateContact(id)).toBe(c);
  expect(motionTemplateFor('home-hug')).toBeUndefined();
  expect(motionTemplateFor('home-hand-hold-plead')?.capabilities).toEqual(['pairedSync','residentNavigation','handContact']);
  expect(motionTemplateFor('home-rear-hug')?.adapter).toBe('legacy');
  expect(motionTemplateFor('home-sofa-lap-pillow')?.adapter).toBe('legacy');
  expect(motionTemplateFor('home-rear-hug')?.capabilities).toContain('armWrap');
  expect(motionTemplateFor('home-rear-hug')?.phases).toBeUndefined();
  expect(motionTemplateFor('home-kiss')).toBeUndefined();
  expect(motionTemplateFor('home-princess-carry')).toBeUndefined();
  expect(Object.keys(motionTemplateConstraintPlans).sort()).toEqual([...Object.keys(motionContactProfiles),'home-head-pat'].sort());
  for(const id of Object.keys(motionContactProfiles)){
   expect(motionTemplateFor(id)?.standingHeight).toBe('contact');
   expect(motionTemplateFor(id)?.phases).toEqual(['bodyPlacement','clearance','contactIK','presentation']);
  }
 });
 it('registers the only new playful hair pat in the existing close category',()=>{
  const entry=selectedMotions.find(e=>e.id==='home-head-pat');
  const spec=motionTemplateFor('home-head-pat');
  expect(entry?.category).toBe('close');
  expect(entry?.participants).toBe(2);
  expect(spec?.headTouch).toEqual({kind:'patThenRuffle',patSide:'R',patStrokes:2,ruffleStrokes:2});
  expect(spec?.capabilities).toEqual(['pairedSync','residentNavigation','handContact']);
 });
 it('rejects impossible new head-touch configurations at startup',()=>{
  expect(()=>compileMotionTemplates(metadata,{'new-pair':motionTemplatePresets.headPat({patStrokes:0})})).toThrow(/head touch/);
  expect(()=>compileMotionTemplates(metadata,{'new-solo':{...motionTemplatePresets.headPat(),participants:1}})).toThrow(/head touch/);
 });
 it('allows a new paired-hand action via one static spec and a matching catalog entry',()=>{
  const compiled=compileMotionTemplates(metadata,{'new-pair':pair()});
  expect(compiled['new-pair'].capabilities).toContain('pairedSync');
  expect(compiled['new-pair'].phases).toEqual(['bodyPlacement','clearance','contactIK','presentation']);
  expect(compiled['new-pair'].contact?.kind).toBe('pairedHands');
  expect(Object.isFrozen(compiled)).toBe(true);
  expect(Object.isFrozen(compiled['new-pair'].phases)).toBe(true);
 });
 it('composes one-actor, facial anchors and temporary prop templates without a new renderer',()=>{
  const compiled=compileMotionTemplates(metadata,{
   'new-solo':motionTemplatePresets.singlePose(),
   'new-face':motionTemplatePresets.faceContact('foreheadKiss'),
   'new-cup':motionTemplatePresets.cup(1.65),
  });
  expect(compiled['new-solo'].participants).toBe(1);
  expect(compiled['new-face'].face).toBe('foreheadKiss');
  expect(compiled['new-cup'].prop).toEqual({kind:'cup',handoffAt:1.65});
 });
 it('rejects missing metadata, duplicate profiles, mismatched roles and invalid windows',()=>{
  expect(()=>compileMotionTemplates(metadata,{missing:pair()})).toThrow(/metadata/);
  expect(()=>compileMotionTemplates(metadata,{'new-solo':pair()})).toThrow(/participant/);
  expect(()=>compileMotionTemplates(metadata,{'new-pair':pair()},{'new-pair':motionContactProfiles['cmu-20_10']})).toThrow(/duplicates/);
  expect(()=>compileMotionTemplates(metadata,{'new-pair':motionTemplatePresets.pairedHands({pairing:'sampledClosest',enter:[1.2,.5],curl:.2})})).toThrow(/timings/);
 });
 it('rejects fake IK capabilities and ill-formed stage orders before launching a scene',()=>{
  expect(()=>compileMotionTemplates(metadata,{'new-pair':{participants:2,capabilities:['pairedSync','armWrap']}})).toThrow(/adapter/);
  expect(()=>compileMotionTemplates(metadata,{'new-pair':{participants:2,capabilities:['pairedSync','armWrap'],adapter:'legacy'}})).toThrow(/adapter/);
  expect(()=>compileMotionTemplates(metadata,{'new-pair':{...pair(),phases:['contactIK','presentation']}})).toThrow(/stage/);
  expect(()=>compileMotionTemplates(metadata,{'new-face':{participants:2,capabilities:['pairedSync'],face:'noseTouch'}})).toThrow(/face/);
  expect(Object.keys(motionCapabilities)).toHaveLength(10);
 });
});
describe('temporary scene resources and stale action protection',()=>{
 it('disposes owned resources exactly once, in reverse order, on cancel/restart',()=>{
  const scope=createMotionTemplateScope(),calls:string[]=[];
  const old=scope.begin('old');
  scope.own({dispose:()=>calls.push('phone')});
  scope.own({dispose:()=>calls.push('cup')});
  expect(scope.current(old)).toBe(true);
  const next=scope.begin('next');
  expect(calls).toEqual(['cup','phone']);
  expect(scope.current(old)).toBe(false);
  expect(scope.current(next)).toBe(true);
  scope.stop();scope.stop();
  expect(scope.active).toBeNull();
  expect(scope.ownedCount).toBe(0);
  expect(calls).toEqual(['cup','phone']);
 });
 it('reports a release failure without blocking action reset or later reuse',()=>{
  const scope=createMotionTemplateScope(),calls:string[]=[];
  scope.begin('social-action');
  scope.own({dispose:()=>calls.push('left hand')});
  scope.own({dispose:()=>{calls.push('failed prop');throw Error('prop cleanup');}});
  scope.own({dispose:()=>calls.push('right hand')});
  const error=scope.stopSafely();
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('prop cleanup');
  expect(calls).toEqual(['right hand','failed prop','left hand']);
  expect(scope.ownedCount).toBe(0);
  expect(scope.active).toBeNull();
  expect(scope.stopSafely()).toBeNull();
  scope.begin('next action');
  expect(scope.active).toBe('next action');
  scope.stop();
 });
 it('releases other resources even if one dispose throws',()=>{
  const scope=createMotionTemplateScope(),dispose=vi.fn();
  scope.begin('action');
  scope.own({dispose});
  scope.own({dispose:()=>{throw Error('asset failed')}});
  expect(()=>scope.stop()).toThrow('asset failed');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(scope.ownedCount).toBe(0);
 });
});
