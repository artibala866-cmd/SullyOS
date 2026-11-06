import React, { useEffect, useRef, useState } from 'react';
import {
    EMOJI_DOCUMENT_FILE_ACCEPT,
    importEmojiDocument,
} from '../../utils/emojiDocumentImport';

interface EmojiDocumentFilePickerProps {
    active: boolean;
    disabled?: boolean;
    onAppendText: (value: string) => void;
}

/** Small file-import control inside the existing private-chat 表情注入 modal. */
export default function EmojiDocumentFilePicker({
    active, disabled = false, onAppendText,
}: EmojiDocumentFilePickerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const operationRef = useRef(0);
    const [reading, setReading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!active) {
            operationRef.current++;
            setReading(false);
            setStatus('');
            setError(false);
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
        setError(false);
        setStatus('正在读取文件并识别表情包…');
        try {
            let count = 0, ignored = 0;
            const normalized: string[] = [];
            for (const file of files) {
                const result = await importEmojiDocument(file);
                if (operationRef.current !== id) return;
                count += result.entries.length;
                ignored += result.ignoredLines;
                if (count > 3000) throw new Error('一次最多识别 3000 张表情，请分批导入');
                normalized.push(result.text);
            }
            if (operationRef.current !== id) return;
            // Preview before saving; do not erase any pasted/edited rows.
            onAppendText(normalized.join('\n'));
            setStatus('已从 ' + files.length + ' 个文件识别 ' + count + ' 条表情' +
                (ignored ? '，忽略 ' + ignored + ' 行非表情文字' : '') +
                '。确认内容后点击下方添加。');
        } catch (cause) {
            if (operationRef.current !== id) return;
            setError(true);
            setStatus(cause instanceof Error ? cause.message : '文件读取失败，请重新选择');
        } finally {
            if (operationRef.current === id) setReading(false);
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
        </div>
    );
}
