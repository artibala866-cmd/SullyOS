// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
    compareStoryOpeningNames, MAX_STORY_OPENING_FILES, planStoryOpeningDocumentImport,
    readStoryOpeningDocuments, sortCustomStoryOpenings,
} from './storyOpeningDocumentImport';

const txt = (name: string, body: string) => new File([body], name, { type: 'text/plain' });
const nextIds = () => {
    let index=0;
    return () => `story-custom-import-${++index}`;
};
const docx = async (name: string, paragraphs: string[]) => {
    const zip = new JSZip();
    const xml = '<w:document><w:body>' + paragraphs.map(p =>
        `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>';
    zip.file('word/document.xml', xml);
    return new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'})).buffer],name);
};

describe('开场白文件多选导入', () => {
    it('按自然数字顺序读取 TXT 与 DOCX，每个文件完整保留多段正文', async () => {
        const files = [
            txt('开场白10.txt','第十幕\n第二段'),
            await docx('开场白2.docx',['第二幕','雨下得很大']),
            txt('开场白1.TXT','第一幕'),
        ];
        const incoming = await readStoryOpeningDocuments(files);
        expect(incoming.map(x=>x.filename)).toEqual(['开场白1.TXT','开场白2.docx','开场白10.txt']);
        expect(incoming.map(x=>x.content)).toEqual(['第一幕','第二幕\n雨下得很大','第十幕\n第二段']);
        const plan = planStoryOpeningDocumentImport([],incoming,[],nextIds());
        expect(plan.greetings.map(g=>g.title)).toEqual(['开场白1','开场白2','开场白10']);
        expect(plan.greetings.map(g=>g.content)).toEqual(incoming.map(x=>x.content));
    });
    it('批量导入保留已有酒馆顺序，只有自定义开场使用 1、2、10 排序', () => {
        const existing = [
            {id:'tavern-a',title:'原作者结局',content:'第一段作者内容'},
            {id:'story-custom-old',title:'开场白10',content:'旧第十幕'},
            {id:'tavern-b',title:'原作者序章',content:'第二段作者内容'},
            {id:'story-custom-two',title:'开场白2',content:'旧第二幕'},
        ];
        const planned = planStoryOpeningDocumentImport(existing,[
            {filename:'开场白3.txt',content:'第三幕'},
            {filename:'开场白1.docx',content:'第一幕'},
        ],[],nextIds());
        expect(planned.greetings.map(g=>g.title)).toEqual([
            '原作者结局','原作者序章','开场白1','开场白2','开场白3','开场白10',
        ]);
        expect(planned.greetings.filter(g=>!g.id.startsWith('story-custom-')))
            .toEqual([existing[0],existing[2]]);
        expect(existing[1].title).toBe('开场白10'); // pure, does not change stored source
    });
    it('跳过完全相同正文；同名不同内容安全建立编号副本，决不覆盖旧开场', () => {
        const existing=[{id:'story-custom-1',title:'开场白1',content:'旧内容'}];
        const docs=[
            {filename:'开场白1.docx',content:'新内容'},
            {filename:'开场白1.txt',content:'新内容'},
            {filename:'开场白10.txt',content:'原有 Link 开场'},
            {filename:'开场白2.txt',content:'别的正文'},
        ];
        const p = planStoryOpeningDocumentImport(existing,docs,[{title:'Link序章',content:'原有 Link 开场'}],nextIds());
        expect(p.skipped).toBe(2);
        expect(p.added.map(x=>x.title)).toEqual(['开场白1 (2)','开场白2']);
        expect(p.greetings.find(x=>x.id==='story-custom-1')?.content).toBe('旧内容');
        const again = planStoryOpeningDocumentImport(p.greetings, docs,[{title:'Link序章',content:'原有 Link 开场'}],nextIds());
        expect(again.added).toEqual([]);
        expect(again.skipped).toBe(4);
    });
    it('文件名数字排序不把 10 排到 2 前；同名文件不会丢正文', () => {
        expect(compareStoryOpeningNames('开场白2','开场白10')).toBeLessThan(0);
        const a = [{id:'story-custom-10',title:'开场白10'}, {id:'tavern-2',title:'原作者'},
            {id:'story-custom-1',title:'开场白1'}, {id:'story-custom-2',title:'开场白2'}];
        expect(sortCustomStoryOpenings(a).map(x=>x.title)).toEqual(['原作者','开场白1','开场白2','开场白10']);
    });
    it('损坏 DOCX、伪装扩展名、空文本、过长内容明确失败，不可产生半截结果', async () => {
        await expect(readStoryOpeningDocuments([txt('开场白1.txt','正常'), txt('空白.txt','')]))
            .rejects.toThrow('空白.txt');
        await expect(readStoryOpeningDocuments([txt('开场白1.txt','正常'),txt('伪装.docx','坏文件')]))
            .rejects.toThrow('伪装.docx');
        await expect(readStoryOpeningDocuments([txt('非法.json','{}')]))
            .rejects.toThrow('TXT 或 DOCX');
        await expect(readStoryOpeningDocuments([txt('过长.txt','X'.repeat(200_001))]))
            .rejects.toThrow('20 万字符');
        await expect(readStoryOpeningDocuments(Array.from({length:MAX_STORY_OPENING_FILES+1},
            (_,i)=>txt(`编号${i}.txt`,'正文')))).rejects.toThrow('最多导入');
        expect(() => planStoryOpeningDocumentImport([],[
            {filename:'开场白1.txt',content:'正常'},
            {filename:'开场白2.txt',content:'X'.repeat(200_001)},
        ],[],nextIds())).toThrow('20 万字符');
    });
    it('旧角色卡采用 CRLF、导入文件采用 LF 时不会产生重复开场，也不会修改旧数据', () => {
        const existing = [
            {id: 'story-custom-existing', title: '雨夜', content: '第一幕\r\n第二幕'},
        ];
        const incoming = [
            {filename: '雨夜.txt', content: '第一幕\n第二幕'},
            {filename: '另一幕.docx', content: '这是新的剧情'},
        ];
        const original = existing[0].content;
        const result = planStoryOpeningDocumentImport(existing, incoming, [], nextIds());
        expect(result.skipped).toBe(1);
        expect(result.added.map(item => item.title)).toEqual(['另一幕']);
        expect(existing[0].content).toBe(original);
    });

    it('保留 Word 的自闭合空段，按扩展名读取误标 MIME 的 TXT', async () => {
        const zip = new JSZip();
        zip.file('word/document.xml', '<w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>第三段</w:t></w:r></w:p>');
        const word = await zip.generateAsync({ type: 'arraybuffer' });
        const files = [
            new File(['文本'], '1.txt', { type: 'application/pdf' }),
            new File([word], '2.docx'),
        ];
        expect((await readStoryOpeningDocuments(files)).map(doc => doc.content)).toEqual(['文本', '第一段\n\n第三段']);
        await expect(readStoryOpeningDocuments([new File([word], '伪装.txt')])).rejects.toThrow('扩展名与文件内容不符');
    });

    it('连续未闭合的 Word 段落拒绝导入，不截取前面看起来正常的内容', async () => {
        const zip = new JSZip();
        zip.file('word/document.xml', '<w:p><w:t>正常段落</w:t></w:p>' + '<w:p>'.repeat(100_000));
        const word = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
        await expect(readStoryOpeningDocuments([new File([word], '残缺.docx')])).rejects.toThrow('正文结构不完整');
    });

    it('实际 DOCX 解压量超限时拒绝伪造的较小声明', async () => {
        const zip = new JSZip();
        zip.file('word/document.xml', '<w:p><w:t>' + 'X'.repeat(8_000_100) + '</w:t></w:p>');
        const word = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
        const view = new DataView(word);
        const directoryOffset = view.getUint32(word.byteLength - 6, true);
        view.setUint32(directoryOffset + 24, 64, true);
        await expect(readStoryOpeningDocuments([new File([word], '超限.docx')])).rejects.toThrow('Word 文档正文过大');
    });

    it('拒绝无效或冲突的唯一 ID，避免覆盖另一个已保存的剧情开场', () => {
        expect(() => planStoryOpeningDocumentImport([{id:'story-custom-same',title:'1',content:'旧'}],[
            {filename:'2.txt',content:'新'},
        ],[],()=> 'story-custom-same')).toThrow('标识');
    });
});
