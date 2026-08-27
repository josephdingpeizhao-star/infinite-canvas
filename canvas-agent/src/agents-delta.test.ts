import assert from "node:assert/strict";
import test from "node:test";

import * as agents from "./agents.js";

type TimerHandle = number;
type Scheduler = {
    setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimeout: (handle: TimerHandle) => void;
};
type DeltaBuffer = {
    append: (turnId: string, itemId: string, delta: string) => void;
    completeItem: (turnId: string, itemId: string, finalText?: string) => void;
    flushTurn: (turnId: string) => void;
    finishTurn: (turnId: string) => number;
    activeItemCount: () => number;
};
type DeltaTestSurface = {
    CODEX_DELTA_THROTTLE_MS?: number;
    agentStreamId?: (turnId: string, itemId: string) => string;
    createCodexDeltaSnapshotBuffer?: (
        emit: (event: string, payload: Record<string, unknown>) => void,
        scheduler: Scheduler,
    ) => DeltaBuffer;
};

class FakeClock implements Scheduler {
    private now = 0;
    private nextId = 1;
    private tasks = new Map<number, { at: number; callback: () => void }>();

    setTimeout = (callback: () => void, delayMs: number) => {
        const id = this.nextId++;
        this.tasks.set(id, { at: this.now + delayMs, callback });
        return id;
    };

    clearTimeout = (handle: number) => {
        this.tasks.delete(handle);
    };

    tick(milliseconds: number) {
        const target = this.now + milliseconds;
        while (true) {
            const next = [...this.tasks.entries()]
                .filter(([, task]) => task.at <= target)
                .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
            if (!next) break;
            const [id, task] = next;
            this.tasks.delete(id);
            this.now = task.at;
            task.callback();
        }
        this.now = target;
    }

    pendingCount() {
        return this.tasks.size;
    }
}

const subject = agents as DeltaTestSurface;

function testBuffer() {
    const clock = new FakeClock();
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    assert.equal(typeof subject.createCodexDeltaSnapshotBuffer, "function");
    const buffer = subject.createCodexDeltaSnapshotBuffer?.((event, payload) => events.push({ event, payload }), clock);
    assert.ok(buffer);
    return { buffer, clock, events };
}

function snapshots(events: Array<{ event: string; payload: Record<string, unknown> }>) {
    return events.map(({ payload }) => {
        const item = payload.item as Record<string, unknown>;
        return { id: item.id, text: item.text };
    });
}

test("delta throttling uses the selected 100 ms freshness window", () => {
    assert.equal(subject.CODEX_DELTA_THROTTLE_MS, 100);
});

test("many continuous deltas emit only bounded latest full snapshots", () => {
    const { buffer, clock, events } = testBuffer();
    const pieces = Array.from({ length: 40 }, (_, index) => `[${index}]`);

    for (const piece of pieces.slice(0, 20)) buffer.append("turn-1", "item-1", piece);
    assert.equal(events.length, 1);
    assert.deepEqual(snapshots(events), [{ id: "turn-1:item-1", text: pieces[0] }]);

    clock.tick(100);
    assert.equal(events.length, 2);
    assert.equal(snapshots(events)[1]?.text, pieces.slice(0, 20).join(""));

    for (const piece of pieces.slice(20)) buffer.append("turn-1", "item-1", piece);
    assert.equal(events.length, 2);
    clock.tick(100);

    assert.equal(events.length, 3);
    assert.ok(events.length < pieces.length / 10);
    assert.equal(snapshots(events)[2]?.text, pieces.join(""));
});

test("item completion immediately flushes the exact final text and cancels its timer", () => {
    const { buffer, clock, events } = testBuffer();

    buffer.append("turn-1", "item-1", "首");
    buffer.append("turn-1", "item-1", "段");
    buffer.completeItem("turn-1", "item-1", "首段终文");

    assert.deepEqual(snapshots(events), [
        { id: "turn-1:item-1", text: "首" },
        { id: "turn-1:item-1", text: "首段终文" },
    ]);
    assert.equal(buffer.activeItemCount(), 0);
    assert.equal(clock.pendingCount(), 0);
    clock.tick(1_000);
    assert.equal(events.length, 2);
});

test("error flushes pending tails immediately and clears timers without losing turn state", () => {
    const { buffer, clock, events } = testBuffer();

    buffer.append("turn-error", "item-1", "A");
    buffer.append("turn-error", "item-1", "B");
    buffer.flushTurn("turn-error");

    assert.deepEqual(snapshots(events), [
        { id: "turn-error:item-1", text: "A" },
        { id: "turn-error:item-1", text: "AB" },
    ]);
    assert.equal(buffer.activeItemCount(), 1);
    assert.equal(clock.pendingCount(), 0);
});

test("turn completion flushes every tail, clears turn state, and preserves real delta count", () => {
    const { buffer, clock, events } = testBuffer();

    buffer.append("turn-1", "reused-item", "一");
    buffer.append("turn-1", "reused-item", "二");
    buffer.append("turn-1", "other-item", "甲");
    buffer.append("turn-1", "other-item", "乙");
    const deltaCount = buffer.finishTurn("turn-1");

    assert.deepEqual(snapshots(events), [
        { id: "turn-1:reused-item", text: "一" },
        { id: "turn-1:other-item", text: "甲" },
        { id: "turn-1:reused-item", text: "一二" },
        { id: "turn-1:other-item", text: "甲乙" },
    ]);
    assert.equal(deltaCount, 4);
    assert.equal(buffer.activeItemCount(), 0);
    assert.equal(clock.pendingCount(), 0);

    buffer.append("turn-2", "reused-item", "新");
    assert.equal(snapshots(events).at(-1)?.id, "turn-2:reused-item");
    assert.equal(buffer.finishTurn("turn-2"), 1);
});
