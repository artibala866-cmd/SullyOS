import React from 'react';
import type { StoryTheaterPresetDocument } from '../../../types';

/** Only observable import facts. Do not imply unavailable plugins were run. */
const StoryTavernImportReport: React.FC<{
    document: StoryTheaterPresetDocument;
    label?: string;
}> = ({ document, label }) => {
    if (document.sourceFormat !== 'sillytavern') return null;
    const audit = document.tavernImportAudit;
    const warnings = document.importWarnings || [];
    const enabled = document.prompts.filter(prompt => prompt.enabled).length;
    const disabled = document.prompts.length - enabled;
    return <details data-story-import-report='true'
        className='rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-slate-700'>
        <summary className='cursor-pointer text-[11px] font-semibold leading-5'>
            {label ? label + ' · ' : ''}兼容性报告
            <span className='ml-2 text-[10px] font-normal text-amber-800'>
                {warnings.length ? `${warnings.length} 项需要核对` : '未检测到已知问题'}
            </span>
        </summary>
        <div className='mt-3 space-y-2 text-[10px] leading-5'>
            {audit ? <>
                <p>原文件 {audit.sourceEntries} 条 · 已导入 {audit.importedEntries} 条 ·
                    原作者开关开启 {audit.enabledEntries} 条 ·
                    未进入排序表 {audit.unlistedEntries} 条（保留但关闭）</p>
                <p>作者排序表 {audit.orderTableCount} 套 · 作者分组 {document.tavernEntryGroups?.length || 0} 个</p>
                {(audit.skippedRegexCount > 0 || audit.skippedScriptCount > 0) &&
                    <p className='font-semibold text-amber-900'>
                        不会执行：{audit.skippedRegexCount} 条酒馆正则、
                        {audit.skippedScriptCount} 个酒馆脚本
                    </p>}
            </> : <>
                <p>当前保存条目 {document.prompts.length} 条 · 开启 {enabled} 条 · 关闭 {disabled} 条</p>
                <p>旧版导入未保存完整来源统计，无法确认最初漏列的条目和插件数量。</p>
            </>}
            {warnings.length ? <ul className='list-disc space-y-1 pl-4'>
                {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul> : <p>未发现已知兼容警告，但这不代表所有酒馆动态功能都能运行。</p>}
            <p className='text-slate-500'>导入的原文、顺序和开关被保留；酒馆专属脚本、插件、部分宏与模型参数不保证等价。请按上方提示核对实际效果。</p>
        </div>
    </details>;
};

export default StoryTavernImportReport;
