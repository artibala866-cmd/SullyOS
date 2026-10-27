export function shouldMoveHomePhoneLauncherLeft({container,launcher,residentRects,right=18,bottom=150,gap=8}) {
 if(!container||!launcher||!Array.isArray(residentRects)||!Number.isFinite(container.right)||!Number.isFinite(container.bottom)||!Number.isFinite(launcher.width)||!Number.isFinite(launcher.height))return false;
 const preferred={left:container.right-right-launcher.width,right:container.right-right,top:container.bottom-bottom-launcher.height,bottom:container.bottom-bottom};
 return residentRects.some(rect=>rect&&preferred.left<rect.right+gap&&preferred.right>rect.left-gap&&preferred.top<rect.bottom+gap&&preferred.bottom>rect.top-gap);
}
