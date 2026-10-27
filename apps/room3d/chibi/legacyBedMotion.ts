export type LegacyBedActivity = {
 kind?:string;
 bedWeight?:number;
 bedRecline?:number;
};
export function legacyBedFrame(time:number,activity?:LegacyBedActivity){
 if(activity?.kind!=='bed-change')return null;
 const bedWeight=Math.min(1,Math.max(0,Number.isFinite(activity.bedWeight)?activity.bedWeight!:0));
 const recline=Math.min(1,Math.max(0,Number.isFinite(activity.bedRecline)?activity.bedRecline!:0));
 return {
  sitting:bedWeight>=.7&&recline<.85,
  floatingLimbs:bedWeight>=.7||recline>0,
  rotationX:-Math.PI/2*recline,
  positionY:Math.sin(Math.max(0,Number.isFinite(time)?time:0)*1.8)*.009*recline,
 };
}
