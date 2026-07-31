import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { readExpectedImageSet } from "@/lib/canvas/canvas-workflow-production";
import { getImageBlob } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type WorkflowImageDownloadScope = "selected" | "all";
export type WorkflowImageDownloadMethod = "zip" | "individual";
export type WorkflowImageDownloadSource = "renders" | "repaired";

export type WorkflowImageDownloadItem = {
    nodeId: string;
    configId: string;
    source: WorkflowImageDownloadSource;
    fileName: string;
    storageKey: string;
};

export type WorkflowImageDownloadPlan = {
    batchId: string;
    zipFileName: string;
    items: WorkflowImageDownloadItem[];
};

export type ResolvedWorkflowImageDownload = {
    files: Array<WorkflowImageDownloadItem & { data: Blob }>;
    missingItems: WorkflowImageDownloadItem[];
};

export type WorkflowImageDownloadResult = {
    downloadedCount: number;
    totalCount: number;
    missingItems: WorkflowImageDownloadItem[];
};

export function isWorkflowImageDownloadCandidate(node: CanvasNodeData, batchId: string, expectedConfigIds: readonly string[]) {
    const storageKey = node.metadata?.storageKey;
    const proof = node.metadata?.workflowProductionOutput;
    return (
        node.type === CanvasNodeType.Image &&
        typeof storageKey === "string" &&
        storageKey.trim().length > 0 &&
        Boolean(proof) &&
        Boolean(batchId) &&
        proof!.batchId === batchId &&
        expectedConfigIds.includes(proof!.configId) &&
        (proof!.source === "renders" || proof!.source === "repaired") &&
        SHA256_PATTERN.test(proof!.sha256)
    );
}

export function buildWorkflowImageDownloadPlan(machine: CanvasNodeData, nodes: CanvasNodeData[], scope: WorkflowImageDownloadScope, selectedNodeIds: ReadonlySet<string>): WorkflowImageDownloadPlan | undefined {
    if (machine.type !== CanvasNodeType.Workflow) return undefined;
    const production = machine.metadata?.workflowProduction;
    const batchId = typeof production?.batchId === "string" ? production.batchId : "";
    const expected = readExpectedImageSet(production?.totalCount, production?.expectedConfigIds);
    if (!batchId || !expected) return undefined;

    const expectedIndex = new Map(expected.expectedConfigIds.map((configId, index) => [configId, index]));
    const seenNodeIds = new Set<string>();
    const items: WorkflowImageDownloadItem[] = [];
    for (const node of nodes) {
        if (seenNodeIds.has(node.id)) continue;
        seenNodeIds.add(node.id);
        if (scope === "selected" && !selectedNodeIds.has(node.id)) continue;
        if (!isWorkflowImageDownloadCandidate(node, batchId, expected.expectedConfigIds)) continue;
        const proof = node.metadata!.workflowProductionOutput!;
        const source = proof.source as WorkflowImageDownloadSource;
        items.push({
            nodeId: node.id,
            configId: proof.configId,
            source,
            fileName: source === "renders" ? `${proof.configId}.png` : `${proof.configId}_返修.png`,
            storageKey: node.metadata!.storageKey!,
        });
    }
    items.sort((left, right) => {
        const configOrder = expectedIndex.get(left.configId)! - expectedIndex.get(right.configId)!;
        if (configOrder) return configOrder;
        const sourceOrder = (left.source === "renders" ? 0 : 1) - (right.source === "renders" ? 0 : 1);
        if (sourceOrder) return sourceOrder;
        return left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0;
    });
    const seenFileNames = new Set<string>();
    return {
        batchId,
        zipFileName: `${batchId}.zip`,
        items: items.filter((item) => {
            if (seenFileNames.has(item.fileName)) return false;
            seenFileNames.add(item.fileName);
            return true;
        }),
    };
}

export function isWorkflowImageDownloadDisabled(downloadableImageCount: number) {
    return downloadableImageCount <= 0;
}

export function resolveWorkflowImageDownloadBlobs(plan: WorkflowImageDownloadPlan, blobsByStorageKey: ReadonlyMap<string, Blob | null | undefined>): ResolvedWorkflowImageDownload {
    const files: ResolvedWorkflowImageDownload["files"] = [];
    const missingItems: WorkflowImageDownloadItem[] = [];
    plan.items.forEach((item) => {
        const data = blobsByStorageKey.get(item.storageKey);
        if (data) files.push({ ...item, data });
        else missingItems.push(item);
    });
    return { files, missingItems };
}

export async function executeWorkflowImageDownloadPlan(plan: WorkflowImageDownloadPlan, method: WorkflowImageDownloadMethod): Promise<WorkflowImageDownloadResult> {
    const storageKeys = Array.from(new Set(plan.items.map((item) => item.storageKey)));
    const blobsByStorageKey = new Map<string, Blob | null>();
    await Promise.all(
        storageKeys.map(async (storageKey) => {
            blobsByStorageKey.set(storageKey, await getImageBlob(storageKey));
        }),
    );
    const resolved = resolveWorkflowImageDownloadBlobs(plan, blobsByStorageKey);
    if (resolved.files.length) {
        if (method === "zip") {
            const zip = await createZip(resolved.files.map((file) => ({ name: file.fileName, data: file.data })));
            saveAs(zip, plan.zipFileName);
        } else {
            resolved.files.forEach((file) => saveAs(file.data, file.fileName));
        }
    }
    return { downloadedCount: resolved.files.length, totalCount: plan.items.length, missingItems: resolved.missingItems };
}
