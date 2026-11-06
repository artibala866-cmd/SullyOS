/** Chromium QA harness mounts the ACTUAL ChatModals, not a mock-up. */
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatModals from '../components/chat/ChatModals';
import JSZip from 'jszip';
import { DB } from '../utils/db';
import { parseEmojiImportText, planEmojiImport } from '../utils/emojiImport';

const observations: string[] = [];
window.addEventListener('error', e => observations.push(e.message));
window.addEventListener('unhandledrejection', e => observations.push(String(e.reason)));
function Fixture() {
    const [emojiImportText, setEmojiImportText] = useState('这是一行来自旧粘贴内容的无效格式');
    const [modalType, setModalType] = useState('emoji-import');
    return <ChatModals {...({
        modalType, setModalType,
        emojiImportText, setEmojiImportText,
        emojiImportBusy: false,
        emojiImportCategoryName: '测试分类',
        onImportEmoji: async () => {
            const parsed = parseEmojiImportText(emojiImportText);
            if (parsed.invalidLineNumbers.length) throw new Error('Invalid lines reached actual save');
            const category = { id: 'qa-emoji-cat', name: '测试分类' };
            await DB.saveEmojiCategory(category);
            const existing = await DB.getEmojis();
            const plan = planEmojiImport(parsed.entries, existing, category.id);
            await DB.saveEmojisBatch(plan.additions.map(e => ({ ...e, categoryId: category.id })));
            const persisted = await DB.getEmojis();
            const kept = persisted.filter(e => e.categoryId === category.id);
            document.body.dataset.emojiStored = JSON.stringify({
                count: kept.length, names: kept.map(e => e.name), categories: (await DB.getEmojiCategories()).map(c => c.id),
            });
            setModalType('none');
        },
        transferAmt: '', transferNote: '',
        settingsContextLimit: 500,
        settingsContextRangeMode: 'manual',
        settingsHideSysLogs: false,
        settingsInputPreferences: {},
        contextSuiteAnyEnabled: false,
        contextSuiteAllEnabled: false,
        editContent: '', newCategoryName: '', newEmojiName: '',
        activeCharacter: {id:'synthetic-test-char',name:'浏览器截图角色',autoArchiveEnabled:false}, messages: [], allHistoryMessages: [],
        allCharacters: [], apiPresets: [], selectedCategory: null,
        scheduleData: null,
        onTransfer: () => {}, onSaveSettings: () => {},
        onSetHistoryStart: () => {},
        setSettingsContextLimit: () => {},
        setSettingsContextRangeMode: () => {},
        setSettingsHideSysLogs: () => {},
        setSettingsInputPreferences: () => {},
        setTransferAmt: () => {}, setTransferNote: () => {},
        setEditContent: () => {},
        setNewCategoryName: () => {},
        setNewEmojiName: () => {},
    } as any)} />;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
function bounds(el: Element | null) {
    if (!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};
}
/** A real, parseable one-page PDF fixture, not mocked text. */
function tinyPdf(): Uint8Array {
    const streamA = 'BT /F1 12 Tf 45 755 Td (PDFhappy--https://example.com/pdf.png) Tj ET';
    const streamB = 'BT /F1 12 Tf 45 755 Td (PDFsecond--https://example.com/pdf2.gif) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + streamA.length + ' >>\nstream\n' + streamA + '\nendstream',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
        '<< /Length ' + streamB.length + ' >>\nstream\n' + streamB + '\nendstream',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for(let i=0;i<objects.length;i++){
        offsets.push(pdf.length);
        pdf += (i+1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
    }
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length+1) + '\n0000000000 65535 f \n';
    for(let i=1;i<offsets.length;i++)pdf += String(offsets[i]).padStart(10,'0') + ' 00000 n \n';
    pdf += 'trailer\n<< /Root 1 0 R /Size '+(objects.length+1)+' >>\nstartxref\n'+xref+'\n%%EOF\n';
    return new TextEncoder().encode(pdf);
}
async function wordDocx(): Promise<File> {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Wordhappy--https://example.com/word.gif</w:t></w:r></w:p></w:body></w:document>');
    return new File([await zip.generateAsync({type:'uint8array'})],'stickers.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

async function exercise() {
    try {
        let input:HTMLInputElement|null=null;
        for(let attempt=0;attempt<100;attempt++){
            input=document.querySelector<HTMLInputElement>('input[aria-label="选择表情包文档"]');
            if(input)break;
            await new Promise(r=>setTimeout(r,60));
        }
        if(!input)throw new Error('The actual emoji file chooser did not render; errors=' + JSON.stringify(observations) + '; DOM=' + (document.body?.innerText || '').slice(0,1300));
        const file=new File([
            '来源说明：示例文档\n',
            '开心：https://example.com/a.gif\n',
            'https://files.catbox.moe/abc123.png\n',
            'https://example.com/b.gif 不理人\n'
        ],'emoji-qa.txt',{type:'text/plain'});
        const transfer=new DataTransfer(); transfer.items.add(file);
        transfer.items.add(await wordDocx());
        transfer.items.add(new File([tinyPdf()], 'stickers.pdf', {type:'application/pdf'}));
        input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        let status='';
        for(let attempt=0;attempt<120;attempt++){
            status=document.querySelector('[role="status"]')?.textContent || '';
            if(status.includes('已识别') || status.includes('未能'))break;
            await new Promise(r=>setTimeout(r,70));
        }
        const dialog=[...document.querySelectorAll('h3')].find(el=>el.textContent?.includes('表情注入'))?.closest('.relative') || null;
        const footer=[...document.querySelectorAll('button')].find(el=>el.textContent?.includes('添加至当前分类')) || null;
        const textarea=document.querySelector<HTMLTextAreaElement>('textarea');
        const cleanButton=[...document.querySelectorAll('button')].find(el=>el.textContent?.includes('只保留已识别内容')) as HTMLButtonElement | undefined;
        const report = {
            viewport:[innerWidth,innerHeight],status,
            recognizedText:textarea?.value || '',
            fileButtonVisible:!!input && !!document.querySelector('button')?.textContent,
            dialog:bounds(dialog),footer:bounds(footer),textarea:bounds(textarea),
            overflowX:document.documentElement.scrollWidth-innerWidth,
            footerVisible:!!footer && footer.getBoundingClientRect().bottom<=innerHeight+2,
            cleanButtonVisible:!!cleanButton,saveBlockedUntilClean:(footer as HTMLButtonElement)?.disabled,
            errors:observations,
        };
        const okay=report.recognizedText.includes('开心--https://example.com/a.gif') &&
            report.recognizedText.includes('abc123--https://files.catbox.moe/abc123.png') &&
            report.recognizedText.includes('不理人--https://example.com/b.gif') &&
            report.recognizedText.includes('Wordhappy--https://example.com/word.gif') &&
            report.recognizedText.includes('PDFhappy--https://example.com/pdf.png') &&
            report.recognizedText.includes('PDFsecond--https://example.com/pdf2.gif') &&
            report.status.includes('3/3 个文件，共 6 条表情') &&
            report.cleanButtonVisible && report.saveBlockedUntilClean &&
            report.footerVisible && report.overflowX<=2 && report.errors.length===0;
        document.querySelector('#qa-report')!.textContent=JSON.stringify(report);
        document.body.dataset.emojiDocumentVisualReady=String(okay);
    } catch(e) {
        document.body.dataset.emojiDocumentVisualReady='false';
        document.querySelector('#qa-report')!.textContent=String(e instanceof Error ? e.stack : e);
    }
}
setTimeout(()=>{void exercise()},180);
