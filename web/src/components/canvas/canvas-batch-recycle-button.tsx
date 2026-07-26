import { LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";

import {
    advanceBatchRecycleButton,
    batchRecycleButtonDisabled,
    batchRecycleButtonLabel,
    submitBatchRecycle,
    type BatchRecycleButtonPhase,
} from "@/lib/canvas/canvas-batch-recycle";
import { useAgentStore } from "@/stores/use-agent-store";

export function CanvasBatchRecycleButton({ batchId }: { batchId: string }) {
    const token = useAgentStore((state) => state.token);
    const [phase, setPhase] = useState<BatchRecycleButtonPhase>("idle");
    const [message, setMessage] = useState("");
    const submitGuard = useRef(false);

    const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (submitGuard.current) return;

        const next = advanceBatchRecycleButton(phase);
        setPhase(next.phase);
        setMessage("");
        if (!next.shouldSubmit) return;

        submitGuard.current = true;
        try {
            const receipt = await submitBatchRecycle(batchId, token);
            setMessage(receipt.message);
            setPhase("succeeded");
        } catch (error) {
            submitGuard.current = false;
            setMessage(error instanceof Error ? error.message : "批次回收没有完成，本次未自动重试。");
            setPhase("failed");
        }
    };

    return (
        <div className="mt-1 grid gap-1.5 border-t pt-3" style={{ borderColor: "rgba(248, 113, 113, 0.35)" }}>
            <button
                type="button"
                className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-red-400/70 bg-red-500/10 px-3 text-xs font-semibold text-red-400 disabled:cursor-not-allowed disabled:opacity-55"
                disabled={!batchId || batchRecycleButtonDisabled(phase)}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleClick}
            >
                {phase === "submitting" ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {batchRecycleButtonLabel(phase)}
            </button>
            {message ? (
                <div className="text-[11px] leading-5 text-red-400" role="status" aria-live="polite">
                    {message}
                </div>
            ) : null}
        </div>
    );
}
