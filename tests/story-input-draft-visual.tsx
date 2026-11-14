import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import StoryVectorMemoryPanel from '../components/date/story/StoryVectorMemoryPanel';
import { createStoryTheaterDraft, BUILTIN_NIGHT_SCREENING_PRESET } from '../utils/storyTheater';
import { DB } from '../utils/db';

// Actual story composer and actual vector memory page; local-only fake story data.
const actor = { id: 'draft-test-actor', name: '林星', avatar: '', systemPrompt: '', worldview: '', memories: [], mountedWorldbooks: [] };
const entries = ['draft-visual-a', 'draft-visual-b'].map((id, index) => ({
    ...createStoryTheaterDraft(index + 1), id, title: index === 0 ? '雨夜剧情' : '另一段剧情',
    characterIds: [actor.id], carryCharacterMemory: false,
}));
DB.getRecentMessagesWithCount = async () => ({ messages: [], totalCount: 0 });
DB.getMessagesByCharId = async () => [];
const os = {
    characters: [actor], worldbooks: [], userProfile: { name: '玩家', avatar: '' },
    apiConfig: { baseUrl: '', apiKey: '', model: '' },
    memoryPalaceConfig: {}, remoteVectorConfig: {},
    theme: { storyAppearance: { preset: 'none' } },
    updateCharacter: () => {}, addToast: () => {}, registerBackHandler: () => () => {},
} as any;

function Demo() {
    const [story, setStory] = useState(0);
    const [view, setView] = useState<'story' | 'list' | 'memory'>('story');
    const entry = entries[story];
    return <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
        {view === 'story' && <StoryTheaterSession key={entry.id} entry={entry}
            preset={BUILTIN_NIGHT_SCREENING_PRESET} masks={[]}
            onBack={() => setView('list')} onEdit={() => setView('list')}
            onOpenVectorMemory={() => setView('memory')}
            onEntryChange={() => {}} onArchiveCommitted={() => {}} />}
        {view === 'memory' && <StoryVectorMemoryPanel key={entry.id} entry={entry}
            onBack={() => setView('story')} onUpdated={() => {}} />}
        {view === 'list' && <div className='h-full bg-stone-100 p-5'>
            <h1 className='text-lg font-semibold mb-5'>剧情列表</h1>
            {entries.map((e, index) => <button key={e.id} type='button'
                aria-label={`进入剧情 ${e.title}`}
                onClick={() => { setStory(index); setView('story'); }}
                className='block w-full mb-3 text-left rounded-xl bg-white border border-slate-200 p-4'>{e.title}</button>)}
        </div>}
    </StoryTheaterThemeProvider></OSPreviewProvider>;
}
createRoot(document.getElementById('visual')!).render(<Demo />);
