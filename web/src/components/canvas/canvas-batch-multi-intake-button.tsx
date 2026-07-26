import { Images, LoaderCircle } from "lucide-react";
import { useRef, useState, type ChangeEvent, type MouseEvent } from "react";

type CanvasBatchMultiIntakeButtonProps = {
    cardId: string;
    disabled: boolean;
    onSelect: (cardId: string, files: File[]) => Promise<string | undefined>;
};

export function CanvasBatchMultiIntakeButton({
    cardId,
    disabled,
    onSelect,
}: CanvasBatchMultiIntakeButtonProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const submitGuard = useRef(false);
    const [activeFileCount, setActiveFileCount] = useState(0);
    const [message, setMessage] = useState("");
    const busy = activeFileCount > 0;

    const handleButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (disabled || submitGuard.current) return;

        setMessage("");
        inputRef.current?.click();
    };

    const handleSelection = async (event: ChangeEvent<HTMLInputElement>) => {
        event.stopPropagation();
        const input = event.currentTarget;
        const files = Array.from(input.files || []);
        if (!files.length) {
            input.value = "";
            return;
        }
        if (disabled || submitGuard.current) {
            input.value = "";
            return;
        }

        submitGuard.current = true;
        setActiveFileCount(files.length);
        setMessage("");
        try {
            const result = await onSelect(cardId, files);
            setMessage(result || "");
        } catch {
            setMessage("本次导入没有完成，未自动重试。");
        } finally {
            submitGuard.current = false;
            setActiveFileCount(0);
            input.value = "";
        }
    };

    return (
        <div className="grid gap-1.5">
            <input
                ref={inputRef}
                hidden
                type="file"
                accept="image/*"
                multiple
                disabled={disabled || busy}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={handleSelection}
            />
            <button
                type="button"
                className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-semibold transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={disabled || busy}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleButtonClick}
            >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Images className="size-4" />}
                {busy ? `正在导入 ${activeFileCount} 张产品原图` : "选择 1–12 张产品原图"}
            </button>
            {message ? (
                <div className="text-[11px] leading-5" role="status" aria-live="polite">
                    {message}
                </div>
            ) : null}
        </div>
    );
}
