import {usableFurniturePoints} from './furniturePointRegistry.js';
import {KITCHEN_CAPABILITIES,KITCHEN_LABELS} from './kitchenActivities.js';
import {BATH_ACTIONS} from './bathroom.js';
import {isMirror} from './mirror.js';
import {canUseAsDiningSurface} from './dining.js';

// One capability index for catalog discovery. Execution stays with the existing
// seat/bed, kitchen, bathroom, mirror, gaming and dining controllers.
// This is an index of IMPLEMENTED contracts, not model-name-based guesses.
export function registeredFurnitureCapabilities(asset){
 if(!asset||asset.id==='shell'||asset.building)return [];
 const result=[];
 const seats=usableFurniturePoints(asset,'seats'),beds=usableFurniturePoints(asset,'beds');
 if(seats.length)result.push({kind:'sit',points:seats.map(p=>p.id)});
 if(beds.length)result.push({kind:'bed',points:beds.map(p=>p.id)});
 const kitchen=KITCHEN_CAPABILITIES[asset.id];
 if(KITCHEN_LABELS[kitchen])result.push({kind:'kitchen',action:kitchen,label:KITCHEN_LABELS[kitchen]});
 const bath=BATH_ACTIONS[asset.id];
 if(bath)result.push({kind:'bath',action:bath.kind,label:bath.label});
 if(isMirror(asset))result.push({kind:'mirror'});
 if(asset.activity?.kind)result.push({kind:'gaming',action:asset.activity.kind});
 if(canUseAsDiningSurface(asset))result.push({kind:'dining'});
 if(asset.id==='gaming_desk')result.push({kind:'computer-workstation'});
 if(asset.holdable)result.push({kind:'hold'});
 if(asset.surface==='floor'&&asset.waterable===true)result.push({kind:'water'});
 if(asset.appliance==='fridge')result.push({kind:'fridge'});
 return result;
}
