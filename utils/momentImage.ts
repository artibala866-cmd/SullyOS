import type {UserProfile} from '../types';
import {deliverAutomaticImage, parseImageDirective} from './automaticImage';
import {attachGeneratedMomentImage, type CharacterMoment} from './characterPhoneMoments';

export function attachMomentPhoto(
    post: CharacterMoment | null, photo: ReturnType<typeof parseImageDirective>, permission: string | null,
    senderName: string, user?: UserProfile, signal?: AbortSignal,
): Promise<boolean> {
    if (!post) return Promise.resolve(false);
    return deliverAutomaticImage({
        scope:'moments', id:post.characterId, permission, photo, sender:{id:post.authorId,name:senderName}, user, signal,
        commit:(token, description) => attachGeneratedMomentImage(post.characterId, post.id, token, description),
    });
}
