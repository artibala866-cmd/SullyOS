// A small dead band prevents flicker when the camera is parallel to a wall.
export function automaticWallVisible(edge,dx,dz,previous=true){
 if(edge==='front')return false;
 const length=Math.hypot(dx,dz)||1;
 const facing=({left:-dx,right:dx,front:dz,back:-dz})[edge]/length;
 return facing>.08?false:facing<-.08?true:previous;
}

// Wall visibility depends on which side of each .08 angular threshold
// the camera lies, not on its exact (continuously changing) position.
// Use this key to avoid traversing every room mesh on each entrance tween frame.
export function automaticWallDirectionKey(dx,dz){
 const length=Math.hypot(dx,dz)||1;
 const side=value=>value>.08?1:value<-.08?-1:0;
 return side(dx/length)+':'+side(dz/length);
}
