import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const componentSource = readFileSync(new URL("../src/components/canvas/canvas-batch-info-node.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../src/components/canvas/infinite-canvas.tsx", import.meta.url), "utf8");

describe("UX-01 批次信息卡滚轮滚动", () => {
    test("批次卡根滚动容器同时挂载缩放豁免属性与捕获段滚轮拦截", () => {
        const scrollLines = componentSource.split("\n").filter((line) => line.includes("overflow-y-auto"));
        expect(scrollLines).toHaveLength(1);
        expect(scrollLines[0]).toContain("data-canvas-no-zoom");
        expect(scrollLines[0]).toContain("onWheelCapture={(event) => event.stopPropagation()}");
    });

    test("画布滚轮缩放与指针处理仍认 data-canvas-no-zoom 逃生门", () => {
        expect(canvasSource).toContain('[data-canvas-no-zoom],.ant-modal');
        expect(canvasSource).toContain('closest("[data-canvas-no-zoom]")');
    });
});
