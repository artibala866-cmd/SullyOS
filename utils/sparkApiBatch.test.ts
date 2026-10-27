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
        expect(selectSparkBatchCharacterResults(['c1','c2'],output).map(x=>x.content)).toEqual(['有效1','有效2']);
        expect(selectSparkBatchCharacterResults(['c1'],{oops:'not array'})).toEqual([]);
    });
    it('reads both public comments and optional incoming inbox messages from one JSON result', () => {
        const comments=[{author:'网友', content:'赞'}];
        const inbox=[{name:'网友B', message:'有空聊吗'}];
        expect(parseSparkPostPublishBatch({comments,incomingDMs:inbox})).toEqual({comments,incomingDMs:inbox});
        expect(parseSparkPostPublishBatch(comments)).toEqual({comments,incomingDMs:[]});
        expect(parseSparkPostPublishBatch({comments:'not-array',incomingDMs:'wrong'})).toEqual({comments:[],incomingDMs:[]});
    });
});
