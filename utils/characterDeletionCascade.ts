import type { GroupProfile, NovelBook, SocialPost, WorldProfile } from '../types';

/** Shared records are filtered by stable character IDs, never by display name. */
export function removeCharacterFromGroup(group: GroupProfile, charId: string): GroupProfile | null {
    if (!group.members.includes(charId)) return group;
    const members = group.members.filter(id => id !== charId);
    if (!members.length) return null;
    // The shared topic summaries can contain the removed member's full dialogue.
    return { ...group, members, topicBoxes: [], archivedThroughMessageId: undefined };
}

export function removeCharacterFromSocialPost(post: SocialPost, charId: string): SocialPost | null {
    if (post.authorCharId === charId || post.authorId === charId) return null;
    const comments = (post.comments || []).filter(item =>
        item.authorCharId !== charId && item.authorId !== charId
    ).map(item => ({
        ...item,
        likedByAccountIds: item.likedByAccountIds?.filter(id => id !== charId && id !== 'owner:' + charId),
    }));
    return {
        ...post, comments,
        likedByAccountIds: post.likedByAccountIds?.filter(id => id !== charId && id !== 'owner:' + charId),
        collectedByAccountIds: post.collectedByAccountIds?.filter(id => id !== charId && id !== 'owner:' + charId),
    };
}

export function removeCharacterFromWorld(world: WorldProfile, charId: string): WorldProfile {
    if (!world.memberIds.includes(charId) &&
        !(world.seeds || []).some(seed => seed.charId === charId) &&
        !(world.directives || []).some(item => item.charId === charId)) return world;
    return {
        ...world,
        memberIds: world.memberIds.filter(id => id !== charId),
        houses: world.houses.map(house => ({
            ...house, residentIds: house.residentIds.filter(id => id !== charId),
        })),
        relationships: world.relationships.filter(item => item.fromId !== charId && item.toId !== charId),
        threads: world.threads?.filter(thread =>
            !(thread.kind === 'dm' && thread.memberIds.includes(charId))
        ).map(thread => ({
            ...thread,
            memberIds: thread.memberIds.filter(id => id !== charId),
            messages: thread.messages.filter(message => message.fromId !== charId),
        })),
        seeds: world.seeds?.filter(item => item.charId !== charId),
        directives: world.directives?.filter(item => item.charId !== charId),
        chapters: world.chapters?.filter(chapter =>
            !chapter.perspectives.some(item => item.charId === charId) &&
            !chapter.lastDayBeats.some(item => item.charId === charId)
        ),
        feedReactions: world.feedReactions
            ? Object.fromEntries(Object.entries(world.feedReactions).filter(([key]) =>
                !key.includes('_' + charId + '_')
            )) : undefined,
    };
}

export function removeCharacterFromNovel(novel: NovelBook, charId: string): NovelBook {
    return {
        ...novel,
        collaboratorIds: novel.collaboratorIds.filter(id => id !== charId),
        segments: novel.segments.filter(segment => segment.authorId !== charId),
    };
}

/** Local-only role state, including phone history, life events, mood, avatar and async markers. */
export function clearCharacterScopedStorage(charId: string): void {
    if (!charId) return;
    for (const storage of [
        typeof localStorage === 'undefined' ? null : localStorage,
        typeof sessionStorage === 'undefined' ? null : sessionStorage,
    ]) {
        if (!storage) continue;
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index);
            if (key && key.includes(charId)) keys.push(key);
        }
        for (const key of keys) storage.removeItem(key);
        if (storage.getItem('os_last_active_char_id') === charId) {
            storage.removeItem('os_last_active_char_id');
        }
    }
}
