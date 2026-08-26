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
export type CanvasWorkflowProductionRecovery = {
    kind: "missing_reference" | "inputs_unavailable";
    files: string[];
    recomputeEligible: boolean;
};
export type CanvasWorkflowAngleInventorySummary = {
    uploaded_count: number;
    qualified: Array<{ source_asset_id: string; file_name: string; angle_slot: "A" | "B" | "C" | "D" }>;
    rejected: Array<{ source_asset_id: string; file_name: string }>;
    missing_angle_slots: Array<"A" | "B" | "C" | "D">;
    single_source_production: boolean;
};
export type CanvasWorkflowBindingDistribution = {
    bound_reference_counts: Record<string, number>;
};
export type CanvasWorkflowProductionMetadata = {
    status: CanvasWorkflowProductionStatus;
    producedCount: number;
    totalCount?: number;
    expectedConfigIds?: string[];
    requestId?: string;
    batchId?: string;
    requestedAt?: number;
    updatedAt?: number;
    step?: string;
    message?: string;
    errorMessage?: string;
    failureSource?: "image_service";
    recovery?: CanvasWorkflowProductionRecovery;
    angleInventorySummary?: CanvasWorkflowAngleInventorySummary;
    bindingDistribution?: CanvasWorkflowBindingDistribution;
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
export type CanvasBatchIntakeRoleMetadata = {
    role: "product_original" | "style_reference" | "conflict";
    index?: number;
    count?: number;
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
    totalCount?: number;
    expectedConfigIds?: string[];
    message?: string;
    closedAt?: string;
};
export type CanvasBatchIntakeStatus = "draft" | "queued" | "upload_ready" | "uploading" | "completed" | "failed" | "integrity_blocked";
export type CanvasBatchType = "single" | "set";
export type CanvasBatchSourceFile = {
    name: string;
    size: number;
    type: string;
    lastModified: number;
    sha256: string;
};
export type CanvasBatchIntakeFacts = {
    product_type: string;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    main_image_count: number;
    detail_image_count: number;
    handheld_main: number;
    handheld_detail: number;
    forbid_pouring_and_heating: boolean;
    missing_d_no_retake: boolean;
};
export type CanvasBatchDimensionKey = "length_cm" | "width_cm" | "height_cm";
export type CanvasBatchAdvancedOptionKey = "forbid_pouring_and_heating" | "missing_d_no_retake";
export type CanvasBatchCategoryMetadata = {
    key: string;
    display_name: string;
    product_noun: string;
    form: {
        dimensions: {
            required: CanvasBatchDimensionKey[];
            fields: Array<{
                key: CanvasBatchDimensionKey;
                label: string;
                unit: string;
                minimum: number;
                maximum: number;
            }>;
        };
        image_counts: {
            main: { default: number; minimum: number; maximum: number };
            detail: { default: number; minimum: number; maximum: number };
        };
        handheld: {
            main: { default: number; minimum: number };
            detail: { default: number; minimum: number };
        };
        advanced_options: Array<{
            field: CanvasBatchAdvancedOptionKey;
            default: boolean;
            label: string;
            description: string;
        }>;
    };
};
export type CanvasBatchCategoryCatalog = {
    contractHash: string;
    categories: CanvasBatchCategoryMetadata[];
};
export type CanvasBatchIntakeReceipt = {
    batchId: string;
    imageCount: number;
    facts: CanvasBatchIntakeFacts;
};
export type CanvasBatchIntakeMetadata = {
    status: CanvasBatchIntakeStatus;
    batch_type?: CanvasBatchType;
    category?: string;
    contractHash?: string;
    productType?: string;
    productLengthCm?: number;
    productWidthCm?: number;
    productHeightCm?: number;
    allowClearWater?: boolean;
    prohibitPouringAndHeating?: boolean;
    skipMissingDAngle?: boolean;
    mainImageCount?: number;
    detailImageCount?: number;
    handheldMainCount?: number;
    handheldDetailCount?: number;
    facts?: CanvasBatchIntakeFacts;
    requestId?: string;
    requestedAt?: number;
    updatedAt?: number;
    workflowNodeId?: string;
    sourceImageNodeIds?: string[];
    /** 套装批次中由用户从已连线原图勾选的合影节点。 */
    setGroupImageNodeIds?: string[];
    /** 套装登记时由“全部连线原图 − 合影勾选”派生的单件节点。 */
    componentWhiteBgImageNodeIds?: string[];
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
export type CanvasStyleReferenceRemovalStatus = "idle" | "queued" | "completed" | "failed";
export type CanvasStyleReferenceRemovalMetadata = {
    status: CanvasStyleReferenceRemovalStatus;
    requestId?: string;
    requestedAt?: number;
    updatedAt?: number;
    batchId?: string;
    errorMessage?: string;
    receipt?: { batchId: string; fileCount: number; files: string[]; receiptPath?: string };
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
    pairedNodeId?: string;
    workflowDemo?: CanvasWorkflowDemoMetadata;
    workflowDemoOutput?: CanvasWorkflowDemoOutputMetadata;
    workflowProduction?: CanvasWorkflowProductionMetadata;
    workflowProductionOutput?: CanvasWorkflowProductionOutputMetadata;
    workflowProductionQc?: CanvasWorkflowQcBadgeMetadata;
    batchIntakeRole?: CanvasBatchIntakeRoleMetadata;
    workflowRepairedProjection?: CanvasWorkflowRepairedProjectionMetadata;
    workflowReceivingBox?: CanvasWorkflowReceivingBoxMetadata;
    batchIntake?: CanvasBatchIntakeMetadata;
    styleReferenceIntake?: CanvasStyleReferenceMetadata;
    styleReferenceRemoval?: CanvasStyleReferenceRemovalMetadata;
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
