import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasResourceMentionTextarea } from "../src/components/canvas/canvas-resource-mention-textarea";

const source = readFileSync(new URL("../src/components/canvas/canvas-resource-mention-textarea.tsx", import.meta.url), "utf8");
const expectedHighlightClassName = "rounded-md bg-[#2f80ff]/16 text-[#2f80ff] ring-1 ring-[#2f80ff]/24";

describe("UX-05 mention 高亮文字度量合同", () => {
    test("SSR 高亮保留视觉样式且不引入布局型样式", () => {
        const html = renderToStaticMarkup(
            createElement(CanvasResourceMentionTextarea, {
                value: "前缀 图片1 后缀",
                references: [
                    {
                        id: "image-1",
                        nodeId: "node-1",
                        kind: "image",
                        label: "图片1",
                        title: "示例图片",
                        active: true,
                    },
                ],
                onChange: () => undefined,
                style: { color: "#111827" },
            }),
        );
        const highlightMatch = html.match(/<span class="([^"]*)">图片1<\/span>/);

        expect(highlightMatch).not.toBeNull();
        const className = highlightMatch?.[1] || "";
        expect(className).toContain("rounded-md");
        expect(className).toContain("bg-[#2f80ff]/16");
        expect(className).toContain("text-[#2f80ff]");
        expect(className).toContain("ring-1");
        expect(className).not.toContain("px-");
        expect(className).not.toContain("py-");
        expect(className).not.toContain("font-medium");
    });

    test("MentionHighlightText 源码片段只使用不改变文字度量的高亮样式", () => {
        const start = source.indexOf("function MentionHighlightText");
        const end = source.indexOf("function MentionMenu", start);

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const fragment = source.slice(start, end);
        expect(fragment).toContain(`className="${expectedHighlightClassName}"`);
        expect(fragment.match(/px-/g) ?? []).toHaveLength(0);
        expect(fragment.match(/py-/g) ?? []).toHaveLength(0);
        expect(fragment.match(/font-medium/g) ?? []).toHaveLength(0);
    });
});
