import { describe, expect, test } from "bun:test";

import { buildAcceptancePayload, createReceivingBox, fetchAcceptanceStatus, receivingBoxId, receivingBoxView, receivingSelections, snapNodesIntoReceivingBox, submitAcceptanceCloseout } from "../src/lib/canvas/canvas-workflow-receiving";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const CONFIG_IDS = [...Array.from({ length: 6 }, (_, index) => `main_${String(index + 1).padStart(2, "0")}`), ...Array.from({ length: 8 }, (_, index) => `detail_${String(index + 1).padStart(2, "0")}`)];

function machine(): CanvasNodeData {
    return { id: "machine", type: CanvasNodeType.Workflow, title: "machine", position: { x: 100, y: 200 }, width: 420, height: 300, metadata: {} };
}

function image(configId: string, source: "renders" | "repaired" | undefined = "renders", suffix = ""): CanvasNodeData {
    return {
        id: `image:${configId}:${source}:${suffix}`,
        type: CanvasNodeType.Image,
        title: "任意标题，不参与图位识别",
        position: { x: 200, y: 700 },
        width: 100,
        height: 100,
        metadata: {
            storageKey: "image:ready",
            workflowProductionOutput: { workflowNodeId: "machine", batchId: "cup", configId, index: 1, source, sha256: `${configId.startsWith("main") ? "a" : "b"}`.repeat(64), byteCount: 3, downloadUrl: "http://127.0.0.1:17373/output" },
        },
    };
}

describe("canvas receiving box", () => {
    test("creates one stable machine-attached receiving box", () => {
        const box = createReceivingBox(machine(), "cup");
        expect(box.id).toBe(receivingBoxId("cup"));
        expect(box.type).toBe(CanvasNodeType.Group);
        expect(box.position.y).toBeGreaterThan(500);
        expect(box.metadata?.workflowReceivingBox).toMatchObject({ status: "open", batchId: "cup", workflowNodeId: "machine" });
    });

    test("recognizes image slots only from verified metadata and never the title", () => {
        const box = createReceivingBox(machine(), "cup");
        const valid = { ...image("main_01"), metadata: { ...image("main_01").metadata, groupId: box.id } };
        const missingSource = image("main_02");
        missingSource.metadata!.workflowProductionOutput!.source = undefined;
        missingSource.metadata = { ...missingSource.metadata, groupId: box.id };
        missingSource.metadata!.workflowProductionOutput!.sourceBackfillCode = "source_proof_mismatch";
        expect(receivingSelections(box, [box, valid, missingSource]).map((item) => item.configId)).toEqual(["main_01"]);
    });

    test("accepts repaired metadata and replaces an earlier node for the same config", () => {
        const box = createReceivingBox(machine(), "cup");
        const original = { ...image("main_01", "renders", "old"), metadata: { ...image("main_01", "renders", "old").metadata, groupId: box.id } };
        const repaired = image("main_01", "repaired", "new");
        const result = snapNodesIntoReceivingBox(new Set([repaired.id]), [box, original, repaired], box);
        expect(result.find((node) => node.id === original.id)?.metadata?.groupId).toBeUndefined();
        expect(result.find((node) => node.id === original.id)?.position.x).toBeLessThan(box.position.x);
        expect(result.find((node) => node.id === repaired.id)?.metadata?.groupId).toBe(box.id);
        expect(receivingSelections(box, result)[0]?.source).toBe("repaired");
    });

    test("dragging a selected image out cancels that slot", () => {
        const box = createReceivingBox(machine(), "cup");
        const selected = { ...image("main_01"), metadata: { ...image("main_01").metadata, groupId: box.id } };
        const draggedOut = { ...selected, metadata: { ...selected.metadata, groupId: undefined } };
        expect(receivingSelections(box, [box, selected])).toHaveLength(1);
        expect(receivingSelections(box, [box, draggedOut])).toHaveLength(0);
    });

    test("shows confirm only after fourteen distinct verified slots", () => {
        const box = createReceivingBox(machine(), "cup");
        const partial = CONFIG_IDS.slice(0, 13).map((configId) => ({ ...image(configId), metadata: { ...image(configId).metadata, groupId: box.id } }));
        const full = [...partial, { ...image(CONFIG_IDS[13]!), metadata: { ...image(CONFIG_IDS[13]!).metadata, groupId: box.id } }];
        expect(receivingBoxView(box, [box, ...partial])).toMatchObject({ count: 13, canConfirm: false });
        expect(receivingBoxView(box, [box, ...full])).toMatchObject({ count: 14, canConfirm: true });
    });

    test("builds the exact fourteen-item closeout payload with source and SHA", () => {
        const box = createReceivingBox(machine(), "cup");
        const nodes = CONFIG_IDS.map((configId, index) => {
            const node = image(configId, index % 2 ? "repaired" : "renders");
            return { ...node, metadata: { ...node.metadata, groupId: box.id } };
        });
        const payload = buildAcceptancePayload(box, [box, ...nodes], "request-1");
        expect(payload).toMatchObject({ requestId: "request-1", machineId: "machine" });
        expect(payload.selections).toHaveLength(14);
        expect(Object.keys(payload.selections[0]!).sort()).toEqual(["configId", "sha256", "source"]);
    });

    test("submits closeout once through the token-protected JSON endpoint", async () => {
        const box = createReceivingBox(machine(), "cup");
        const nodes = CONFIG_IDS.map((configId) => {
            const node = image(configId);
            return { ...node, metadata: { ...node.metadata, groupId: box.id } };
        });
        const payload = buildAcceptancePayload(box, [box, ...nodes], "request-1");
        let captured: RequestInit | undefined;
        const result = await submitAcceptanceCloseout("cup", " token ", payload, async (_input, init) => {
            captured = init;
            return new Response(JSON.stringify({ ok: true, batchId: "cup", status: "closed", closedAt: "2026-07-24T12:00:00" }), { status: 200 });
        });
        expect(result.status).toBe("closed");
        expect(captured?.method).toBe("POST");
        expect(new Headers(captured?.headers).get("x-canvas-agent-token")).toBe("token");
        expect(JSON.parse(String(captured?.body)).selections).toHaveLength(14);
    });

    test("restores an already-closed status without returning final selections", async () => {
        const result = await fetchAcceptanceStatus("cup", "token", async () => new Response(JSON.stringify({ ok: true, batchId: "cup", status: "closed", closedAt: "2026-07-24T12:00:00" }), { status: 200 }));
        expect(result.status).toBe("closed");
        expect("selections" in result).toBe(false);
    });
});
