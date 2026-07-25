import { canvasThemes } from "@/lib/canvas-theme";
import {
    composeImageBadgeStack,
    intakeRoleBadgeView,
} from "@/lib/canvas/canvas-intake-role-visibility";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasBatchIntakeRoleMetadata } from "@/types/canvas";


type QcBadgeView = {
    text: string;
    tone: "pass" | "problem" | "review";
};


export function CanvasImageBadgeStack({
    role,
    qc,
}: {
    role?: CanvasBatchIntakeRoleMetadata;
    qc: QcBadgeView | null;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const stack = composeImageBadgeStack(intakeRoleBadgeView(role), qc);
    if (!stack.visible) return null;
    return (
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex flex-col items-end gap-1">
            {stack.role ? (
                <span
                    className="rounded-full px-2 py-1 text-[10px] font-semibold shadow"
                    style={{
                        background: stack.role.tone === "conflict" ? "#991b1b" : stack.role.tone === "product" ? theme.node.activeStroke : theme.toolbar.activeBg,
                        color: stack.role.tone === "conflict" ? "#fff" : stack.role.tone === "product" ? theme.node.panel : theme.node.text,
                    }}
                >
                    {stack.role.text}
                </span>
            ) : null}
            {stack.qc ? (
                <span
                    className="rounded-full px-2 py-1 text-[10px] font-semibold shadow"
                    style={{
                        background: stack.qc.tone === "pass" ? "#166534" : stack.qc.tone === "review" ? "#92400e" : "#991b1b",
                        color: "#fff",
                    }}
                >
                    {stack.qc.text}
                </span>
            ) : null}
        </div>
    );
}
