/** Standing clearance for uninvolved residents during a social action.
 * Reuses core-body navigation footprint; checked only when planning.
 */
export const SOCIAL_OBSERVER_CLEARANCE=.60;
export function clearSocialObservers(paths,observers,minimum=SOCIAL_OBSERVER_CLEARANCE){
 return paths.every(path=>path.every(p=>observers.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>=minimum-1e-6)));
}
