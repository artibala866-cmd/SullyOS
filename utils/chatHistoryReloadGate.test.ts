import { describe, expect, it } from 'vitest';
import { ChatHistoryReloadGate } from './chatHistoryReloadGate';

describe('private chat message list snapshot ordering', () => {
    it('never applies a late, older read after the newer read finishes', async () => {
        const gate = new ChatHistoryReloadGate();
        let finishOld!: (v: string[]) => void;
        const oldQuery = new Promise<string[]>(resolve => { finishOld = resolve; });
        const oldTicket = gate.begin();

        const newTicket = gate.begin();
        const rendered: string[][] = [];
        const newSnapshot = ['msg1', 'msg2', 'msg3'];
        if (gate.isCurrent(newTicket)) rendered.push(newSnapshot);

        // Simulate the original DB query finishing after the last message arrived.
        finishOld(['msg1']);
        const oldSnapshot = await oldQuery;
        if (gate.isCurrent(oldTicket)) rendered.push(oldSnapshot);

        expect(rendered).toEqual([newSnapshot]);
    });

    it('does not let a previously started reload overwrite direct AI message updates', () => {
        const gate = new ChatHistoryReloadGate();
        const staleTicket = gate.begin();
        gate.invalidate(); // applyAssistantPostProcessing publishes a newer snapshot
        expect(gate.isCurrent(staleTicket)).toBe(false);
        expect(gate.isCurrent(gate.begin())).toBe(true);
    });

    it('does not accept an outdated retry or a previous conversation read', () => {
        const gate = new ChatHistoryReloadGate();
        const original = gate.begin();
        const retry = gate.begin();
        expect(gate.isCurrent(original)).toBe(false);
        gate.invalidate(); // switch chat before the retry resolves
        expect(gate.isCurrent(retry)).toBe(false);
    });
});
