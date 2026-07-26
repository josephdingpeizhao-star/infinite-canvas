import { useCallback, useEffect, useRef, useState } from "react";

import {
    buildProjectDeletionPlan,
    commitFrontendProjectDeletion,
    confirmationTextForProjectDeletion,
    previewProjectDeletion,
    projectDeletionConfirmationMatches,
    sameProjectDeletionPlan,
    submitProjectDeletionExecution,
    type ProjectDeletionExecuteReceipt,
    type ProjectDeletionPlan,
    type ProjectDeletionPreviewReceipt,
} from "@/lib/canvas/canvas-project-delete";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export type CanvasProjectDeletePhase = "idle" | "previewing" | "review" | "typed_confirmation" | "executing" | "stopped" | "failed";

export type CanvasProjectDeleteState = {
    phase: CanvasProjectDeletePhase;
    request?: { projectIds: string[]; deleteAll: boolean };
    plan?: ProjectDeletionPlan;
    preview?: ProjectDeletionPreviewReceipt;
    execution?: ProjectDeletionExecuteReceipt;
    confirmationInput: string;
    message: string;
};

const INITIAL_STATE: CanvasProjectDeleteState = {
    phase: "idle",
    confirmationInput: "",
    message: "",
};

export function claimCanvasProjectDeletionExecution(gate: { current: boolean }) {
    if (gate.current) return false;
    gate.current = true;
    return true;
}

export function useCanvasProjectDelete({ onDeleted }: { onDeleted?: (projectIds: string[]) => void } = {}) {
    const token = useAgentStore((store) => store.token);
    const deleteProjects = useCanvasStore((store) => store.deleteProjects);
    const cleanupImages = useAssetStore((store) => store.cleanupImages);
    const [state, setState] = useState<CanvasProjectDeleteState>(INITIAL_STATE);
    const operationRef = useRef(0);
    const executionInFlightRef = useRef(false);
    const mountedRef = useRef(true);
    const onDeletedRef = useRef(onDeleted);

    useEffect(() => {
        onDeletedRef.current = onDeleted;
    }, [onDeleted]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            operationRef.current += 1;
        };
    }, []);

    const begin = useCallback(
        async (requestedProjectIds: string[], deleteAll: boolean) => {
            if (executionInFlightRef.current) return;
            const operation = operationRef.current + 1;
            operationRef.current = operation;
            const request = { projectIds: [...requestedProjectIds], deleteAll };
            setState({ phase: "previewing", request, confirmationInput: "", message: "" });

            const plan = buildProjectDeletionPlan(useCanvasStore.getState().projects, requestedProjectIds, deleteAll);
            if (!plan.ok) {
                if (mountedRef.current && operationRef.current === operation) setState({ phase: "failed", request, confirmationInput: "", message: plan.message });
                return;
            }

            try {
                const preview = await previewProjectDeletion(plan.batchIds, token);
                if (!mountedRef.current || operationRef.current !== operation) return;
                setState({ phase: "review", request, plan, preview, confirmationInput: "", message: "" });
            } catch (error) {
                if (!mountedRef.current || operationRef.current !== operation) return;
                setState({
                    phase: "failed",
                    request,
                    plan,
                    confirmationInput: "",
                    message: error instanceof Error ? error.message : "项目删除预检没有完成，项目没有删除。",
                });
            }
        },
        [token],
    );

    const execute = useCallback(
        async (current: CanvasProjectDeleteState) => {
            if (!current.request || !current.plan || !current.preview || current.phase === "executing" || !claimCanvasProjectDeletionExecution(executionInFlightRef)) return;
            const operation = operationRef.current + 1;
            operationRef.current = operation;
            setState({ ...current, phase: "executing", message: "" });

            try {
                const latestPlan = buildProjectDeletionPlan(useCanvasStore.getState().projects, current.request.projectIds, current.request.deleteAll);
                if (!latestPlan.ok || !sameProjectDeletionPlan(current.plan, latestPlan)) {
                    if (!mountedRef.current || operationRef.current !== operation) return;
                    setState({
                        ...current,
                        phase: "failed",
                        confirmationInput: "",
                        message: latestPlan.ok ? "项目或批次引用已经变化，请重新预检并确认。" : latestPlan.message,
                    });
                    return;
                }

                try {
                    const execution: ProjectDeletionExecuteReceipt = latestPlan.batchIds.length ? await submitProjectDeletionExecution(current.preview.requestId, latestPlan.batchIds, token) : { ok: true, requestId: "", status: "completed", batches: [] };
                    if (!mountedRef.current || operationRef.current !== operation) return;
                    if (execution.status === "stopped") {
                        setState({
                            ...current,
                            phase: "stopped",
                            execution,
                            confirmationInput: "",
                            message: "后端删除在遇到问题后已停止；前端项目仍保留。请查看下方清单。",
                        });
                        return;
                    }

                    const finalPlan = buildProjectDeletionPlan(useCanvasStore.getState().projects, current.request.projectIds, current.request.deleteAll);
                    if (!finalPlan.ok || !sameProjectDeletionPlan(latestPlan, finalPlan)) {
                        setState({
                            ...current,
                            phase: "failed",
                            execution,
                            confirmationInput: "",
                            message: "原批次清单已处理，但项目或其他画布的关联在删除期间发生变化。前端项目已保留，请重新预检。",
                        });
                        return;
                    }

                    const committed = await commitFrontendProjectDeletion(execution, finalPlan.projectIds, deleteProjects, cleanupImages);
                    if (!committed) {
                        setState({ ...current, phase: "failed", execution, confirmationInput: "", message: "删除回执不完整，项目仍保留。" });
                        return;
                    }
                    if (mountedRef.current && operationRef.current === operation) onDeletedRef.current?.(finalPlan.projectIds);
                } catch (error) {
                    if (!mountedRef.current || operationRef.current !== operation) return;
                    setState({
                        ...current,
                        phase: "failed",
                        confirmationInput: "",
                        message: error instanceof Error ? error.message : "项目删除没有完成，项目仍保留。",
                    });
                }
            } finally {
                if (operationRef.current === operation) executionInFlightRef.current = false;
            }
        },
        [cleanupImages, deleteProjects, token],
    );

    const confirmReview = useCallback(() => {
        if (state.phase !== "review" || !state.preview || !state.plan) return;
        const requiredText = confirmationTextForProjectDeletion(state.plan.deleteAll, state.preview);
        if (requiredText) {
            setState((current) => ({ ...current, phase: "typed_confirmation", confirmationInput: "", message: "" }));
            return;
        }
        void execute(state);
    }, [execute, state]);

    const confirmTyped = useCallback(() => {
        if (state.phase !== "typed_confirmation" || !state.preview || !state.plan) return;
        const requiredText = confirmationTextForProjectDeletion(state.plan.deleteAll, state.preview);
        if (!projectDeletionConfirmationMatches(state.confirmationInput, requiredText)) return;
        void execute(state);
    }, [execute, state]);

    const setConfirmationInput = useCallback((confirmationInput: string) => {
        setState((current) => ({ ...current, confirmationInput }));
    }, []);

    const backToReview = useCallback(() => {
        setState((current) => ({ ...current, phase: "review", confirmationInput: "", message: "" }));
    }, []);

    const retry = useCallback(() => {
        if (!state.request || state.phase === "executing" || state.phase === "previewing") return;
        void begin(state.request.projectIds, state.request.deleteAll);
    }, [begin, state.phase, state.request]);

    const reset = useCallback(() => {
        operationRef.current += 1;
        executionInFlightRef.current = false;
        setState(INITIAL_STATE);
    }, []);

    return {
        state,
        begin,
        confirmReview,
        confirmTyped,
        setConfirmationInput,
        backToReview,
        retry,
        reset,
    };
}
