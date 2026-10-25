import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { ContextBuilder } from './context';
import { XhsFreeRoamEngine } from './xhsFreeRoam';
import { XhsMcpClient } from './xhsMcpClient';

describe('XHS stock usage when publishing', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    for (const published of [false, true]) {
        it(`only counts the selected image after a ${published ? 'successful' : 'failed'} publish`, async () => {
            vi.spyOn(DB, 'getXhsActivities').mockResolvedValue([]);
            vi.spyOn(DB, 'getXhsStockImages').mockResolvedValue([{
                id: 'stock-1', url: 'https://example.com/photo.jpg',
                tags: ['咖啡'], addedAt: 1, usedCount: 0,
            }]);
            const updateUsage = vi.spyOn(DB, 'updateXhsStockImageUsage').mockResolvedValue(undefined);
            vi.spyOn(DB, 'saveXhsActivity').mockResolvedValue(undefined);
            vi.spyOn(DB, 'saveXhsOwnedPost').mockResolvedValue(undefined);
            vi.spyOn(DB, 'saveMessage').mockResolvedValue(undefined);

            vi.spyOn(XhsMcpClient, 'ensureInitialized').mockResolvedValue(undefined);
            const publish = vi.spyOn(XhsMcpClient, 'publishNote').mockResolvedValue(
                published
                    ? { success: true, data: { note_id: 'note-1' } }
                    : { success: false, error: 'Publish failed' },
            );
            vi.spyOn(ContextBuilder, 'buildCharacterRequest').mockResolvedValue([
                { role: 'user', content: '开始自由活动' },
            ]);
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                action: 'post', title: '早餐', content: '咖啡',
                                tags: ['咖啡'], thinking: '想分享早餐',
                            }),
                        },
                    }],
                }),
            }));

            const callbacks = {
                onStatus: vi.fn(),
                onThinking: vi.fn(),
                onActivity: vi.fn(),
                onComplete: vi.fn(),
                onError: vi.fn(),
            };
            await XhsFreeRoamEngine.run(
                { id: 'char-1', name: '角色' } as any,
                { name: '用户' } as any,
                { baseUrl: 'https://llm.example.com', apiKey: 'test', model: 'test' } as any,
                { xhsMcpConfig: { serverUrl: 'https://mcp.example.com' } } as any,
                callbacks,
            );

            expect(publish).toHaveBeenCalledWith(
                'https://mcp.example.com',
                expect.objectContaining({ images: ['https://example.com/photo.jpg'] }),
            );
            expect(updateUsage).toHaveBeenCalledTimes(published ? 1 : 0);
            expect(callbacks.onError).not.toHaveBeenCalled();
            expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
        });
    }
});
