// 超过 4000 字符才折叠，避免普通对话增加额外交互。
export const LONG_TEXT_THRESHOLD = 4_000;
// 预览保留 1500 字符，兼顾上下文可读性与首次渲染成本。
export const COLLAPSED_PREVIEW_CHARS = 1_500;
// 默认只挂载最近 30 条消息，覆盖常见上下文且限制历史线程首屏成本。
export const MESSAGE_WINDOW_SIZE = 30;
// 详情最多渲染 20000 字符，避免大型工具结果撑满 DOM。
export const DETAIL_JSON_LIMIT = 20_000;

type ClampTextOptions = {
    threshold?: number;
    previewChars?: number;
};

export type ClampedText = {
    text: string;
    truncated: boolean;
    totalChars: number;
};

export function clampText(text: string, expanded: boolean, options: ClampTextOptions = {}): ClampedText {
    const threshold = options.threshold ?? LONG_TEXT_THRESHOLD;
    const previewChars = options.previewChars ?? COLLAPSED_PREVIEW_CHARS;
    const totalChars = text.length;
    if (expanded || totalChars <= threshold) return { text, truncated: false, totalChars };
    return { text: text.slice(0, previewChars), truncated: true, totalChars };
}

export function windowMessages<T>(items: T[], showAll: boolean, windowSize = MESSAGE_WINDOW_SIZE): { visible: T[]; hiddenCount: number } {
    if (showAll || items.length <= windowSize) return { visible: items, hiddenCount: 0 };
    const hiddenCount = items.length - windowSize;
    return { visible: items.slice(hiddenCount), hiddenCount };
}

export function clampDetailJson(json: string, expanded: boolean): ClampedText {
    return clampText(json, expanded, { threshold: DETAIL_JSON_LIMIT, previewChars: DETAIL_JSON_LIMIT });
}
