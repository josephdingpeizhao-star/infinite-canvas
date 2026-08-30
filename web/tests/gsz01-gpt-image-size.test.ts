import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { isGptImageModel, resolveGptImageSize } from "../src/lib/gpt-image-size";

const helperSource = readFileSync(new URL("../src/lib/gpt-image-size.ts", import.meta.url), "utf8");
const imageApiSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const requestEditStart = imageApiSource.indexOf("export async function requestEdit");
const requestGenerationSource = imageApiSource.slice(imageApiSource.indexOf("export async function requestGeneration"), requestEditStart);
const requestEditSource = imageApiSource.slice(requestEditStart);
const sizeFormatError = "图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024";
const requestSizeWiring = /const requestSize = isGptImageModel\(requestConfig\.model\)\s*\?\s*resolveGptImageSize\(config\.size\)\s*:\s*resolveRequestSize\(quality,\s*config\.size\);/g;

function expectGptImageRequestWiring() {
    expect(requestGenerationSource.match(requestSizeWiring) ?? []).toHaveLength(1);
    expect(requestEditSource.match(requestSizeWiring) ?? []).toHaveLength(1);
}

describe("GSZ-01 gpt-image fixed size tiers", () => {
    test("recognizes gpt-image models after channel resolution and preserves non-target models", () => {
        expect(["gpt-image-2", "gpt-image-1", "GPT-Image-2"].map(isGptImageModel)).toEqual([true, true, true]);
        expect(["dall-e-3", "gemini-3-pro-image", ""].map(isGptImageModel)).toEqual([false, false, false]);
    });

    test("snaps the required aspect-ratio matrix to the three fixed tiers", () => {
        expectGptImageRequestWiring();
        expect(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map(resolveGptImageSize)).toEqual([
            "1024x1024",
            "1536x1024",
            "1024x1536",
            "1536x1024",
            "1024x1536",
            "1536x1024",
            "1024x1536",
        ]);
        // Cross-repository contract: render_task_assembler.py ASPECT_TO_IMAGE_SIZE maps 3:4 to this exact tier.
        expect(resolveGptImageSize("3:4")).toBe("1024x1536");
    });

    test("snaps explicit pixels including the 1760x2352 incident regression", () => {
        expectGptImageRequestWiring();
        expect(resolveGptImageSize("1024x1536")).toBe("1024x1536");
        expect(resolveGptImageSize("1760x2352")).toBe("1024x1536");
        expect(resolveGptImageSize("2048x2048")).toBe("1024x1024");
    });

    test("omits size for empty and case-insensitive auto values", () => {
        expect(resolveGptImageSize("")).toBeUndefined();
        expect(resolveGptImageSize("auto")).toBeUndefined();
        expect(resolveGptImageSize("AUTO")).toBeUndefined();
    });

    test("pins both threshold boundaries and both neighboring sides", () => {
        expect(resolveGptImageSize("1.2247:1")).toBe("1536x1024");
        expect(resolveGptImageSize("1.2248:1")).toBe("1536x1024");
        expect(resolveGptImageSize("1.2246:1")).toBe("1024x1024");
        expect(resolveGptImageSize("0.8165:1")).toBe("1024x1536");
        expect(resolveGptImageSize("0.8164:1")).toBe("1024x1536");
        expect(resolveGptImageSize("0.8166:1")).toBe("1024x1024");
    });

    test("rejects unsupported and non-positive formats with the existing exact message", () => {
        for (const value of ["square", "1", "1/1", "0:1", "1:0", "-1:1", "1:-1", "NaN:1", "1024x0", "0x1024"]) {
            expect(() => resolveGptImageSize(value)).toThrow(sizeFormatError);
        }
    });

    test("defines each fixed tier and threshold in one source location", () => {
        for (const tier of ["1536x1024", "1024x1024", "1024x1536"]) {
            expect(helperSource.match(new RegExp(`"${tier}"`, "g"))).toHaveLength(1);
        }
        expect(helperSource.match(/\b1\.2247\b/g)).toHaveLength(1);
        expect(helperSource.match(/\b0\.8165\b/g)).toHaveLength(1);
    });

    test("wires both OpenAI image entries after model resolution without quality-driven gpt sizing", () => {
        expect(imageApiSource).toContain('import { isGptImageModel, resolveGptImageSize } from "@/lib/gpt-image-size";');
        expectGptImageRequestWiring();
        expect(imageApiSource).not.toMatch(/isGptImageModel\(config\.model/);
        const gptBranches = [...imageApiSource.matchAll(/isGptImageModel\(requestConfig\.model\)\s*\?\s*([^:;]+)\s*:/g)];
        expect(gptBranches).toHaveLength(2);
        for (const branch of gptBranches) expect(branch[1]).not.toMatch(/\bresolve(?:Request)?Size\(/);
        expect(imageApiSource.match(/\.\.\.\(quality \? \{ quality \} : \{\}\)/g)).toHaveLength(1);
        expect(imageApiSource.match(/formData\.set\("quality", quality\);/g)).toHaveLength(1);
    });
});
