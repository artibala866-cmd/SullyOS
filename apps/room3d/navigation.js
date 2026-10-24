import {ROOM_HALF} from './dimensions.js';
import {boxes} from './model.js';
import {ROOM_EDGES} from './building.js';
import {boundary,boundaryBoxes,ROOM_STEP,neighbor,insideFloors} from './topology.js';
export function walkingMap(home,level,catalog,{headWidth=1.5,headBottom=.7,headTop=1.95,walkClearance=false}={}){
 const cells=[],areas=[],obstacles=[];const half=Math.max(.75,headWidth/2);
 // Hair/accessories may overlap: walking uses the core silhouette, not the full head bounds.
 const headRadius=walkClearance ? .34 : Math.max(.58,half*.85);
 for(const room of home.rooms.filter(r=>r.level===level)){
  const start=cells.length,x=room.x*ROOM_STEP.x,z=room.z*ROOM_STEP.z;cells.push([x-ROOM_HALF.x,z-ROOM_HALF.z,x+ROOM_HALF.x,z+ROOM_HALF.z]);
  for(const [edge,e] of Object.entries(ROOM_EDGES)){const door=boundary(room,edge).door;if(!door||neighbor(home,room,edge))continue;
   const lo=door.at-door.width/2-.35,hi=door.at+door.width/2+.35,at=e.at,sign=Math.sign(at),a=at-sign*.3,b=at+sign*2.2;
   cells.push(e.axis==='z'?[x+lo,z+Math.min(a,b),x+hi,z+Math.max(a,b)]:[x+Math.min(a,b),z+lo,x+Math.max(a,b),z+hi]);
  }
  areas.push(...cells.slice(start).map(rect=>({roomId:room.id,rect})));
  const local=[...boundaryBoxes(room,catalog),...room.items.filter(i=>!i.stored&&!catalog.find(a=>a.id===i.assetId)?.building&&!['rug','ceiling'].includes(catalog.find(a=>a.id===i.assetId)?.surface)).flatMap(i=>boxes(i,catalog.find(a=>a.id===i.assetId)))];
  obstacles.push(...local.map(b=>[b[0]+x,b[1],b[2]+z,b[3]+x,b[4],b[5]+z]));
  // Freestanding walls are obstacles too (edge segments already included above).
  for(const i of room.items.filter(i=>!i.stored&&catalog.find(a=>a.id===i.assetId)?.building))obstacles.push(...boxes(i,catalog.find(a=>a.id===i.assetId)).map(b=>[b[0]+x,b[1],b[2]+z,b[3]+x,b[4],b[5]+z]));
 }
 const free=(x,z)=>{
  // Walking tolerates hair overhang and uses a round head rather than reserving
  // the empty corners of a square. Stationary placement checks retain full clearance.
  const floorHalf=walkClearance ? .28 : half;
  if(!insideFloors([x-floorHalf,z-floorHalf,x+floorHalf,z+floorHalf],cells))return false;
  const body=[x-.28,.18,z-.28,x+.28,headBottom,z+.28],head=[x-half,headBottom,z-half,x+half,headTop,z+half];
  if(walkClearance)return !obstacles.some(b=>{
   const bodyHit=body[0]<b[3]&&body[3]>b[0]&&body[1]<b[4]&&body[4]>b[1]&&body[2]<b[5]&&body[5]>b[2];
   const dx=Math.max(b[0]-x,0,x-b[3]),dz=Math.max(b[2]-z,0,z-b[5]);
   return bodyHit||headBottom<b[4]&&headTop>b[1]&&dx*dx+dz*dz<headRadius*headRadius;
  });
  return !obstacles.some(b=>[body,head].some(a=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2]));
 };
 return {free,cells,obstacles,areas};
}
/** Only on path requests; never run grid search in the animation frame. */
export function findWalkPath(map,start,target,{targetRadius=0}={}){
 const clear=(a,b)=>{
  const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.06));
  for(let i=0;i<=n;i++)if(!map.free(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n))return false;
  return true;
 };
 if(!map.free(...target)){
  if(targetRadius<=0||!map.free(...start))return null;
  const nearby=[];
  for(let radius=.15;radius<=Math.min(targetRadius,.6)+.001;radius+=.15)for(let i=0;i<16;i++){
   const angle=i*Math.PI/8,p=[target[0]+Math.cos(angle)*radius,target[1]+Math.sin(angle)*radius];
   if(map.free(...p))nearby.push(p);
  }
  // A blocked click can have a reachable position on its far side.
  for(const p of nearby.slice(0,32)){const found=findWalkPath(map,start,p);if(found)return found;}
  return null;
 }
 if(!map.free(...start)){
  // Standing next to furniture can place the root inside its wide safety
  // margin, but we must never escape THROUGH a real wall or furniture mesh.
  if(!Array.isArray(map.cells)||!Array.isArray(map.obstacles))return null;
  const coreFree=(x,z)=>map.cells.some(c=>x>=c[0]&&x<=c[2]&&z>=c[1]&&z<=c[3])&&!map.obstacles.some(b=>b[1]<1.4&&b[4]>.18&&x>b[0]&&x<b[3]&&z>b[2]&&z<b[5]);
  if(!coreFree(...start))return null;
  for(const radius of [.08,.16,.24,.32])for(let i=0;i<16;i++){
   const angle=i*Math.PI/8,p=[start[0]+Math.cos(angle)*radius,start[1]+Math.sin(angle)*radius];
   if(!map.free(...p))continue;
   let safe=true;for(let j=1;j<=Math.ceil(radius/.03);j++){
    const t=j/Math.ceil(radius/.03);
    if(!coreFree(start[0]+(p[0]-start[0])*t,start[1]+(p[1]-start[1])*t)){safe=false;break;}
   }
   if(!safe)continue;
   const found=findWalkPath(map,p,target);if(found)return [start,...found];
  }
  return null;
 }
 if(clear(start,target))return [start,target];
 const routeOnGrid=(step,limit)=>{
  const key=p=>p[0]+','+p[1],loc=p=>[p[0]*step,p[1]*step],round=p=>p.map(x=>Math.round(x/step));
  const walkable=new Map();
  const open=p=>{const id=key(p);if(!walkable.has(id))walkable.set(id,map.free(...loc(p)));return walkable.get(id);};
  const attachment=p=>{
   const c=round(p),nodes=[],reach=step<.15?2:1;
   for(let dx=-reach;dx<=reach;dx++)for(let dz=-reach;dz<=reach;dz++){
    const node=[c[0]+dx,c[1]+dz];if(open(node)&&clear(p,loc(node)))nodes.push(node);
   }
   return nodes.sort((a,b)=>Math.hypot(a[0]*step-p[0],a[1]*step-p[1])-Math.hypot(b[0]*step-p[0],b[1]*step-p[1]));
  };
  const sources=attachment(start),goals=new Set(attachment(target).map(key));
  if(!sources.length||!goals.size)return null;
  const heap=[],best=new Map(),parent=new Map(),heuristic=p=>Math.hypot(p[0]*step-target[0],p[1]*step-target[1]);
  const push=v=>{let i=heap.length;heap.push(v);while(i){const j=(i-1)>>1;if(heap[j].f<=v.f)break;heap[i]=heap[j];i=j;}heap[i]=v;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(last.f<=heap[j].f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
  for(const node of sources){const id=key(node),g=Math.hypot(node[0]*step-start[0],node[1]*step-start[1]);if(g>=(best.get(id)??Infinity))continue;best.set(id,g);parent.set(id,null);push({node,g,f:g+heuristic(node)});}
  const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let endpoint=null,visited=0;
  while(heap.length&&visited++<limit){
   const current=pop(),p=current.node,id=key(p);
   if(current.g>(best.get(id)??Infinity)+1e-7)continue;
   if(goals.has(id)){endpoint=p;break;}
   for(const [dx,dz] of directions){
    const next=[p[0]+dx,p[1]+dz],id=key(next);
    if(!open(next)||dx&&dz&&(!open([p[0]+dx,p[1]])||!open([p[0],p[1]+dz])))continue;
    const g=current.g+step*Math.hypot(dx,dz);
    if(g+1e-7>=(best.get(id)??Infinity)||!clear(loc(p),loc(next)))continue;
    best.set(id,g);parent.set(id,p);push({node:next,g,f:g+heuristic(next)});
   }
  }
  if(!endpoint)return null;
  const points=[target];
  for(let p=endpoint;p;p=parent.get(key(p)))points.push(loc(p));
  points.push(start);points.reverse();
  const smooth=[start];
  for(let i=0;i<points.length-1;){
   let j=points.length-1;
   while(j>i+1&&!clear(points[i],points[j]))j--;
   if(!clear(points[i],points[j]))return null;
   smooth.push(points[j]);i=j;
  }
  return smooth;
 };
 // Normal paths use the cheap .2 grid. Only actual failures retry .1.
 return routeOnGrid(.2,20000)||routeOnGrid(.1,24000);
}
export function doorTarget(home,room,edge,outside=false){
 const e=ROOM_EDGES[edge],d=boundary(room,edge).door;if(!d)return null;
 const sign=Math.sign(e.at),normal=e.at+sign*(outside?-1:1)*1.05;
 return e.axis==='z'?[room.x*ROOM_STEP.x+d.at,room.z*ROOM_STEP.z+normal]:[room.x*ROOM_STEP.x+normal,room.z*ROOM_STEP.z+d.at];
}
