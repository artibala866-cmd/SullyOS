import { describe, expect, it } from 'vitest';
import { planSparkCharacterBatches, selectSparkBatchCharacterResults, parseSparkPostPublishBatch } from './sparkApiBatch';

describe('Spark API call reduction without unsafe identity mixing', () => {
    it('plans one provider request for up to eight selected characters, not eight separate requests', () => {
        const chars = Array.from({length:8}, (_,i)=>({id:'c'+i}));
        expect(planSparkCharacterBatches(chars)).toHaveLength(1);
        expect(planSparkCharacterBatches([...chars, {id:'c8'}]).map(x=>x.length)).toEqual([8,1]);
        expect(planSparkCharacterBatches([])).toEqual([]);
    });
    it('rejects hallucinated, duplicate and unselected character results without rerunning the API', () => {
        const output = [
            {charId:'c1', content:'有效1'},
            {charId:'c1', content:'重复'},
            {charId:'c2', content:'有效2'},
            {charId:'unknown', content:'冒名'},
            {charId:null, content:'缺身份'},
        ];
        expect(selectSparkBatchCharacterResults<{charId:string; content:string}>(['c1','c2'],output).map(x=>x.content)).toEqual(['有效1','有效2']);
        expect(selectSparkBatchCharacterResults(['c1'],{oops:'not array'})).toEqual([]);
    });
    it('does not let a malformed character row shadow a later valid post in the same paid batch', () => {
        const output = [
            { charId: 'c1', content: '' },
            { charId: 'c1', content: '有效正文' },
            { charId: 'c2', content: undefined },
            { charId: 'c2', content: '另一位的有效正文' },
        ];
        expect(selectSparkBatchCharacterResults<{charId:string;content:string}>(['c1','c2'],output)
            .map(x => x.content)).toEqual(['有效正文','另一位的有效正文']);
    });
    it('reads both public comments and optional incoming inbox messages from one JSON result', () => {
        const comments=[{author:'网友', content:'赞'}];
        const inbox=[{name:'网友B', message:'有空聊吗'}];
        expect(parseSparkPostPublishBatch({comments,incomingDMs:inbox})).toEqual({comments,incomingDMs:inbox});
        expect(parseSparkPostPublishBatch(comments)).toEqual({comments,incomingDMs:[]});
        expect(parseSparkPostPublishBatch({comments:'not-array',incomingDMs:'wrong'})).toEqual({comments:[],incomingDMs:[]});
    });
});

describe('Spark avoiding hidden repeat AI costs when opening posts', () => {
    it('never rebills a generated post just because its batch returned no comments', async () => {
        const { needsSparkInitialCommentCall } = await import('./sparkApiBatch');
        expect(needsSparkInitialCommentCall({ sparkInitialCommentsHandled: true, comments: [] })).toBe(false);
        expect(needsSparkInitialCommentCall({ sparkInitialCommentsHandled: true, comments: [{ authorType: 'user', authorId: 'user' }] })).toBe(false);
        expect(needsSparkInitialCommentCall({ comments: [] })).toBe(true);
    });
    it('does not regenerate initial comments for a post with existing NPC comments', async () => {
        const { needsSparkInitialCommentCall } = await import('./sparkApiBatch');
        expect(needsSparkInitialCommentCall({ comments: [{ authorType: 'stranger', authorId: 'npc-1' }] })).toBe(false);
        expect(needsSparkInitialCommentCall({ comments: [{ authorType: 'user', authorId: 'user' }] })).toBe(true);
    });
});
