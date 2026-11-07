import type { CharacterProfile } from '../types';

/**
 * A character's \`description\` is the user's editable Neural Link remark.
 * Older Tavern and Link importers accidentally copied persona summaries here.
 * Correct only byte-identifiable generated remarks; never guess at a user's own
 * note or alter the canonical persona, name, scenes, memories or source ID.
 */
const PREFIX_TAVERN = '【角色身份与背景】\n';
const PREFIX_PERSONA = '【角色稳定人设】\n';
const PREFIX_NICK = '【角色昵称】\n';
const PREFIX_SIGNATURE = '【角色签名】\n';
const PREFIX_DOCUMENT = '【导入人物原始文档】\n';

const section = (prompt:string, heading:string, following:string[]):string=>{
    const start=prompt.indexOf(heading);
    if(start<0 || (start>0 && prompt.slice(start-2,start)!=='\n\n'))return '';
    const from=start+heading.length;
    let end=prompt.length;
    for(const next of following){
        const at=prompt.indexOf('\n\n'+next,from);
        if(at>=0 && at<end)end=at;
    }
    return prompt.slice(from,end).trim();
};

export function linkNicknameFromImportedPrompt(prompt:string):string {
    return section(prompt,PREFIX_NICK,[PREFIX_SIGNATURE]);
}

/**
 * Null = not proved to be a generated remark, so leave untouched.
 * Empty string = an old auto-generated persona remark must be cleared.
 * Nickname = Link's nickname without signature, prose or "昵称：" prefix.
 */
export function importedCardRemarkCorrection(char:Pick<CharacterProfile,
    'name'|'description'|'systemPrompt'|'cardImportOrigin'>):string|null {
    const remark=char.description?.trim()||'';
    const prompt=char.systemPrompt||'';
    const kind=char.cardImportOrigin?.source;
    if(!remark||!prompt)return null;
    if(kind==='tavern' && prompt.startsWith(PREFIX_TAVERN)){
        const expected=section(prompt,PREFIX_TAVERN,['【角色性格与行为设定】\n']);
        return expected && remark===expected ? '' : null;
    }
    if(kind==='document' && prompt.startsWith(PREFIX_DOCUMENT)){
        // The first document importer copied the first 260 characters of the
        // complete persona into the owner's remark. Only undo that exact bug.
        const expected = prompt.slice(PREFIX_DOCUMENT.length).slice(0,260).trim();
        return expected && remark === expected ? '' : null;
    }
    if(kind==='babylink'){
        const persona=section(prompt,PREFIX_PERSONA,[PREFIX_NICK,PREFIX_SIGNATURE]);
        const nickname=linkNicknameFromImportedPrompt(prompt);
        const signature=section(prompt,PREFIX_SIGNATURE,[]);
        const oldSummary=[
            nickname&&nickname!==char.name?'昵称：'+nickname:'',
            signature?'签名：'+signature:'',
            persona?persona.split('\n').find(Boolean)?.slice(0,140):'',
        ].filter(Boolean).join(' · ').slice(0,260);
        if(oldSummary&&remark===oldSummary)return nickname;
    }
    return null;
}

/**
 * A later import must never overwrite a user's handwritten remark.
 * For Link, a previously auto-imported nickname can track source updates.
 * For Tavern, re-import never changes the local remark (except the safe
 * legacy cleanup above); the complete persona is always systemPrompt-only.
 */
export function canReplaceImportedRemark(
    target: Pick<CharacterProfile,'name'|'description'|'systemPrompt'|'cardImportOrigin'>,
    source:'tavern'|'babylink',
):boolean {
    if(source==='tavern')return false;
    if(!target.description?.trim())return true;
    if(target.cardImportOrigin?.source!=='babylink')return false;
    if(target.cardImportOrigin.importedRemark !== undefined)
        return target.description.trim() === target.cardImportOrigin.importedRemark.trim();
    const corrected=importedCardRemarkCorrection(target);
    if(corrected!==null)return true;
    const previousNickname=linkNicknameFromImportedPrompt(target.systemPrompt||'');
    return !!previousNickname && target.description.trim()===previousNickname;
}
