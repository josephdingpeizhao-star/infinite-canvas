import type {
    CanvasWorkflowAngleInventorySummary,
    CanvasWorkflowBindingDistribution,
    CanvasWorkflowProductionMetadata,
} from "@/types/canvas";

const ANGLE_SLOTS = new Set(["A", "B", "C", "D"]);
const MAX_OBSERVATION_COUNT = 9_999;

export function parseAngleInventorySummary(value: unknown): CanvasWorkflowAngleInventorySummary | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
        !validCount(record.uploaded_count) ||
        !Array.isArray(record.qualified) ||
        !Array.isArray(record.rejected) ||
        !Array.isArray(record.missing_angle_slots) ||
        typeof record.single_source_production !== "boolean"
    ) {
        return undefined;
    }
    const qualified = record.qualified.map(parseQualifiedAsset);
    const rejected = record.rejected.map(parseRejectedAsset);
    if (qualified.some((item) => !item) || rejected.some((item) => !item)) return undefined;
    const assetIds = [...qualified, ...rejected].map((item) => item!.source_asset_id);
    if (assetIds.length !== record.uploaded_count || new Set(assetIds).size !== assetIds.length) return undefined;
    const missing = record.missing_angle_slots;
    if (!missing.every((slot): slot is "A" | "B" | "C" | "D" => typeof slot === "string" && ANGLE_SLOTS.has(slot))) return undefined;
    if (new Set(missing).size !== missing.length) return undefined;
    const expectedSingleSource = qualified.length === 1 && record.uploaded_count > 1;
    if (record.single_source_production !== expectedSingleSource) return undefined;
    return {
        uploaded_count: record.uploaded_count,
        qualified: qualified as CanvasWorkflowAngleInventorySummary["qualified"],
        rejected: rejected as CanvasWorkflowAngleInventorySummary["rejected"],
        missing_angle_slots: [...missing],
        single_source_production: record.single_source_production,
    };
}

export function parseBindingDistribution(value: unknown): CanvasWorkflowBindingDistribution | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const rawCounts = (value as Record<string, unknown>).bound_reference_counts;
    if (!rawCounts || typeof rawCounts !== "object" || Array.isArray(rawCounts)) return undefined;
    const counts: Record<string, number> = {};
    for (const [reference, count] of Object.entries(rawCounts)) {
        if (!safeText(reference) || !validPositiveCount(count)) return undefined;
        counts[reference] = count;
    }
    return { bound_reference_counts: counts };
}

export function productionObservationMessages(state: CanvasWorkflowProductionMetadata): string[] {
    const messages = (state.angleInventorySummary?.rejected ?? []).map(
        (item) => `图 ${item.file_name} 已判定不可用于生产`,
    );
    if (state.angleInventorySummary?.single_source_production) {
        const source = state.angleInventorySummary.qualified[0];
        if (source) messages.push(`本批全部成图将只以 图${source.file_name} 为基准生成`);
    }
    if (state.status === "completed" && state.bindingDistribution) {
        const entries = Object.entries(state.bindingDistribution.bound_reference_counts);
        if (entries.length) {
            messages.push(`绑定分布（仅供参考）：${entries.map(([reference, count]) => `图 ${reference} ${count} 张`).join("；")}`);
        }
    }
    return messages;
}

function parseQualifiedAsset(value: unknown): CanvasWorkflowAngleInventorySummary["qualified"][number] | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!safeText(record.source_asset_id) || !safeText(record.file_name) || typeof record.angle_slot !== "string" || !ANGLE_SLOTS.has(record.angle_slot)) return undefined;
    return {
        source_asset_id: record.source_asset_id,
        file_name: record.file_name,
        angle_slot: record.angle_slot as "A" | "B" | "C" | "D",
    };
}

function parseRejectedAsset(value: unknown): CanvasWorkflowAngleInventorySummary["rejected"][number] | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!safeText(record.source_asset_id) || !safeText(record.file_name)) return undefined;
    return { source_asset_id: record.source_asset_id, file_name: record.file_name };
}

function safeText(value: unknown): value is string {
    return typeof value === "string" && value.length >= 1 && value.length <= 255 && !/[\r\n]/.test(value);
}

function validCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_OBSERVATION_COUNT;
}

function validPositiveCount(value: unknown): value is number {
    return validCount(value) && value > 0;
}
