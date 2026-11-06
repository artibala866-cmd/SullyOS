import React, { useEffect, useRef, useState } from 'react';
import {
    EMOJI_DOCUMENT_FILE_ACCEPT,
    importEmojiDocument,
} from '../../utils/emojiDocumentImport';

interface EmojiDocumentFilePickerProps {
    active: boolean;
    disabled?: boolean;
    onAppendText: (value: string) => void;
    onReadingChange?: (reading: boolean) => void;
}

/** Small file-import control inside the existing private-chat 表情注入 modal. */
export default function EmojiDocumentFilePicker({
    active, disabled = false, onAppendText, onReadingChange,
}: EmojiDocumentFilePickerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const operationRef = useRef(0);
    const [reading, setReading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState(false);
    const [reviewNotes, setReviewNotes] = useState<string[]>([]);

    useEffect(() => {
        if (!active) {
            operationRef.current++;
            setReading(false);
            onReadingChange?.(false);
            setStatus('');
            setError(false);
            setReviewNotes([]);
        }
    }, [active]);

    const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files || []);
        // Allow selecting the same file again after editing or an earlier failure.
        event.currentTarget.value = '';
        if (files.length === 0 || reading || disabled || !active) return;
        if (files.length > 8) {
            setError(true);
            setStatus('一次最多选择 8 个文件，请分批导入');
            return;
        }
        const id = ++operationRef.current;
        setReading(true);
        onReadingChange?.(true);
        setError(false);
        setStatus('正在读取文件并识别表情包…');
        try {
            let count = 0, ignored = 0, successFiles = 0, generated = 0, totalChars = 0;
            const normalized: string[] = [];
            const failed: string[] = [];
            const suspicious: string[] = [];
            for (const file of files) {
                try {
                    const result = await importEmojiDocument(file);
                    if (operationRef.current !== id) return;
                    if (count + result.entries.length > 3000 || totalChars + result.text.length > 1_800_000) {
                        failed.push(file.name + '：超过批量条数或文本长度上限，请拆分文件');
                        continue;
                    }
                    count += result.entries.length;
                    ignored += result.ignoredLines;
                    generated += result.generatedNames || 0;
                    totalChars += result.text.length;
                    successFiles++;
                    normalized.push(result.text);
                    for (const row of result.suspiciousLines || []) {
                        if (suspicious.length < 8) suspicious.push(file.name + '：' + row);
                    }
                } catch (cause) {
                    if (operationRef.current !== id) return;
                    const why = cause instanceof Error ? cause.message : '文件无法读取';
                    failed.push(file.name + '：' + why);
                }
            }
            if (operationRef.current !== id) return;
            // Keep recognized files even if one file is corrupt; never silently drop failed ones.
            if (normalized.length) onAppendText(normalized.join('\n'));
            setReviewNotes([...failed, ...suspicious]);
            setError(failed.length > 0 || suspicious.length > 0);
            if (successFiles) {
                setStatus(
                    '已识别 ' + successFiles + '/' + files.length + ' 个文件，共 ' + count + ' 条表情' +
                    (ignored ? '；忽略 ' + ignored + ' 行非表情文字' : '') +
                    (generated ? '；' + generated + ' 条无名称链接按文件名命名' : '') +
                    (failed.length ? '；另有 ' + failed.length + ' 个文件失败' : '') +
                    (suspicious.length ? '；有 ' + suspicious.length + ' 行含链接但未识别' : '') +
                    '。结果已添加到下方预览框，尚未保存。'
                );
            } else {
                setStatus('未能从所选文件导入表情，请查看下方原因；原有内容没有变化。');
            }
        } catch (cause) {
            if (operationRef.current !== id) return;
            setError(true);
            setReviewNotes([]);
            setStatus(cause instanceof Error ? cause.message : '文件读取失败，请重新选择');
        } finally {
            if (operationRef.current === id) {
                setReading(false);
                onReadingChange?.(false);
            }
        }
    };

    return (
        <div className="space-y-1.5">
            <input
                ref={fileInputRef}
                type="file"
                accept={EMOJI_DOCUMENT_FILE_ACCEPT}
                multiple
                onChange={handleFiles}
                aria-label="选择表情包文档"
                className="hidden"
                tabIndex={-1}
            />
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={reading || disabled}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                    {reading ? '识别中…' : '选择文件导入'}
                </button>
                <span className="min-w-0 text-[11px] text-slate-400">TXT / Word / PDF / CSV / MD 等</span>
            </div>
            {status && (
                <p role="status" aria-live="polite" className={'text-[11px] ' + (error ? 'text-rose-500' : 'text-slate-500')}>
                    {status}
                </p>
            )}
            {reviewNotes.length > 0 && (
                <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer font-semibold">查看失败文件 / 可能遗漏的链接（{reviewNotes.length} 条）</summary>
                    <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto break-all rounded-xl bg-slate-50 p-2">
                        {reviewNotes.map((note, index) => <li key={index}>{note}</li>)}
                    </ul>
                </details>
            )}
        </div>
    );
}
