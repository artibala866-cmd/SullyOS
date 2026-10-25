import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import TokenImg from '../os/TokenImg';
import { putImageBlob } from '../../utils/blobRef';

/**
 * User identity for image generation is independent from the app avatar.
 * Keep the same card/typography as the existing Personal Archive profile.
 * All fields live on UserProfile, so standard backups include the reference.
 */
export default function UserImageIdentitySection() {
    const { userProfile, updateUserProfile, addToast } = useOS();
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const uploadRevision = useRef(0);
    useEffect(() => () => { uploadRevision.current += 1; }, []);

    const reference = userProfile.imageReference || '';
    const upload = async (file?: File) => {
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            setStatus('请上传 PNG、JPG 或 WebP 图片');
            return;
        }
        if (!file.size || file.size > 10 * 1024 * 1024) {
            setStatus('锁脸参考图大小应在 10 MB 以内');
            return;
        }
        const revision = ++uploadRevision.current;
        setBusy(true);
        setStatus('');
        try {
            // Store the bytes separately from the profile JSON; preserve face detail.
            const token = await putImageBlob(file);
            if (revision !== uploadRevision.current) return;
            updateUserProfile({ imageReference: token, imageLockEnabled: true });
            setStatus('user 锁脸参考图已保存');
            addToast('user 锁脸参考图已更新', 'success');
        } catch (error) {
            if (revision === uploadRevision.current) {
                setStatus('图片保存失败：' + (error instanceof Error ? error.message : String(error)));
            }
        } finally {
            if (revision === uploadRevision.current) setBusy(false);
        }
    };

    return <details className="group bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(76,76,76,0.18)] border border-slate-100 overflow-hidden">
        <summary className="cursor-pointer list-none flex items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
            <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden="true">✦</span>
            <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-700">user 身份 · 生图锁脸</span>
                <span className="block mt-1 text-[11px] text-slate-400">
                    {reference && userProfile.imageLockEnabled ? '已启用参考图' : reference ? '已保存参考图，当前关闭' : '设置个人外貌和专属参考图'}
                </span>
            </span>
            <span className="text-slate-400 text-xl group-open:rotate-90 transition-transform" aria-hidden="true">›</span>
        </summary>
        <div className="border-t border-slate-100 px-5 py-5 space-y-4">
            <p className="text-[11px] text-slate-400 leading-relaxed">
                这份资料仅供 AI 生图使用，不会改变你的聊天头像、角色人设或关于我的介绍。
                user 在私聊发送自拍或包含自己的照片时，可以使用这张图保持人物五官一致。
            </p>
            <label className="block space-y-2">
                <span className="text-[11px] font-bold text-slate-500">生图外貌描述</span>
                <textarea rows={3} value={userProfile.imageAppearance || ''}
                    onChange={e => updateUserProfile({ imageAppearance: e.target.value })}
                    placeholder="例如：黑色长发、棕色眼睛、脸型与五官特征。不要写固定服装和背景。"
                    className="w-full bg-slate-50 focus:bg-white border border-slate-100 focus:border-primary/30 rounded-2xl px-4 py-3 text-sm text-slate-700 leading-relaxed resize-y outline-none placeholder:text-slate-300" />
            </label>
            <label className="block space-y-2">
                <span className="text-[11px] font-bold text-slate-500">专属锁脸参考图</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                    onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-600" />
            </label>
            {reference && <div className="space-y-2">
                <TokenImg value={reference} alt="user 锁脸参考图" className="max-h-48 w-auto max-w-full rounded-xl object-contain border border-slate-100" />
                <button type="button" className="text-xs text-slate-500 underline" onClick={() => {
                    uploadRevision.current += 1;
                    updateUserProfile({ imageReference: '', imageLockEnabled: false });
                    setBusy(false);
                    setStatus('已移除 user 锁脸参考图');
                }}>移除参考图</button>
            </div>}
            <label className="flex items-center gap-3 text-xs text-slate-600">
                <input type="checkbox" className="accent-primary w-4 h-4" checked={!!userProfile.imageLockEnabled && !!reference}
                    disabled={!reference}
                    onChange={event => updateUserProfile({ imageLockEnabled: event.target.checked })} />
                允许私聊 AI 发图时使用我的锁脸参考图
            </label>
            <p className="text-[11px] text-slate-400 leading-relaxed">
                头像和锁脸参考图相互独立。普通本地发图不会调用 AI；启用后，只在你选择使用锁脸生图时上传参考图给当前生图服务。
            </p>
            {busy && <p className="text-xs text-slate-400">正在保存参考图…</p>}
            {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
        </div>
    </details>;
}
