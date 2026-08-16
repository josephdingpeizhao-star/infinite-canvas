import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/canvas/canvas-resource-mention-textarea.tsx", import.meta.url), "utf8");

describe("UX-04 mention 光标与触发合同", () => {
    test("textarea 在 mergedStyle 内提升为定位元素", () => {
        const start = source.indexOf("const mergedStyle");
        const closing = "} as CSSProperties";
        const end = source.indexOf(closing, start);

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(source.slice(start, end + closing.length)).toContain('position: "relative"');
    });

    test("文字后的 @ 与行首 @ 使用同一触发规则", () => {
        expect(source).toContain("/@([^\\s@]*)$/");
        expect(source).not.toContain("(^|\\s)@");
        expect(source).toContain("match[1].length");
        expect(source).not.toContain("match[2]");
    });
});
