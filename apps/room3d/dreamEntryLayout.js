export function findDreamEntryTop({shell,rail,blockedRects=[],buttonHeight=48,gap=12,safeTop=72,safeBottom=16}) {
 if(!shell||!rail||!Number.isFinite(shell.top)||!Number.isFinite(shell.bottom)||!Number.isFinite(rail.top)||!Number.isFinite(rail.bottom)||!Array.isArray(blockedRects))return null;
 const height=shell.bottom-shell.top;
 if(!Number.isFinite(height)||height<buttonHeight+safeTop+safeBottom)return null;
 const candidates=[rail.bottom-shell.top+gap,rail.top-shell.top-buttonHeight-gap];
 for(const top of candidates){
  if(!Number.isFinite(top)||top<safeTop||top+buttonHeight>height-safeBottom)continue;
  const overlaps=blockedRects.some(rect=>{
   if(!rect||!Number.isFinite(rect.top)||!Number.isFinite(rect.bottom))return false;
   const rectTop=rect.top-shell.top,rectBottom=rect.bottom-shell.top;
   return top<rectBottom+gap&&top+buttonHeight>rectTop-gap;
  });
  if(!overlaps)return top;
 }
 return null;
}
