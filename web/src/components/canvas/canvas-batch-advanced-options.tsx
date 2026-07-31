import { ChevronDown } from "lucide-react";
import { Switch } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasBatchAdvancedOptionKey, CanvasBatchCategoryMetadata, CanvasBatchIntakeMetadata } from "@/types/canvas";

type AdvancedPatch = Pick<CanvasBatchIntakeMetadata, "prohibitPouringAndHeating" | "skipMissingDAngle">;

const STATE_FIELDS: Record<CanvasBatchAdvancedOptionKey, keyof AdvancedPatch> = {
    forbid_pouring_and_heating: "prohibitPouringAndHeating",
    missing_d_no_retake: "skipMissingDAngle",
};

export function advancedOptionPatch(field: CanvasBatchAdvancedOptionKey, checked: boolean): Partial<AdvancedPatch> {
    return { [STATE_FIELDS[field]]: checked };
}

export function CanvasBatchAdvancedOptions({
    category,
    state,
    editable,
    expanded,
    onExpandedChange,
    onChange,
}: {
    category: CanvasBatchCategoryMetadata;
    state: CanvasBatchIntakeMetadata;
    editable: boolean;
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
    onChange: (patch: Partial<AdvancedPatch>) => void;
}) {
    const theme = canvasThemes[useThemeStore((value) => value.theme)];
    return (
        <div className="rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <button
                type="button"
                className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 px-3 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60"
                aria-expanded={expanded}
                disabled={!editable}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                onClick={(event) => {
                    event.stopPropagation();
                    onExpandedChange(!expanded);
                }}
            >
                <span>
                    <span className="font-medium">高级选项</span>
                    {!expanded ? <span className="ml-2 text-[11px]" style={{ color: theme.node.muted }}>已按【{category.display_name}】默认设置</span> : null}
                </span>
                <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded ? (
                <div className="grid gap-3 border-t px-3 py-3" style={{ borderColor: theme.node.stroke }}>
                    {category.form.advanced_options.map((option) => {
                        const stateField = STATE_FIELDS[option.field];
                        return (
                            <label key={option.field} className="grid gap-1.5" onMouseDown={stopEvent} onPointerDown={stopEvent}>
                                <span className="flex items-center justify-between gap-3 text-xs">
                                    <span className="font-medium">{option.label}</span>
                                    <Switch
                                        size="small"
                                        checked={Boolean(state[stateField])}
                                        disabled={!editable}
                                        onChange={(checked) => onChange(advancedOptionPatch(option.field, checked))}
                                    />
                                </span>
                                <span className="text-[11px] leading-5" style={{ color: theme.node.muted }}>{option.description}</span>
                            </label>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

function stopEvent(event: { stopPropagation: () => void }) {
    event.stopPropagation();
}
