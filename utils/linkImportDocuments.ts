/**
 * LINK 1.1.10's AddFriend import accepts TXT/DOC/DOCX as independent persona
 * documents (not Tavern cards). No API call or interpreted script is involved.
 * Word text is extracted, not rendered as untrusted HTML in the app.
 */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 2_000_000;
const CFB_SIGNATURE = [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
const begins = (bytes: Uint8Array, sig: number[]) => sig.every((x,i)=>bytes[i]===x);

const decodeBytes = (bytes: Uint8Array): string => {
    if (begins(bytes,[0xef,0xbb,0xbf])) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (begins(bytes,[0xff,0xfe])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (begins(bytes,[0xfe,0xff])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    const head=bytes.subarray(0,Math.min(bytes.length,4096));
    let odd=0,even=0;
    for(let i=0;i<head.length;i++) if(head[i]===0) i%2?odd++:even++;
    if(odd>head.length/8&&odd>even*3) return new TextDecoder('utf-16le').decode(bytes);
    if(even>head.length/8&&even>odd*3) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch {
        try { return new TextDecoder('gb18030',{fatal:true}).decode(bytes); }
        catch { return new TextDecoder('windows-1252').decode(bytes); }
    }
};
const unescapeXml = (s:string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,token:string)=>{
    const t=token.toLowerCase();
    const common:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    if(common[t]!==undefined)return common[t];
    const n=t.startsWith('#x')?parseInt(t.slice(2),16):parseInt(t.slice(1),10);
    return Number.isFinite(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):all;
});
export const docxXmlToText = (xml:string):string => {
    const paragraphs:string[]=[];
    for(const match of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi)){
        const parts:string[]=[];
        const tokens=/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/gi;
        for(const token of match[0].matchAll(tokens))
            parts.push(token[1]!==undefined?unescapeXml(token[1]):/^<w:tab/i.test(token[0])?'\t':'\n');
        paragraphs.push(parts.join(''));
    }
    return paragraphs.join('\n').trim();
};
const readDocx = async (buffer:ArrayBuffer):Promise<string> => {
    const JSZip=(await import('jszip')).default;
    let archive:InstanceType<typeof JSZip>;
    try { archive=await JSZip.loadAsync(buffer); }
    catch { throw new Error('DOCX 文件损坏，无法安全解压'); }
    const file=archive.file('word/document.xml');
    if(!file) throw new Error('DOCX 中没有 Word 正文，请检查文件格式');
    if((file as any)._data?.uncompressedSize>MAX_DOCUMENT_TEXT*4)throw new Error('Word 文档正文过大');
    const xml=await file.async('string');
    if(xml.length>MAX_DOCUMENT_TEXT*4) throw new Error('Word 文档正文过大');
    return docxXmlToText(xml);
};
const removeHtmlFormatting=(html:string):string=>unescapeXml(html
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'')
    .replace(/<br\b[^>]*\/?>|<\/(?:p|div|li|tr|h[1-6])>/gi,'\n')
    .replace(/<[^>]*>/g,'')).trim();
const dropRtfMetadata = (source:string):string=>{
    // Word's RTF font and colour tables are not character persona prose.
    // Strip balanced metadata groups, never the outer RTF document or ordinary
    // paragraphs. This also avoids accidentally importing "Arial" as lore.
    const ignored=/^\{\\(?:\*\\)?(?:fonttbl|colortbl|stylesheet|info|generator|listtable|listoverridetable|pict|object)\b/i;
    let output='';
    for(let i=0;i<source.length;){
        if(source[i]==='{' && ignored.test(source.slice(i,i+80))){
            let depth=0,j=i;
            for(;j<source.length;j++){
                const escaped=j>0 && source[j-1]==='\\' && !(j>1&&source[j-2]==='\\');
                if(escaped)continue;
                if(source[j]==='{')depth++;
                else if(source[j]==='}'&&--depth===0){j++;break;}
            }
            if(depth!==0)throw new Error('RTF 文档结构不完整，请另存为 DOCX');
            i=j;continue;
        }
        output+=source[i++];
    }
    return output;
};
const parseRtf=(source:string):string=>{
    // Older .doc exports may actually be RTF. Chinese ANSI RTF encodes
    // multibyte GBK text as \'d6\'d0. The previous parser dropped every
    // escaped byte, silently deleting entire paragraphs of character lore.
    const cp=source.match(/\\ansicpg(\d+)/i)?.[1]||'1252';
    const enc:Record<string,string>={
        '936':'gb18030','54936':'gb18030','950':'big5','932':'shift_jis',
        '949':'euc-kr','1252':'windows-1252','65001':'utf-8',
    };
    const encoding=enc[cp];
    let text=dropRtfMetadata(source);
    if(/\\'[a-f0-9]{2}/i.test(text)){
        if(!encoding)throw new Error('RTF 文档使用未支持的文字编码，请另存为 DOCX');
        try{
            text=text.replace(/(?:\\'[a-f0-9]{2})+/gi,run=>{
                const bytes=[...run.matchAll(/\\'([a-f0-9]{2})/gi)]
                    .map(match=>parseInt(match[1],16));
                return new TextDecoder(encoding,{fatal:true}).decode(new Uint8Array(bytes));
            });
        }catch{
            throw new Error('RTF 的旧编码文字无法完整还原，请另存为 DOCX，避免人设缺字');
        }
    }
    return text
        .replace(/\{\\\*(?:[^{}]|\{[^{}]*\})*\}/g,'')
        .replace(/\\u(-?\d+)\??/g,(_all,n:string)=>String.fromCharCode((parseInt(n,10)+65536)%65536))
        .replace(/\\(?:par|line)\b\s?/g,'\n').replace(/\\tab\b\s?/g,'\t')
        .replace(/\\[a-z]+\d* ?/gi,'')
        .replace(/\\([{}\\])/g,'$1').replace(/[{}]/g,'').trim();
};

/**
 * JSON worldbooks are NOT persona documents: historical Sully worldbook files
 * can be larger than the 2M-character limit for a role persona. Use the same
 * tolerant UTF-8/GBK/UTF-16 decoder with the existing 32MB file-size limit,
 * without DOCX/RTF/HTML conversion or accidental truncation.
 */
export const readLinkWorldbookJsonText=async(file:File):Promise<string>=>{
    if(file.size<=0||file.size>32*1024*1024)throw new Error('世界书 JSON 为空或超过 32 MB');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(begins(bytes,CFB_SIGNATURE)||begins(bytes,[0x50,0x4b,0x03,0x04]))
        throw new Error('世界书 JSON 文件内容其实是 Word/ZIP，请选择正确文件');
    const source=decodeBytes(bytes).replace(/^\uFEFF/,'').trim();
    if(!source||source.includes('\u0000'))throw new Error('世界书 JSON 内容为空或包含无效二进制数据');
    return source;
};
export const isLinkPersonaDocument=(file:Pick<File,'name'|'type'>):boolean=>
    /\.(?:txt|text|doc|docx)$/i.test(file.name)||
    /^(?:text\/plain|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i.test(file.type||'');

/**
 * Reads source bytes; never uses .text() alone because Chinese TXT may be GBK.
 * Old binary DOC needs a CFB parser. Avoid returning garbled garbage as persona.
 */
export const readLinkPersonaDocument=async(file:File):Promise<string>=>{
    if(file.size<=0||file.size>MAX_DOCUMENT_BYTES)throw new Error('角色文档为空或超过 25 MB');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const name=file.name.toLowerCase();
    let text:string;
    if(name.endsWith('.docx')||begins(bytes,[0x50,0x4b,0x03,0x04])){
        text=await readDocx(bytes.buffer);
    }else if(begins(bytes,CFB_SIGNATURE)){
        throw new Error('旧版二进制 DOC 暂不支持直接提取，请在 Word/WPS 中另存为 DOCX 或 TXT 后导入；不会把乱码写进人设');
    }else{
        const decoded=decodeBytes(bytes).replace(/^\uFEFF/,'');
        text=/^\s*\{\\rtf\d/i.test(decoded)?parseRtf(decoded)
            :/<(?:html|body|p|div)\b/i.test(decoded)&&/\.(?:doc|htm|html)$/i.test(name)
                ?removeHtmlFormatting(decoded):decoded;
    }
    text=text.replace(/\r\n?/g,'\n').trim();
    if(!text)throw new Error('角色文档中没有可读取的正文');
    if(text.length>MAX_DOCUMENT_TEXT)throw new Error('角色文档正文超过 200 万字符，请拆分后导入');
    if(text.includes('\u0000'))throw new Error('角色文档包含异常二进制内容，拒绝导入乱码');
    return text;
};
