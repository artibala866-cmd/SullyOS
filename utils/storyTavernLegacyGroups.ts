import type { StoryTheaterPresetDocument, StoryTheaterPreset } from '../types';

// Original author category boundaries for four provided samples. Metadata only:
// never copy or execute an author's prompt text or modify their switches.
const layouts: ReadonlyArray<{ anchors: readonly string[]; runs: string }> = [
  {
    "anchors": [
      "c27b8b4f-e5f2-4f9e-a438-612e9be1413a",
      "a3931ba4-6c5a-4734-aef0-127be0ee5b2b",
      "395165ae-6c67-4747-b4d4-f31e970e8e14"
    ],
    "runs": "3bf9dd49-2614-427d-8dcf-6055a143b4a8|\nc27b8b4f-e5f2-4f9e-a438-612e9be1413a|预设头部\n2c4b15a3-15b6-4fb5-bcb6-3936fc3991df|小说类型\n3c0fc6ee-269b-471a-8995-15ae04da4ecc|剧情规范\ned8785fc-c9e1-41bd-b6d7-1e036543f446|情感扫描\n46254432-bd26-4ab8-9e50-88b47e21ef71|基础需求\n52ff7989-1def-4234-bf94-d047cb80c08c|优化分区\nde8b2baa-8874-4237-a82d-652faa01521a|\nde11f610-434d-4e19-9e62-edb988d5299e|优化分区\n97bf14a4-7733-4388-8ff6-f5a2436c2a68|\nc2a7a282-5c96-4ab9-ae87-5c589710247f|优化分区\n019bb315-f3c3-4da3-80fa-2bdb4d078ceb|\na35713a3-e8c5-44bc-a414-ecc3d46a41bb|优化分区\n5532b1dc-2b87-4991-85ae-2459a262e44e|NSFW优化\ne978395d-24f5-4879-a6a3-fce372f1e38c|\ndcfecd37-92f9-4f49-b029-8c45e29bef47|NSFW优化\n2f3afc3b-e454-4dc1-bb61-1ee72f99b9b8|功能分区\n4eabce2b-fb58-4aba-b40a-1e51e8541966|小说基调\n5a10e276-9de4-48ac-a70e-bceabf9bd446|\n93010687-d0af-4a7f-bafa-3b690fcd216b|小说基调\n08697c3b-60cd-4f6b-b9f4-fa1d39550053|小说文风\nddf96876-9580-4b9b-8339-0b57cff042a5|\nb83f5132-3931-475e-a6d2-212e08eb36a4|小说文风\n5066b6f8-256e-4834-a2a1-489b68c86ff8|\na5f517cd-a331-46d0-8b52-37ebd830a2eb|思维链区\nd0fd5d5d-5187-4a90-b821-e4ab3767b149|\naf2e3315-ea8f-4d75-ad86-603e75de76e8|思维链区\n08364abf-1a8d-45e2-b95a-5be165ad0c14|预设底部\nmerge-23|"
  },
  {
    "anchors": [
      "c9dacfb9-b212-44f7-baab-4f3db5825094",
      "c95caf99-d2a5-4f93-bf96-55b8b782d51d",
      "c43b64e6-e3a0-4e67-a545-19aaab643700"
    ],
    "runs": "main|顶部\n9127d7ed-d487-46c8-b625-f1e9a4926c2e|塑造\n953c9c21-04e2-4a25-a75d-93972dd2da2f|背景\nenhanceDefinitions|文风\n3fe6a008-6461-4c7d-a0f2-22485de32f10|写作规范\n2eb0c2a5-2268-487e-8334-5fc682a19618|文本规格\n8749e431-0ff1-4a6a-8cf6-22007893f3b8|NSFW\n2737906a-b24f-4490-be43-29a9ba74f099|选一：思维链（自组）\n6f73e0d4-393f-4559-a220-410441b00213|选一：思维链（预制）\n4a78eafe-e8be-4d37-a399-cb4143b4ccb3|模块\nd765cb08-9a66-4140-a50e-072ca02b79f6|剧场\n3e9839d3-4d8c-411a-bed6-720f108d9b7e|底部\n71434afb-9b07-45ce-a8f7-752db48eebb9|"
  },
  {
    "anchors": [
      "prompt_1791471595632_3ijv6wn",
      "7c43bc4c-3d9a-47f5-ba25-2bd16742d795",
      "3d1ac24f-c1a8-4ab6-a286-26e4e6f62941"
    ],
    "runs": "4fb2a3dc-909c-4bfc-a8b0-12368840eacf|预设配置\n3952ca64-d898-4378-b569-ba10fb975401|随机头部\ndcbcf042-518b-41b8-a8dd-ad4f845beb28|顶部\n6d981057-76a3-4d3c-8cad-122a31196504|最高原则（G3开）\n29eb3f4f-8548-44b8-84f5-a5009f80c79b|最高原则（4a开）\n184e7a44-8861-451a-9766-0b75aa956011|Char&U設定\nprompt_1791471949645_qxqvwlk|转述抢话设置\nec32e538-f9c7-4587-b1c6-41f9fb4f5d6d|人称设置\nf8c7ab59-1390-4250-80c5-ea6e2167a73e|对白语言设置\n63dbd389-ce22-4a60-a0c5-684783fad9fb|字数要求\n6f3a47ee-9b56-45d0-bb53-3f010845d691|故事基调（强化虐向）\n7edc852c-e879-4275-b4d2-8f8e59b5d805|写作指导和文风\nprompt_1791471823999_h7aqnop|故事优化\nprompt_1791617922011_rvp1hqe|小剧场\n0f8c16dd-728e-4c41-8a8a-f170deecd05f|部件（万事成真）\n6fda5206-9b03-4d22-bb64-81fdb02aa2f9|部件（MoM系）\nprompt_1791617922012_z5icgqg|🚫别动别关🚫\na2b70ba6-ad9b-4b1c-9f0a-b71c638e5211|G4 CoT\na7c884e1-f338-453f-8f1e-897d13793f1d|G3 CoT\n65666e2d-9752-48dc-87da-1a4bebcb0cde|NSFW CoT\na6f952e0-7f7e-4d72-ad51-5ee9f0ffc2d5|大总结/人格召唤CoT\nprompt_1791471853005_fyfl2cf|尾部\n784bc3a8-baa7-4eee-9d4b-d6dd77a489e0|"
  },
  {
    "anchors": [
      "670054f8-a499-4d83-9708-15a43ccf21fc",
      "c9ebf674-6cf6-4017-af28-c58a711cabae",
      "71d22d22-c49a-4165-9e8b-c4e2ef4279ba"
    ],
    "runs": "3bbf9f12-88d4-4d7b-a7e8-5cefa6fad09c|顶部\ne257cb2f-f51d-4f87-9e3e-268db145e3f5|抢话/复述\nfca26432-aa18-4c79-be85-5d9504afe1c1|字数/人称\n6cba3463-16e8-4501-b5a9-d0e47493fabd|文风设定\ndfc9b990-7ae2-4097-bc12-25131f71b472|写作指导\n5d8d6b62-54b3-422b-b284-372ef824e80c|角色塑造\nec72d1f4-89e9-4cc3-bd4f-b553ff41562f|背景设定\n32c4e99d-4b20-41f7-b7e7-ac8a2a104e27|人物心理\n2311158a-b67e-4975-9779-5baeb32c3b88|NSFW\ndb53957e-8b6e-4817-8e28-e01fb8c689af|思维链\n15f9e0df-f6d9-4b2c-829a-fbd118a016ca|状态栏/正文\ncba02a9b-1368-4aa6-b63f-cf794640058d|额外模块\ndc8824ff-0a51-4524-84f6-e21845ebb233|小剧场\n9d6ad354-42a3-461e-98a3-943453272da7|总结/规范\nb234d92a-91d0-45d5-98bb-8b95db80456a|底部\n05de9c52-ef77-4930-b6bc-1ac75d8488d9|"
  }
];

export const restoreStoryTavernLegacyGroups = (document: StoryTheaterPresetDocument): StoryTheaterPresetDocument => {
    if (!document || !Array.isArray(document.prompts)) return document;
    const indexes = new Map(document.prompts.map((prompt, index) => [prompt.id, index]));
    const likelyTavern = document.sourceFormat === 'sillytavern'
        || (document.prompts.length > 15 && document.prompts.filter(prompt => prompt.id.startsWith('st-')).length > document.prompts.length * 0.8);
    if (!likelyTavern) return document;
    for (const [layoutIndex, layout] of layouts.entries()) {
        if (layout.anchors.filter(identifier => indexes.has('st-' + identifier)).length < 2) continue;
        const runs = layout.runs.trim().split('\n').map(line => {
            const separator = line.indexOf('|');
            return { label: line.slice(separator + 1), index: indexes.get('st-' + line.slice(0, separator)) };
        });
        const available = runs.filter(run => run.index !== undefined);
        if (available.length < Math.ceil(runs.length * 0.75)
            || available.some((run, index) => index > 0 && run.index! <= available[index - 1].index!)) continue;
        const tavernEntryGroups: NonNullable<StoryTheaterPresetDocument['tavernEntryGroups']> = [];
        for (let index = 0; index < available.length; index += 1) {
            const current = available[index];
            if (!current.label) continue; // Keep unassigned source entries unassigned.
            const first = current.index!;
            const last = (available[index + 1]?.index ?? document.prompts.length) - 1;
            if (last < first) continue;
            tavernEntryGroups.push({
                id: 'legacy-' + layoutIndex + '-' + index,
                name: current.label,
                startIdentifier: document.prompts[first].id.slice(3),
                endIdentifier: document.prompts[last].id.slice(3),
            });
        }
        if (tavernEntryGroups.length) {
            // Older importers stored only extensions.entryGrouping. That index
            // can cover two subsections while baibaiToolkit defines the other
            // fifteen. Merge missing author categories instead of treating any
            // pre-existing category as proof the preset is fully migrated.
            const existing = document.tavernEntryGroups || [];
            const existingIds = new Set(existing.map(group => group.id));
            const missing = tavernEntryGroups.filter(group => !existingIds.has(group.id));
            // The earlier entryGrouping format can have an endIdentifier that
            // was NOT in prompt_order; the old importer appended that prompt at
            // the end, making its group swallow unrelated author sections.
            // A known original category is authoritative for those IDs.
            const originalMemberIds = new Set<string>();
            for (const group of tavernEntryGroups) {
                const first = indexes.get('st-' + group.startIdentifier);
                const last = indexes.get('st-' + group.endIdentifier);
                if (first === undefined || last === undefined || last < first) continue;
                for (let i = first; i <= last; i += 1) {
                    originalMemberIds.add(document.prompts[i].id.slice(3));
                }
            }
            const retained = existing.filter(group => {
                if (group.id.startsWith('legacy-' + layoutIndex + '-')) return true;
                const members = [
                    ...(group.memberIdentifiers || []),
                    group.startIdentifier,
                    group.endIdentifier,
                ].filter((id): id is string => typeof id === 'string');
                return !members.some(identifier => originalMemberIds.has(identifier));
            });
            if (!missing.length && retained.length === existing.length) return document;
            // Discard only superseded or structurally invalid category hints.
            // This never removes or edits any prompt, its switch, or its order.
            return {
                ...document, sourceFormat: 'sillytavern',
                tavernEntryGroups: [...missing, ...retained],
            };
        }
    }
    return document;
};

export const restoreSavedStoryTavernPreset = (preset: StoryTheaterPreset): StoryTheaterPreset => {
    if (!preset?.document || preset.builtIn) return preset;
    const document = restoreStoryTavernLegacyGroups(preset.document);
    return document === preset.document ? preset : { ...preset, document };
};
