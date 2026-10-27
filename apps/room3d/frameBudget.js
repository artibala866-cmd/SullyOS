// Small feedback controller for the room renderer. Only changes raster
// resolution, never resident rigs, motion clips, scene geometry or saved quality.
// Values use *rendered-frame spacing*, not rAF ticks (30 FPS intentionally skips ticks).
export function createRoomFrameBudget({enabled=false}={}){
 let scale=1,slow=0,steady=0,lastChange=0;
 return {
  get scale(){return scale;},
  reset(){scale=1;slow=0;steady=0;lastChange=0;},
  observe({now,frameMs,active=true}={}){
   if(!enabled||!active||!Number.isFinite(now)||!Number.isFinite(frameMs)||frameMs<=0)return null;
   // A long idle pause is not a frame-rate regression.
   if(frameMs>400){slow=0;steady=0;return null;}
   if(frameMs>=55){slow=Math.min(12,slow+1);steady=0;}
   else if(frameMs<=43){slow=Math.max(0,slow-1);steady=Math.min(150,steady+1);}
   else{slow=Math.max(0,slow-1);steady=0;}
   if(lastChange&&now-lastChange<3500)return null;
   if(slow>=4&&scale>.7){
    scale=scale>.9?.85:.7;slow=0;steady=0;lastChange=now;return scale;
   }
   if(steady>=120&&scale<1){
    scale=scale<.8?.85:1;slow=0;steady=0;lastChange=now;return scale;
   }
   return null;
  },
 };
}

// Separate real-time character/action progression from short collision/physics
// steps. At 15 FPS a fixed 0.05s clock would slow a 1s sit animation to 1.33s.
// Limit catch-up to 0.2s after stalls rather than respawning or teleporting.
export function roomFrameDeltas(milliseconds){
 const seconds=Number.isFinite(milliseconds)?Math.max(0,milliseconds)/1000:0;
 return {simulation:Math.min(.05,seconds),activity:Math.min(.2,seconds)};
}
