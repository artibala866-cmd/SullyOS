// The catalog is the source of authored LOCAL furniture contact points.
// Dimensions can reject impossible anchors; they cannot certify a seat cushion,
// mattress, ladder or hand target without inspecting the actual mesh and rig.
const PENDING_REVIEW={
 chair:'基础木椅缺坐面骨骼接触点；需核对 kit.glb 中真实座板',
 pouf:'花瓣坐墩缺坐点；需核对 kit.glb 坐垫表面和可用脚部空间',
 loft:'鲸鱼阁楼床缺床垫点与安全上床路径；不能直接传送到上铺',
 show_bedroom_bench:'床尾开放收纳凳：须核对实模顶面是否可承重、是否被摆件遮挡',
 bedroom_ref_bench:'书本收纳盒床尾凳：须核对实模哪一段座面未被物品占用',
};
export const FURNITURE_POINT_REVIEW=Object.freeze(PENDING_REVIEW);

const finiteTriple=p=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==='number'&&Number.isFinite(n));
export function furniturePointIssue(asset,point,kind){
 if(!asset||!point||typeof point.id!=='string'||!point.id||!finiteTriple(point.position)||point.rotation!=null&&!Number.isFinite(point.rotation))return '点位结构或坐标不合法';
 const [x,y,z]=point.position,[width,height,depth]=asset.size||[];
 if(![width,height,depth].every(n=>Number.isFinite(n)&&n>0))return '家具尺寸不合法';
 // Only a broad sanity bound: never substitute this for mesh-surface validation.
 if(Math.abs(x)>width/2+.08||y<-.02||y>height+.10||Math.abs(z)>depth/2+.08)return '点位超出家具局部范围';
 if(kind==='beds'&&(y>1.85||asset.id==='bedroom_bunk'))return '该床位尚无通过验证的床沿进出或攀爬路径';
 return '';
}
export function usableFurniturePoints(asset,kind){
 if(kind!=='seats'&&kind!=='beds')return [];
 const seen=new Set();
 return (asset?.[kind]||[]).filter(point=>{
  const issue=furniturePointIssue(asset,point,kind);
  if(issue||seen.has(point.id))return false;
  seen.add(point.id);return true;
 });
}
export function furniturePointAudit(catalog){
 return catalog.map(asset=>{
  const seats=asset.seats||[],beds=asset.beds||[],safeSeats=usableFurniturePoints(asset,'seats'),safeBeds=usableFurniturePoints(asset,'beds');
  const issues=[...seats.map(p=>furniturePointIssue(asset,p,'seats')).filter(Boolean),...beds.map(p=>furniturePointIssue(asset,p,'beds')).filter(Boolean)];
  const pending=PENDING_REVIEW[asset.id];
  if(pending)issues.push(pending);
  if(seats.length!==safeSeats.length||beds.length!==safeBeds.length)issues.push('存在不合法、重复或暂无安全进出路径的点位');
  // "not applicable" is NOT inferred from a browsing tag or bounding box.
  // Unregistered objects remain pending human mesh inspection.
  const status=issues.length?'需要补齐或修复':seats.length||beds.length?'已配置但尚未完成画面验证':'需要补齐或修复';
  return {id:asset.id,name:asset.name,surface:asset.surface,url:asset.url||'kit.glb',status,
   configured:{seats:seats.length,beds:beds.length},
   currentlyExposed:{seats:safeSeats.length,beds:safeBeds.length},
   otherCapabilities:{activity:asset.activity?.kind||null,dining:!!asset.dining,kitchen:asset.id.startsWith('kitchen_')?'待核对动作映射':null,
    bath:asset.id.startsWith('bath_')?'待核对动作映射':null,holdable:!!asset.holdable,waterable:!!asset.waterable,appliance:asset.appliance||null},
   notes:issues.length?issues:['无证据证明额外互动点已校准；需要实模和 3D 运行核验']};
 });
}
