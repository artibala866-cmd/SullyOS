/** Stable idempotent UUID for AMSG2 user+character+daily opportunity.
 * amsg-server validates client-provided UUID and D1 enforces uniqueness.
 * This identifier is not a security token.
 */
export function autonomyWakeUuid(userId:string,charId:string,slot:'day'|'evening'):string{
  if(!userId||!charId)throw new Error('缺少云端用户或角色身份，不能安全创建自主联系');
  const input=[userId,charId,slot].join('|');
  const states=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  const primes=[0x01000193,0x27d4eb2d,0x165667b1,0x85ebca77];
  for(let p=0;p<input.length;p++){
    const c=input.charCodeAt(p);
    for(let j=0;j<4;j++)states[j]=Math.imul(states[j]^(c+j*257),primes[j])>>>0;
  }
  const hex=states.map(n=>n.toString(16).padStart(8,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),
    '8'+hex.slice(17,20),hex.slice(20)].join('-');
}
