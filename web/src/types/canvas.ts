export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Workflow = "workflow",
    BatchInfo = "batch-info",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasWorkflowDemoStatus = "idle" | "awaiting_confirmation" | "queued" | "running" | "completed" | "failed";
export type CanvasWorkflowDemoMetadata = {
    status: CanvasWorkflowDemoStatus;
    producedCount: number;
    completedRuns: number;
    runId?: string;
    errorMessage?: string;
    requestedAt?: number;
    updatedAt?: number;
};
export type CanvasWorkflowDemoOutputMetadata = {
    workflowNodeId: string;
    runId: string;
    index: number;
};
export type CanvasWorkflowProductionStatus = "idle" | "queued" | "running" | "paused" | "completed" | "failed";
export type CanvasWorkflowProductionMetadata = {
    status: CanvasWorkflowProductionStatus;
    producedCount: number;
    totalCount: 14;
    requestId?: string;
    batchId?: string;
    requestedAt?: number;
    updatedAt?: number;
    step?: string;
    message?: string;
    errorMessage?: string;
};
export type CanvasWorkflowProductionOutputMetadata = {
    workflowNodeId: string;
    batchId: string;
    configId: string;
    index: number;
    sha256: string;
    downloadUrl: string;
    byteCount: number;
    source?: "renders" | "repaired";
    persistedAt?: number;
    sourceBackfillStatus?: "rejected";
    sourceBackfillCode?: "source_proof_mismatch";
};
export type CanvasWorkflowQcBadgeMetadata = {
    status: "pass" | "fail" | "needs_review";
    issueCount: number;
    topCategories: string[];
};
export type CanvasWorkflowRepairedProjectionMetadata = {
    status: "idle" | "queued" | "running" | "completed" | "failed";
    batchId?: string;
    requestId?: string;
    requestedAt?: number;
    updatedAt?: number;
    projectedCount?: number;
    message?: string;
};
export type CanvasWorkflowReceivingBoxMetadata = {
    status: "open" | "submitting" | "closed" | "failed";
    batchId: string;
    workflowNodeId: string;
    selectionCount: number;
    message?: string;
    closedAt?: string;
};
export type CanvasBatchIntakeStatus = "draft" | "queued" | "upload_ready" | "uploading" | "completed" | "failed" | "integrity_blocked";
export type CanvasBatchSourceFile = {
    name: string;
    size: number;
    type: string;
    lastModified: number;
    sha256: string;
};
export type CanvasBatchIntakeFacts = {
    product_type: string;
    height_cm: number;
    handheld_main: 2;
    handheld_detail: 1;
    allow_clear_water: boolean;
    forbid_pouring_and_heating: boolean;
    missing_d_no_retake: boolean;
};
export type CanvasBatchIntakeReceipt = {
    batchId: string;
    imageCount: number;
    facts: CanvasBatchIntakeFacts;
};
export type CanvasBatchIntakeMetadata = {
    status: CanvasBatchIntakeStatus;
    productType: string;
    productHeightCm?: number;
    allowClearWater: boolean;
    prohibitPouringAndHeating: boolean;
    skipMissingDAngle: boolean;
    mainImageCount: 6;
    detailImageCount: 8;
    handheldMainCount: 2;
    handheldDetailCount: 1;
    facts?: CanvasBatchIntakeFacts;
    requestId?: string;
    requestedAt?: number;
    updatedAt?: number;
    workflowNodeId?: string;
    sourceImageNodeIds?: string[];
    batchId?: string;
    uploadBaseUrl?: string;
    expectedCount?: number;
    receivedCount?: number;
    errorMessage?: string;
    receipt?: CanvasBatchIntakeReceipt;
};
export type CanvasStyleReferenceStatus = "idle" | "queued" | "upload_ready" | "uploading" | "completed" | "failed" | "integrity_blocked";
export type CanvasStyleReferenceSource = {
    nodeId: string;
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
};
export type CanvasStyleReferenceMetadata = {
    status: CanvasStyleReferenceStatus;
    requestId?: string;
    requestedAt?: number;
    updatedAt?: number;
    batchId?: string;
    sources: CanvasStyleReferenceSource[];
    uploadBaseUrl?: string;
    errorMessage?: string;
    receipt?: { batchId: string; fileCount: number; files: string[] };
};
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    workflowDemo?: CanvasWorkflowDemoMetadata;
    workflowDemoOutput?: CanvasWorkflowDemoOutputMetadata;
    workflowProduction?: CanvasWorkflowProductionMetadata;
    workflowProductionOutput?: CanvasWorkflowProductionOutputMetadata;
    workflowProductionQc?: CanvasWorkflowQcBadgeMetadata;
    workflowRepairedProjection?: CanvasWorkflowRepairedProjectionMetadata;
    workflowReceivingBox?: CanvasWorkflowReceivingBoxMetadata;
    batchIntake?: CanvasBatchIntakeMetadata;
    styleReferenceIntake?: CanvasStyleReferenceMetadata;
    sourceFile?: CanvasBatchSourceFile;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
