import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CloudBackupConfig } from '../../types';
import Modal from '../os/Modal';
import { shareOrDownloadBlob } from '../../utils/shareExport';
import {
    deleteVaultFile, downloadVaultFile, inferVaultCategory,
    listVaultFiles, uploadVaultFile,
    type VaultCategory, type VaultItem,
} from '../../utils/githubVault';

const CATEGORIES: (VaultCategory | '全部')[] = ['全部','角色卡','世界书','预设','美化','图片','其他'];

const readableSize = (bytes:number) => bytes >= 1024*1024
    ? (bytes/(1024*1024)).toFixed(1) + ' MB'
    : Math.max(1,Math.ceil(bytes/1024)) + ' KB';

export default function GithubVaultModal({
    isOpen, onClose, config, onConnect, addToast,
}: {
    isOpen:boolean;
    onClose:()=>void;
    config:CloudBackupConfig;
    onConnect:()=>void;
    addToast:(message:string,type:'success'|'error'|'info')=>void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [items,setItems] = useState<VaultItem[]>([]);
    const [loading,setLoading] = useState(false);
    const [busy,setBusy] = useState(false);
    const [progress,setProgress] = useState(0);
    const [operation,setOperation] = useState('');
    const [error,setError] = useState('');
    const [search,setSearch] = useState('');
    const [selectedCategory,setSelectedCategory] = useState<VaultCategory | '全部'>('全部');
    const [uploadCategory,setUploadCategory] = useState<VaultCategory | '自动'>('自动');
    const connected = Boolean(config.githubToken && config.githubOwner);

    const refresh = async () => {
        if (!connected) return;
        setLoading(true);
        setError('');
        try { setItems(await listVaultFiles(config)); }
        catch (err:any) { setError(err?.message || '获取资源失败'); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (isOpen) void refresh();
    }, [isOpen,config.githubToken,config.githubOwner,config.githubRepo,config.githubUseProxy,config.githubProxyConsentVersion]);

    const visible = useMemo(() => items.filter(item =>
        (selectedCategory === '全部' || item.category === selectedCategory)
        && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    ), [items,search,selectedCategory]);

    const upload = async (event:React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length || busy) return;
        setBusy(true);
        setProgress(0);
        setError('');
        let done=0;
        try {
            for (const file of files) {
                setOperation('上传 ' + file.name);
                await uploadVaultFile(config,file,uploadCategory === '自动' ? inferVaultCategory(file.name) : uploadCategory,
                    percent => setProgress(Math.round(((done + percent/100) / files.length)*100)));
                done++;
            }
            addToast('已上传 ' + done + ' 个文件','success');
        } catch (err:any) {
            const message=err?.message || '上传失败';
            setError(message);
            addToast('已上传 ' + done + ' 个；' + message,'error');
        } finally {
            setBusy(false);
            setOperation('');
            setProgress(0);
            await refresh();
        }
    };

    const download = async (item:VaultItem) => {
        setBusy(true);
        setOperation('下载 ' + item.name);
        setProgress(0);
        setError('');
        try {
            const file=await downloadVaultFile(config,item,setProgress);
            const result=await shareOrDownloadBlob({
                blob:file, fileName:item.name, nativeChunked:true, preferDownloadOnWeb:true,
            });
            if (result !== 'cancelled') addToast('文件已准备好，可在相应功能中导入','success');
        } catch (err:any) {
            setError(err?.message || '下载失败');
        } finally {
            setBusy(false);
            setOperation('');
            setProgress(0);
        }
    };

    const remove = async (item:VaultItem) => {
        if (!window.confirm('永久删除云端文件「' + item.name + '」？')) return;
        setBusy(true);
        setOperation('删除 ' + item.name);
        setError('');
        try {
            await deleteVaultFile(config,item);
            setItems(prev=>prev.filter(file=>file.id !== item.id));
            addToast('已删除云端文件','success');
        } catch (err:any) {setError(err?.message || '删除失败');}
        finally {setBusy(false);setOperation('');}
    };

    return (
        <Modal isOpen={isOpen} title="我的仓库" onClose={() => { if (!busy) onClose(); }}>
            <div className="space-y-3 px-1 pb-2">
                {!connected ? (
                    <div className="space-y-3 py-5 text-center">
                        <p className="text-xs text-slate-500">请先连接 GitHub 私有仓库</p>
                        <button type="button" onClick={() => {onClose();onConnect();}}
                            className="rounded-xl bg-slate-800 text-white px-5 py-2.5 text-xs font-semibold">
                            连接 GitHub
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            <input ref={inputRef} type="file" multiple className="hidden" onChange={upload}
                                aria-label="上传文件到私人仓库" />
                            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || loading}
                                className="flex-1 rounded-xl bg-slate-800 text-white px-3 py-2.5 text-xs font-semibold disabled:opacity-40">
                                上传文件
                            </button>
                            <button type="button" onClick={() => void refresh()} disabled={busy || loading}
                                className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-600 disabled:opacity-40">
                                刷新
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
                                placeholder="搜索文件" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none" />
                            <select aria-label="上传文件分类" value={uploadCategory}
                                onChange={e=>setUploadCategory(e.target.value as VaultCategory | '自动')}
                                className="max-w-[104px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600">
                                <option value="自动">自动分类</option>
                                {CATEGORIES.filter(v=>v!=='全部').map(c=><option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {CATEGORIES.map(c=><button key={c} type="button" onClick={()=>setSelectedCategory(c)}
                                className={'rounded-full px-2.5 py-1 text-[11px] '+
                                    (selectedCategory===c ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500')}>
                                {c}
                            </button>)}
                        </div>
                        {(busy || loading) && (
                            <div className="space-y-1">
                                <p className="truncate text-[11px] text-slate-500">{loading ? '正在读取文件…' : operation}</p>
                                {busy && <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full bg-slate-700 transition-all" style={{width:progress+'%'}} />
                                </div>}
                            </div>
                        )}
                        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 break-words">{error}</p>}
                        {!loading && visible.length===0 && !error && (
                            <p className="py-7 text-center text-xs text-slate-400">{search || selectedCategory!=='全部' ? '没有匹配的文件' : '仓库还是空的'}</p>
                        )}
                        <div className="max-h-[47vh] overflow-y-auto space-y-2">
                            {visible.map(item=>(
                                <div key={item.id} className="rounded-xl border border-slate-100 bg-white/80 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="break-all text-xs font-semibold text-slate-700">{item.name}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">
                                                {item.category} · {readableSize(item.size)} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                                            </p>
                                            {!item.ready && <p className="text-[10px] text-red-500 mt-1">上传未完成</p>}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <button type="button" onClick={()=>void download(item)} disabled={busy || !item.ready}
                                                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-700 disabled:opacity-30">
                                                下载
                                            </button>
                                            <button type="button" onClick={()=>void remove(item)} disabled={busy}
                                                className="rounded-lg px-1 py-1.5 text-[11px] text-slate-400 disabled:opacity-30">
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
