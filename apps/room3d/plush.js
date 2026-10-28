// A held plush is a temporary presentation of one placed furniture instance.
// Its saved position/support remain the return location; never duplicate inventory.
export function roomPlush(room,catalog){return room.items.filter(i=>!i.stored&&catalog.find(a=>a.id===i.assetId)?.holdable).map(i=>({itemId:i.id,label:catalog.find(a=>a.id===i.assetId).name}));}
export function plushPose(asset,time=0){
 const s=asset.size,scale=Math.min(.78/s[0],.64/s[1],.76/s[2]);
 const width=s[0]*scale,height=s[1]*scale,depth=s[2]*scale,bob=Math.sin(time*1.8)*.008;
 // Preserve the silhouette uniformly; hold it below the eyes, clear of the torso.
 const base=.27,bottom=base+bob,z=.39+depth/2;
 return {scale,position:[0,bottom,z],hands:[[-width*.46/.7,(base+height*.46+bob)/.7,(z+depth*.12)/.7],[width*.46/.7,(base+height*.46+bob)/.7,(z+depth*.12)/.7]]};
}

export function body2PlushPose(asset,time,chestHeight){
 const pose=plushPose(asset,time),lift=chestHeight-.45-pose.position[1];
 pose.position[1]+=lift;pose.position[2]-=.16;
 for(const hand of pose.hands){hand[1]+=lift/.7;hand[2]-=.16/.7;}
 return pose;
}

// Authored toy footprint + the current actor's head clearance define possible
// walking endpoints. This is only reachability geometry, not a new action player.
// World transforms follow the existing model/gamingPoint coordinate convention.
export function plushApproachCandidates(room,catalog,itemId,headWidth=1.5){
 const item=room?.items?.find(i=>i.id===itemId&&!i.stored),
  asset=catalog.find(a=>a.id===item?.assetId);
 if(!item||!asset?.holdable||asset.surface!=='floor'||!Array.isArray(asset.size))return [];
 const [width,height,depth]=asset.size;
 if(![width,height,depth,headWidth,item.x,item.y,item.z,item.rotation].every(Number.isFinite)||width<=0||height<=0||depth<=0||headWidth<=0)return [];
 const sideGap=Math.max(.52,headWidth/2+.20),a=item.rotation*Math.PI/180,
  c=Math.cos(a),s=Math.sin(a),result=[];
 for(const [side,axis,sign] of [['front','z',1],['right','x',1],['back','z',-1],['left','x',-1]]){
  for(const shift of [0,-.35,.35,-.70,.70]){
   const px=axis==='x'?sign*(width/2+sideGap):shift,
    pz=axis==='z'?sign*(depth/2+sideGap):shift,
    x=item.x+c*px+s*pz,z=item.z-s*px+c*pz;
   result.push({side,position:[x,.18,z],rotation:Math.atan2(item.x-x,item.z-z),
    target:[item.x,item.y+height*.48,item.z]});
  }
 }
 return result;
}
