// 孤儿 Blob GC 入口。删除令牌（blobref:）是保守的——同一令牌可能被多处引用，消费方
// 从不主动删，残留的孤儿 Blob 统一由这里的 GC 收口（首版只挂调试面板手动触发）。
// GC 逻辑在 @rei-standard/blob-store（mark & sweep + 多道安全阀，宁可留孤儿绝不删活图），
// 本文件只负责宿主义务里最要命的那条：把「全部可能含令牌的持久化面」枚举给它。
//
// GC 扫描当前身份主库的全部对象表（图片二进制表除外），以及本机存储引用。
// 去重仍使用经过写入审计的白名单，避免改写未知格式。
import { DB, openDB } from './db';
import { blobStore } from './blobStore';
import { nativeLocalStorage } from './userSaveScope';
import { tryAcquireMaintenanceLock, releaseMaintenanceLock, currentMaintenanceHolder } from './maintenanceLock';

// 引用面里的 17 张表。名字与 db.ts 的 STORE_* 常量值一一对应
// （STORE_CHARACTERS / STORE_MESSAGES / STORE_CC_PARTS / STORE_SONGS / STORE_GALLERY /
//   STORE_ASSETS / STORE_THEMES / STORE_EMOJIS / STORE_USER / STORE_SOCIAL_POSTS /
//   STORE_GROUPS / STORE_CHAR_GROUPS / STORE_STORY_THEATER_MASKS / STORE_BANK_DATA /
//   STORE_GUIDEBOOK / STORE_LIFE_SIM / pixel_home_assets）。
// 全部是 inline keyPath（都用 'id'），所以 blobDedupe 的 putStoreRows 能原样写回。
// 导出仅供测试核对拼写：名字写错时 getStoreRowsPage 的 contains 兜底会静默返回空页，
// 等于那个面没扫、无任何报错——blobGc.test.ts 有一条守卫断言每个名字真实存在。
export const REF_SOURCE_STORES = [
    'daily_schedule',
    'characters',
    'messages',
    'cc_custom_parts',
    'songs',
    'gallery',
    'assets',
    'themes',
    'emojis',
    'user_profile',
    'social_posts',
    'groups',
    'character_groups',
    'story_theater_masks',
    'bank_data',
    'guidebook',
    'life_sim',
    'pixel_home_assets',
] as const;

// 每批读多少行。批间事务各自独立（见 DB.getStoreRowsPage 注释），内存峰值只有一批。
const PAGE_SIZE = 200;

/**
 * 逐条 yield 明文字符串的引用面枚举器（喂给 SDK 的 store.gc）。
 * 枚举中任何一步出错都直接上抛——SDK 的安全阀会整轮放弃（aborted: true，一个不删），
 * 绝不能在这里吞错静默跳过，那等于把出错的面当「没有引用」。
 */
export async function* iterateBlobRefSources(): AsyncGenerator<string> {
    // 表面：按主键分页逐行吐 JSON。
    const db = await openDB();
    for (const storeName of Array.from(db.objectStoreNames)) {
        if (storeName === 'blob_assets') continue;
        let afterKey: IDBValidKey | null = null;
        for (;;) {
            const { rows, lastKey } = await DB.getStoreRowsPage(storeName, afterKey, PAGE_SIZE);
            for (const row of rows) {
                const text = JSON.stringify(row);
                // JSON.stringify(undefined) 是 undefined（不是字符串），跳过这类空洞行
                if (typeof text === 'string') yield text;
            }
            if (lastKey === null || rows.length < PAGE_SIZE) break;
            afterKey = lastKey;
        }
    }

    // localStorage 面：先同步快照成数组再逐条 yield —— async generator 每次 yield 都会
    // 挂起，挂起期间并发的 removeItem 会让下标移位、漏扫一个 key。
    const localValues: string[] = [];
    for (const storage of [nativeLocalStorage ?? localStorage, globalThis.sessionStorage]) {
        if (!storage) continue;
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key === null) continue;
            localValues.push(key, storage.getItem(key) ?? '');
        }
    }
    yield* localValues;
}

/**
 * 跑一轮孤儿 Blob GC，返回 SDK 的 { deleted, kept, keptBoundary, aborted }。
 * minAgeMs 默认 72h（SDK 侧新鲜豁免，挡「已 put、引用未落盘」的竞态），0 只应出现在测试。
 * keptBoundary 接近库存量 = 某个引用面混进了杂散的令牌前缀文本，GC 整轮空转——
 * 展示侧（调试面板）必须把它露出来，deleted:0 和「真没垃圾」同形，它是唯一报警信号。
 *
 * 与「优化资源存储」共用 maintenanceLock：迁移是引用搬家（data: → 令牌），
 * mark 不是一致性快照，撞上会误删活图。锁被占时直接抛（拿不到锁 ≠ 没垃圾）。
 */
export async function runBlobGc(opts?: { minAgeMs?: number }) {
    if (!tryAcquireMaintenanceLock('孤儿图片清理')) {
        throw new Error(`另一项存储维护（${currentMaintenanceHolder()}）正在进行，请稍后再试。`);
    }
    try {
        return await blobStore.gc({ refSources: iterateBlobRefSources(), ...opts });
    } finally {
        releaseMaintenanceLock();
    }
}
