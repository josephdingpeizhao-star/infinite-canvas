import { describe, expect, test } from "bun:test";

import * as materialUploadModule from "../src/lib/canvas/canvas-material-upload";
import {
    MATERIAL_UPLOAD_ACCEPT,
    MAX_MATERIAL_UPLOAD_FILES,
    appendMaterialUploadNode,
    materialFileKind,
    runMaterialUploadBatch,
    type MaterialFileKind,
} from "../src/lib/canvas/canvas-material-upload";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../src/types/canvas";

const anchor: Position = { x: 500, y: 400 };
const materialUploadFocus = (
    materialUploadModule as unknown as {
        materialUploadFocus: (nodes: CanvasNodeData[]) => { selectedNodeId?: string; dialogNodeId?: string };
    }
).materialUploadFocus;

function file(name: string, type: string) {
    return new File([name], name, { type });
}

function node(id: string, width = 120, height = 80, position: Position = { x: 0, y: 0 }): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position,
        width,
        height,
    };
}

function mediaNode(id: string, kind: MaterialFileKind): CanvasNodeData {
    const type = {
        image: CanvasNodeType.Image,
        video: CanvasNodeType.Video,
        audio: CanvasNodeType.Audio,
    }[kind];
    return { ...node(id), type };
}

function overlaps(first: CanvasNodeData, second: CanvasNodeData) {
    return (
        first.position.x < second.position.x + second.width &&
        first.position.x + first.width > second.position.x &&
        first.position.y < second.position.y + second.height &&
        first.position.y + first.height > second.position.y
    );
}

describe("MU-02 material upload contract", () => {
    test("accepts twenty files and uploads then commits each one strictly in selection order", async () => {
        const files = [
            ...Array.from({ length: 19 }, (_, index) => file(`${String(index + 1).padStart(2, "0")}.png`, "image/png")),
            file("20.mp3", "audio/mpeg"),
        ];
        const trace: string[] = [];
        let current: CanvasNodeData[] = [];

        const result = await runMaterialUploadBatch({
            files,
            mode: "multiple",
            anchor,
            uploadFile: async (item, kind, oneBasedIndex) => {
                trace.push(`upload-start:${item.name}:${kind}:${oneBasedIndex}`);
                await Promise.resolve();
                trace.push(`upload-end:${item.name}`);
                return mediaNode(`node-${oneBasedIndex}`, kind);
            },
            commitNode: (update) => {
                trace.push(`commit:${current.length + 1}`);
                current = update(current);
            },
        });

        expect(result).toMatchObject({ status: "completed", uploadedCount: 20 });
        expect(current.map((item) => item.id)).toEqual(files.map((_, index) => `node-${index + 1}`));
        expect(trace).toEqual(
            files.flatMap((item, index) => [
                `upload-start:${item.name}:${index === 19 ? "audio" : "image"}:${index + 1}`,
                `upload-end:${item.name}`,
                `commit:${index + 1}`,
            ]),
        );
        expect(materialUploadFocus(current)).toEqual({ selectedNodeId: "node-20", dialogNodeId: "node-19" });

        const allAudioFocus = materialUploadFocus([mediaNode("audio-1", "audio"), mediaNode("audio-2", "audio")]);
        expect(allAudioFocus.selectedNodeId).toBe("audio-2");
        expect(allAudioFocus.dialogNodeId).toBeUndefined();
    });

    test("rejects twenty-one files as a whole before upload or node writing", async () => {
        const original = [node("old")];
        let current = original;
        let uploadCalls = 0;
        let commitCalls = 0;

        const result = await runMaterialUploadBatch({
            files: Array.from({ length: 21 }, (_, index) => file(`${index}.png`, "image/png")),
            mode: "multiple",
            anchor,
            uploadFile: async () => {
                uploadCalls += 1;
                return node("unexpected");
            },
            commitNode: (update) => {
                commitCalls += 1;
                current = update(current);
            },
        });

        expect(result).toMatchObject({ status: "rejected", uploadedCount: 0 });
        expect(result.message).toContain("一次最多选择 20 个素材");
        expect(uploadCalls).toBe(0);
        expect(commitCalls).toBe(0);
        expect(current).toBe(original);
    });

    test("stops at the failed item, keeps earlier nodes, skips later files, and names the failed ordinal", async () => {
        const attempted: string[] = [];
        let current: CanvasNodeData[] = [];

        const result = await runMaterialUploadBatch({
            files: [
                file("one.png", "image/png"),
                file("two.mp3", "audio/mpeg"),
                file("three.png", "image/png"),
                file("four.png", "image/png"),
            ],
            mode: "multiple",
            anchor,
            uploadFile: async (item, kind, oneBasedIndex) => {
                attempted.push(item.name);
                if (oneBasedIndex === 3) throw new Error("provider details must not replace the human message");
                return mediaNode(`node-${oneBasedIndex}`, kind);
            },
            commitNode: (update) => {
                current = update(current);
            },
        });

        expect(result).toMatchObject({ status: "failed", uploadedCount: 2, failedIndex: 3 });
        expect(result.message).toContain("第 3 个素材上传失败");
        expect(attempted).toEqual(["one.png", "two.mp3", "three.png"]);
        expect(current.map((item) => item.id)).toEqual(["node-1", "node-2"]);
        expect(materialUploadFocus(current)).toEqual({ selectedNodeId: "node-2", dialogNodeId: "node-1" });
    });

    test("keeps the existing accept range, recognizes every current media kind, and wholly rejects abnormal multi-file single mode", async () => {
        expect(MAX_MATERIAL_UPLOAD_FILES).toBe(20);
        expect(MATERIAL_UPLOAD_ACCEPT).toBe("image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav");
        expect(
            [
                file("image.webp", "image/webp"),
                file("video.webm", "video/webm"),
                file("audio.ogg", "audio/ogg"),
                file("silent.mp3", ""),
                file("silent.WAV", ""),
                file("conflict.mp3", "video/mp4"),
                file("conflict.wav", "image/png"),
            ].map(materialFileKind),
        ).toEqual(["image", "video", "audio", "audio", "audio", "audio", "audio"]);
        expect(materialFileKind(file("notes.txt", "text/plain"))).toBeNull();

        let uploadCalls = 0;
        let commitCalls = 0;
        const result = await runMaterialUploadBatch({
            files: [file("first.png", "image/png"), file("second.png", "image/png")],
            mode: "single",
            anchor,
            uploadFile: async () => {
                uploadCalls += 1;
                return node("unexpected");
            },
            commitNode: () => {
                commitCalls += 1;
            },
        });
        expect(result).toMatchObject({ status: "rejected", uploadedCount: 0 });
        expect(result.message).toContain("一次只能选择 1 个素材");
        expect(uploadCalls).toBe(0);
        expect(commitCalls).toBe(0);
    });

    test("batch placement avoids existing and earlier batch nodes without moving old nodes", () => {
        const firstOld = node("old-center", 240, 180, { x: 380, y: 310 });
        const secondOld = node("old-right", 160, 140, { x: 660, y: 330 });
        const oldPositions = [firstOld.position, secondOld.position].map((position) => ({ ...position }));
        let current = [firstOld, secondOld];

        for (const id of ["new-1", "new-2", "new-3"]) {
            current = appendMaterialUploadNode(current, node(id), { anchor, avoidOverlap: true });
        }

        for (let first = 0; first < current.length; first += 1) {
            for (let second = first + 1; second < current.length; second += 1) {
                expect(overlaps(current[first], current[second])).toBe(false);
            }
        }
        expect(firstOld.position).toEqual(oldPositions[0]);
        expect(secondOld.position).toEqual(oldPositions[1]);
        expect(current[0]).toBe(firstOld);
        expect(current[1]).toBe(secondOld);
    });

    test("single-file placement preserves the existing exact center behavior", () => {
        const candidate = node("single", 140, 90, { x: 999, y: 999 });
        const result = appendMaterialUploadNode([], candidate, { anchor, avoidOverlap: false });

        expect(result).toHaveLength(1);
        expect(result[0].position).toEqual({ x: anchor.x - candidate.width / 2, y: anchor.y - candidate.height / 2 });
    });

    test("the committed updater decides placement from the latest current nodes before appending", async () => {
        const lateBlocker = node("late-blocker", 220, 180, { x: anchor.x - 110, y: anchor.y - 90 });
        let current: CanvasNodeData[] = [];
        let insertedLateBlocker = false;

        await runMaterialUploadBatch({
            files: [file("first.png", "image/png"), file("second.png", "image/png")],
            mode: "multiple",
            anchor,
            uploadFile: async (_item, _kind, oneBasedIndex) => node(`new-${oneBasedIndex}`),
            commitNode: (update) => {
                if (!insertedLateBlocker) {
                    current = [...current, lateBlocker];
                    insertedLateBlocker = true;
                }
                current = update(current);
            },
        });

        const firstUploaded = current.find((item) => item.id === "new-1");
        expect(firstUploaded).toBeDefined();
        expect(overlaps(lateBlocker, firstUploaded!)).toBe(false);
        expect(current.map((item) => item.id)).toEqual(["late-blocker", "new-1", "new-2"]);
    });

    test("a duplicate-id no-op preserves the original node-array reference", () => {
        const original = [node("same-id")];
        const result = appendMaterialUploadNode(original, node("same-id", 300, 200), { anchor, avoidOverlap: true });

        expect(result).toBe(original);
    });

    test("a successful append creates one array while preserving every old node object reference", () => {
        const first = node("first", 100, 100, { x: 0, y: 0 });
        const second = node("second", 100, 100, { x: 200, y: 0 });
        const original = [first, second];
        const result = appendMaterialUploadNode(original, node("third"), { anchor, avoidOverlap: true });

        expect(result).not.toBe(original);
        expect(result).toHaveLength(3);
        expect(result[0]).toBe(first);
        expect(result[1]).toBe(second);
    });

    test("project wiring makes only toolbar and drop multi-file, never silently takes files[0], and adds no role side effects", async () => {
        const projectSource = await Bun.file(new URL("../src/pages/canvas/project.tsx", import.meta.url)).text();
        const moduleSource = await Bun.file(new URL("../src/lib/canvas/canvas-material-upload.ts", import.meta.url)).text();
        const inputTag = projectSource.match(/<input\s+ref=\{imageInputRef\}[\s\S]*?\/>/)?.[0];

        expect(inputTag).toBeDefined();
        expect(inputTag).toMatch(/\bmultiple(?:\s|=|\/?>)/);
        expect(inputTag).toMatch(
            /accept=(?:"image\/\*,video\/\*,audio\/mpeg,audio\/wav,audio\/x-wav,\.mp3,\.wav"|\{MATERIAL_UPLOAD_ACCEPT\})/,
        );
        expect(projectSource).toContain('onImportImage={() => handleUploadRequest("single")}');
        expect(projectSource).toContain('onUpload={(node) => handleUploadRequest("single", node.id)}');
        expect(projectSource).toContain('onUpload={() => handleUploadRequest("multiple")}');
        expect(projectSource).toContain('input.multiple = mode === "multiple";');
        expect(projectSource).toContain('(mode === "single" || target?.nodeId) && files.length > 1');
        expect(projectSource).toContain('message.warning("此入口一次只能选择 1 个素材，请重新选择。");');
        expect(projectSource).not.toMatch(/event\.target\.files\s*(?:\?\.)?\s*\[\s*0\s*\]/);
        expect(projectSource).not.toContain("Array.from(event.dataTransfer.files).find(");
        expect(projectSource.match(/runMaterialUploadBatch\(/g)?.length || 0).toBeGreaterThanOrEqual(2);
        for (const forbidden of [/\bconnections?\b/i, /\bregister(?:ed|ing|s)?\b/i, /\bNC-01\b/i, /\bSHA(?:-?256)?\b/i]) {
            expect(moduleSource).not.toMatch(forbidden);
        }
    });
});
