
import UserSaveSection from '../components/user/UserSaveSection';
import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { processImage } from '../utils/file';
import { migrateDataUrlToRef } from '../utils/blobRef';
import LifeRecordPanel from '../components/lifeRecord/LifeRecordPanel';
import PerCharAvatarPicker from '../components/user/PerCharAvatarPicker';
import UserImageIdentitySection from '../components/user/UserImageIdentitySection';
import TokenImg from '../components/os/TokenImg';
import HomeFigureStudio from '../components/character/HomeFigureStudio';
import { trackEvent } from '../utils/analytics';
import { UploadSimple } from '@phosphor-icons/react';
import { beginUserSaveOperation } from '../utils/userSaves';
import { DOCUMENT_IMPORT_ACCEPT, readImportedTextDocument, planUserBioDocumentImport, type ImportedTextDocument, type UserBioImportMode } from '../utils/importTextDocument';

const UserApp: React.FC = () => {
    const { closeApp, userProfile, updateUserProfile, addToast } = useOS();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bioFileInputRef = useRef<HTMLInputElement>(null);
    const bioImportRelease = useRef<null | (() => void)>(null);
    const [pendingBioFile, setPendingBioFile] = useState<(ImportedTextDocument & {name:string}) | null>(null);
    const [bioImportMode, setBioImportMode] = useState<UserBioImportMode>('append');
    const [bioFileBusy, setBioFileBusy] = useState(false);
    const [bioSaving, setBioSaving] = useState(false);
    const [tab, setTab] = useState<'profile' | 'life'>('profile');
    const [showFigures, setShowFigures] = useState(false);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [identityBusy, setIdentityBusy] = useState(false);

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && !identityBusy && !avatarBusy) {
            setAvatarBusy(true);
            try {
                const base64 = await processImage(file);
                // 头像存令牌，二进制单独躺在 blob_assets 里（省掉 base64 那 ~33% 的膨胀）。
                // 同一张图之前存过就复用它的令牌；转不动时原样还回这条 data URL，图不会丢。
                await updateUserProfile({ avatar: await migrateDataUrlToRef(base64) });
                addToast('头像已更新', 'success');
            } catch (err: any) {
                addToast(err.message, 'error');
            } finally { setAvatarBusy(false); }
        }
    };

    const releaseBioImport = () => {
        bioImportRelease.current?.();
        bioImportRelease.current = null;
        setBioFileBusy(false);
    };
    useEffect(() => () => { bioImportRelease.current?.(); bioImportRelease.current = null; }, []);

    const handleBioFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || avatarBusy || identityBusy || bioFileBusy) return;
        try {
            const release = beginUserSaveOperation('导入个人档案');
            bioImportRelease.current = release;
            setBioFileBusy(true);
            const parsed = await readImportedTextDocument(file);
            setBioImportMode('append');
            setPendingBioFile({ ...parsed, name: file.name });
        } catch (error) {
            addToast(error instanceof Error ? error.message : '文件读取失败', 'error');
            releaseBioImport();
        }
    };
    const cancelBioImport = () => {
        if (bioSaving) return;
        setPendingBioFile(null);
        releaseBioImport();
    };
    const confirmBioImport = async () => {
        if (!pendingBioFile || bioSaving) return;
        setBioSaving(true);
        try {
            let changed = false;
            await updateUserProfile(prev => {
                const planned = planUserBioDocumentImport(prev.bio, pendingBioFile.text, bioImportMode);
                changed = planned.changed;
                return changed ? { bio: planned.bio } : {};
            });
            addToast(changed ? '个人设定已导入' : '这份内容已存在，无需重复导入', 'success');
            setPendingBioFile(null);
            releaseBioImport();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '个人设定保存失败', 'error');
        } finally {
            setBioSaving(false);
        }
    };

    if (showFigures) return <HomeFigureStudio onClose={() => setShowFigures(false)} />;
    return (
        <div className="h-full w-full bg-slate-50 flex flex-col animate-fade-in">
            {/* Header */}
            <div className="bg-white/70 backdrop-blur-md border-b border-slate-100 shrink-0 sticky top-0 z-10" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex items-center px-4 py-3 gap-2">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-bold text-slate-700 tracking-wide">个人档案</h1>
                </div>
                <p className="px-4 pb-2 text-[10px] leading-relaxed text-slate-400">生理期、药盒、记账与锻炼，也可以让角色帮你记。</p>
                {/* Tab：我的档案 / 生活记录 */}
                <div className="flex gap-1.5 px-4 pb-2.5">
                    {([['profile', '我的档案'], ['life', '生活记录']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => { setTab(key); trackEvent('切换个人档案标签页', { tab: key }); }}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                                tab === key ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-400'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div data-testid="archive-scroll" className="flex-1 overflow-y-auto px-5 pb-10 pt-5 space-y-5">
                {tab === 'life' && <LifeRecordPanel />}
                {tab === 'profile' && <>

                {/* Profile name card */}
                <div className="bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(76, 76, 76,0.25)] border border-slate-100 overflow-hidden">
                    {/* Cover banner */}
                    <div className="relative h-24" style={{ background: 'linear-gradient(135deg, hsl(var(--primary-hue),var(--primary-sat),72%) 0%, hsl(var(--primary-hue),var(--primary-sat),60%) 100%)' }}>
                        {/* soft decorative blobs */}
                        <div className="absolute -top-6 -right-4 w-28 h-28 rounded-full" style={{ background: 'rgba(255, 255, 255,0.18)' }} />
                        <div className="absolute top-6 left-6 w-16 h-16 rounded-full" style={{ background: 'rgba(255, 255, 255,0.12)' }} />
                    </div>

                    {/* Avatar overlapping the banner */}
                    <div className="px-6 pb-6 -mt-12">
                        <div
                            data-testid="archive-avatar"
                            onClick={() => { if (!identityBusy && !avatarBusy && !bioFileBusy) fileInputRef.current?.click(); }}
                            className="relative w-24 h-24 rounded-full cursor-pointer group mx-auto"
                        >
                            <div className="w-full h-full rounded-full ring-4 ring-white bg-slate-100 overflow-hidden shadow-md">
                                <TokenImg value={userProfile.avatar} className="w-full h-full object-cover group-hover:opacity-80 transition-opacity" />
                            </div>
                            {/* camera badge */}
                            <div className="absolute bottom-0.5 right-0.5 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center ring-2 ring-white shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                                </svg>
                            </div>
                        </div>
                        <input type="file" aria-label="更换档案头像" disabled={identityBusy || avatarBusy || bioFileBusy} ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                        <p className="mt-2 text-center text-[10px] text-slate-400">整体头像：所有聊天的默认。想在某个角色那儿换一副面孔？下面「分角色聊天头像」里设。</p>

                        <UserSaveSection disabled={avatarBusy || bioFileBusy} onBusyChange={setIdentityBusy} />
                    </div>
                </div>

                {/* User image identity is separate from avatar and chat persona, matching the archive's existing card styling. */}
                <UserImageIdentitySection />

                {/* 分角色聊天头像：上面的整体头像是宏观默认，这里可给每个角色的私聊单独换「你」的头像 */}
                <PerCharAvatarPicker />
                <button onClick={() => setShowFigures(true)} className="w-full text-left bg-white rounded-2xl p-5 border border-slate-100"><strong className="text-slate-700">我的手办柜</strong><span className="block text-sm text-slate-400 mt-1">Chibi 与 3D 家园形象</span></button>

                {/* About / setting card */}
                <div className="bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(76, 76, 76,0.18)] border border-slate-100 p-5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                                </svg>
                            </span>
                            <h2 className="text-sm font-bold text-slate-700 whitespace-nowrap">关于我 / 设定</h2>
                        </div>
                        <button type="button" onClick={() => bioFileInputRef.current?.click()}
                            aria-label="导入个人设定文件" disabled={identityBusy || avatarBusy || bioFileBusy}
                            className="shrink-0 h-8 px-3 rounded-full bg-slate-50 text-slate-600 border border-slate-100 flex items-center gap-1.5 text-xs font-semibold active:scale-95 disabled:opacity-40 transition">
                            <UploadSimple size={15} weight="bold" />导入
                        </button>
                        <input ref={bioFileInputRef} type="file" className="hidden"
                            aria-label="选择 TXT Word PDF 个人设定文件"
                            accept={DOCUMENT_IMPORT_ACCEPT} disabled={identityBusy || avatarBusy || bioFileBusy}
                            onChange={handleBioFileChange} />
                    </div>
                    <p className="text-[11px] text-slate-400 mb-3">TXT · Word · PDF</p>
                    <textarea
                        aria-label="关于我 / 设定"
                        disabled={identityBusy || bioFileBusy}
                        value={userProfile.bio}
                        onChange={(e) => { void updateUserProfile({ bio: e.target.value }).catch(error => addToast(error.message || '设定保存失败', 'error')); }}
                        className="w-full h-52 bg-slate-50 focus:bg-white border border-slate-100 focus:border-primary/30 rounded-2xl px-4 py-3 text-sm text-slate-700 leading-relaxed resize-none outline-none transition-all placeholder:text-slate-300"
                        placeholder="描述你自己..."
                    />
                </div>
                </>}
            </div>
            {pendingBioFile && (
                <div role="dialog" aria-modal="true" aria-label="导入个人设定"
                     className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/35 px-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:pb-3">
                    <div className="w-full max-w-sm rounded-[1.65rem] bg-white p-5 shadow-xl border border-slate-100">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-bold text-slate-800 text-base">导入个人设定</h3>
                            <button type="button" onClick={cancelBioImport} disabled={bioSaving}
                                aria-label="取消导入个人设定" className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 text-lg leading-none disabled:opacity-40">×</button>
                        </div>
                        <p className="text-sm text-slate-700 mt-3 font-semibold truncate" title={pendingBioFile.name}>{pendingBioFile.name}</p>
                        <p className="text-[11px] text-slate-400 mt-1">{pendingBioFile.format}{pendingBioFile.pageCount ? ' · ' + pendingBioFile.pageCount + ' 页' : ''} · {pendingBioFile.text.length.toLocaleString()} 字</p>
                        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 leading-relaxed line-clamp-4 whitespace-pre-wrap break-words max-h-28 overflow-hidden">
                            {pendingBioFile.text.slice(0,400)}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-4" role="group" aria-label="个人设定导入方式">
                            {([['append','追加'],['replace','替换']] as const).map(([value,label]) => (
                                <button key={value} type="button" aria-pressed={bioImportMode===value}
                                    onClick={() => setBioImportMode(value)}
                                    className={'h-10 rounded-xl border text-sm font-semibold transition ' + (bioImportMode===value
                                        ? 'border-slate-700 bg-slate-700 text-white shadow-sm'
                                        : 'border-slate-100 bg-slate-50 text-slate-500')}>{label}</button>
                            ))}
                        </div>
                        <button type="button" disabled={bioSaving} onClick={confirmBioImport}
                            className="w-full h-11 mt-3 rounded-xl bg-slate-700 text-white text-sm font-bold disabled:opacity-50 active:scale-[0.99] active:bg-slate-800 transition">
                            {bioSaving ? '保存中…' : '确认导入'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserApp;
