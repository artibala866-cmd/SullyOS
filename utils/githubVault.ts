import type { CloudBackupConfig } from '../types';
import {
    ghRequest, uploadAssetWithRetry, downloadAssetPart,
    listReleaseAssets, deleteReleaseAndTag,
} from './githubClient';

// Dedicated Releases, separate from full-system backup history.
const VAULT_TAG = 'sully-vault-v1-';
const META_PREFIX = 'SULLY_VAULT_V1\n';
const PART_BYTES = 32 * 1024 * 1024;
const MAX_BYTES = 512 * 1024 * 1024;
const COMPLETE_ASSET = 'vault-complete.json';
const GH = 'https://api.github.com';

export type VaultCategory = '角色卡' | '世界书' | '预设' | '美化' | '图片' | '其他';
export type VaultItem = {
    id: number;
    tag: string;
    name: string;
    category: VaultCategory;
    size: number;
    mime: string;
    createdAt: string;
    parts: { id: number; size: number }[];
    ready: boolean;
};

const headers = (token: string) => ({
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
});
const base = (c: CloudBackupConfig) => {
    const owner = c.githubOwner;
    const repo = (c.githubRepo || 'sully-backup').trim();
    if (!c.githubToken || !owner || !repo) throw new Error('请先在云端备份中连接 GitHub 私有仓库');
    if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
        throw new Error('仓库地址无效');
    }
    return GH + '/repos/' + owner + '/' + repo;
};
const responseError = async (stage: string, res: {status:number;json:()=>Promise<any>}) => {
    let reason = '';
    try { reason = String((await res.json())?.message || '').slice(0, 130); } catch {}
    return new Error(stage + '失败 (HTTP ' + res.status + ')' + (reason ? '：' + reason : ''));
};

export const ensurePrivateVault = async (c: CloudBackupConfig): Promise<void> => {
    const u = base(c);
    const res = await ghRequest(c, u, 'GET', {headers:headers(c.githubToken!)});
    if (res.status !== 200) throw await responseError('检查仓库', res);
    const repo = await res.json();
    if (repo.private !== true) {
        throw new Error('目标仓库不是私有仓库，已阻止上传私人文件');
    }
};

export const inferVaultCategory = (filename: string): VaultCategory => {
    const lower = filename.toLowerCase();
    if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(lower)) return '图片';
    if (/(worldbook|世界书)/.test(lower)) return '世界书';
    if (/(character|角色卡)/.test(lower)) return '角色卡';
    if (/(preset|预设)/.test(lower)) return '预设';
    if (/(theme|美化|appearance)/.test(lower)) return '美化';
    return '其他';
};

const readMeta = (body: unknown): null | {name:string;size:number;mime:string;category:VaultCategory;count:number;createdAt:string} => {
    if (typeof body !== 'string' || !body.startsWith(META_PREFIX)) return null;
    try {
        const m = JSON.parse(body.slice(META_PREFIX.length));
        if (typeof m.name !== 'string' || typeof m.size !== 'number'
            || !Number.isSafeInteger(m.size) || m.size <= 0
            || !Number.isSafeInteger(m.count) || m.count < 1 || m.count > 16) return null;
        return {
            name: m.name.slice(0, 240),
            size: m.size,
            mime: typeof m.mime === 'string' ? m.mime.slice(0, 100) : '',
            category: (['角色卡','世界书','预设','美化','图片','其他'].includes(m.category) ? m.category : '其他') as VaultCategory,
            count: m.count,
            createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
        };
    } catch { return null; }
};

export const listVaultFiles = async (c: CloudBackupConfig): Promise<VaultItem[]> => {
    await ensurePrivateVault(c);
    const u = base(c);
    const result: VaultItem[] = [];
    for (let page = 1; page <= 20; page++) {
        const res = await ghRequest(c, u + '/releases?per_page=100&page=' + page, 'GET', {headers:headers(c.githubToken!)});
        if (res.status !== 200) throw await responseError('读取文件列表', res);
        const releases = await res.json();
        if (!Array.isArray(releases)) throw new Error('仓库文件列表格式异常');
        for (const rel of releases) {
            if (typeof rel.tag_name !== 'string' || !rel.tag_name.startsWith(VAULT_TAG)) continue;
            const meta = readMeta(rel.body);
            if (!meta) continue;
            let assets: {id:number;name:string;size:number;state?:string}[] = Array.isArray(rel.assets) ? rel.assets : [];
            if (assets.length >= 30 || (assets.length < meta.count + 1 && !rel.draft)) {
                assets = await listReleaseAssets(c, Number(rel.id));
            }
            const parts = assets.filter(a => /^vault-part-\d+\.bin$/.test(a.name)).sort((a,b) => {
                const n = (a: typeof assets[number]) => Number(a.name.match(/\d+/)?.[0] || 0);
                return n(a) - n(b);
            });
            const hasMarker = assets.some(a => a.name === COMPLETE_ASSET && Number(a.size) > 0 && (!a.state || a.state === 'uploaded'));
            const validParts = parts.length === meta.count && parts.every((a,i) =>
                a.name === 'vault-part-' + (i + 1) + '.bin' && a.size > 0 && (!a.state || a.state === 'uploaded'));
            const total = parts.reduce((sum,a) => sum + Number(a.size || 0), 0);
            result.push({
                id: Number(rel.id), tag: rel.tag_name, name: meta.name,
                category: meta.category, size: meta.size, mime: meta.mime,
                createdAt: meta.createdAt || String(rel.created_at || ''),
                parts: parts.map(a => ({id:Number(a.id),size:Number(a.size)})),
                ready: !rel.draft && hasMarker && validParts && total === meta.size,
            });
        }
        if (releases.length < 100) break;
        if (page === 20) throw new Error('文件太多，请整理仓库后重试');
    }
    return result.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
};

export const uploadVaultFile = async (
    c: CloudBackupConfig, file: File, category: VaultCategory,
    onProgress?: (percent:number) => void,
): Promise<void> => {
    if (!file.size || file.size > MAX_BYTES) throw new Error('单个文件需在 0–512 MB 之间');
    await ensurePrivateVault(c);
    const u = base(c);
    const count = Math.ceil(file.size / PART_BYTES);
    const createdAt = new Date().toISOString();
    const tag = VAULT_TAG + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    const metadata = {name:file.name, size:file.size, mime:file.type, category, count, createdAt};
    let id = 0;
    try {
        const created = await ghRequest(c, u + '/releases', 'POST', {
            headers: headers(c.githubToken!),
            body: JSON.stringify({
                tag_name:tag, name:'资源 · ' + file.name,
                body:META_PREFIX + JSON.stringify(metadata),
                draft:true, prerelease:true,
            }),
        });
        if (created.status !== 201) throw await responseError('创建文件', created);
        id = Number((await created.json())?.id);
        if (!id) throw new Error('GitHub 未返回文件标识');
        for (let i=0; i<count; i++) {
            const slice = file.slice(i * PART_BYTES, Math.min(file.size, (i+1) * PART_BYTES));
            const r = await uploadAssetWithRetry(c, id, slice, 'vault-part-' + (i+1) + '.bin',
                f => onProgress?.(Math.min(95, Math.round(((i+f)/count)*95))), 'application/octet-stream');
            if (!r.ok || !r.asset || r.asset.size !== slice.size) throw new Error(r.message || '文件分片上传失败');
        }
        const marker = new Blob([JSON.stringify(metadata)], {type:'application/json'});
        const done = await uploadAssetWithRetry(c, id, marker, COMPLETE_ASSET, undefined, 'application/json');
        if (!done.ok || !done.asset) throw new Error('写入完成标记失败');
        const published = await ghRequest(c, u + '/releases/' + id, 'PATCH', {
            headers:headers(c.githubToken!),
            body:JSON.stringify({draft:false, prerelease:true}),
        });
        if (published.status !== 200) throw await responseError('完成上传', published);
        onProgress?.(100);
    } catch (error) {
        if (id) await deleteReleaseAndTag(c, id, tag);
        throw error;
    }
};

export const downloadVaultFile = async (
    c: CloudBackupConfig, file: VaultItem, onProgress?: (percent:number)=>void,
): Promise<File> => {
    if (!file.ready || !file.parts.length) throw new Error('文件还没有上传完成');
    await ensurePrivateVault(c);
    const buffers: ArrayBuffer[] = [];
    let size = 0;
    for (let i=0;i<file.parts.length;i++) {
        const part=file.parts[i];
        const buffer=await downloadAssetPart(c,part.id,part.size);
        size += buffer.byteLength;
        buffers.push(buffer);
        onProgress?.(Math.round(((i+1)/file.parts.length)*100));
    }
    if (size !== file.size) throw new Error('下载内容大小不符，已阻止使用');
    return new File(buffers, file.name, {type:file.mime || 'application/octet-stream'});
};

export const deleteVaultFile = async (c: CloudBackupConfig, file: VaultItem): Promise<void> => {
    await ensurePrivateVault(c);
    if (!file.tag.startsWith(VAULT_TAG) || !Number.isSafeInteger(file.id) || file.id <= 0) {
        throw new Error('文件标识无效');
    }
    const u=base(c);
    const res=await ghRequest(c,u+'/releases/'+file.id,'GET',{headers:headers(c.githubToken!)});
    if (res.status !== 200) throw await responseError('核实文件',res);
    if ((await res.json()).tag_name !== file.tag) throw new Error('远端文件已变更，请刷新列表');
    if (!await deleteReleaseAndTag(c,file.id,file.tag)) throw new Error('删除未完成，请重试');
};
