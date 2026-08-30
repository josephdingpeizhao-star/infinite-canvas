import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    dataUrlByteLength,
    pickSmallerDataUrl,
    shouldCompressReference,
} from "../src/lib/reference-image-compression";

const helperSource = readFileSync(new URL("../src/lib/reference-image-compression.ts", import.meta.url), "utf8");
const imageApiSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const requestGenerationStart = imageApiSource.indexOf("export async function requestGeneration");
const requestEditStart = imageApiSource.indexOf("export async function requestEdit");
const requestImageQuestionStart = imageApiSource.indexOf("export async function requestImageQuestion");
const requestGenerationSource = imageApiSource.slice(requestGenerationStart, requestEditStart);
const requestEditSource = imageApiSource.slice(requestEditStart, requestImageQuestionStart);
const openAiEditStart = requestEditSource.indexOf("const quality = normalizeQuality");
const requestEditGeminiSource = requestEditSource.slice(0, openAiEditStart);
const requestEditOpenAiSource = requestEditSource.slice(openAiEditStart);

describe("GSZ-02 gpt-image reference compression", () => {
    test("calculates base64 byte lengths with and without padding", () => {
        expect(dataUrlByteLength("data:image/png;base64,QUJD")).toBe(3);
        expect(dataUrlByteLength("data:image/png;base64,QUI=")).toBe(2);
        expect(dataUrlByteLength("data:image/png;base64,QQ==")).toBe(1);
        expect(dataUrlByteLength("data:text/plain,ABC")).toBe(0);
    });

    test("compresses only large unmasked gpt-image references above the exact threshold", () => {
        expect(shouldCompressReference(500_000, false, "gpt-image-2")).toBe(true);
        expect(shouldCompressReference(500_000, true, "gpt-image-2")).toBe(false);
        expect(shouldCompressReference(500_000, false, "dall-e-3")).toBe(false);
        expect(shouldCompressReference(262_144, false, "gpt-image-2")).toBe(false);
        expect(shouldCompressReference(262_145, false, "gpt-image-2")).toBe(true);
    });

    test("keeps the original unless the candidate is strictly smaller", () => {
        const original = "data:image/png;base64,QUJDREVG";
        const larger = "data:image/jpeg;base64,QUJDREVGRw==";
        const equal = "data:image/jpeg;base64,R0hJSktM";
        const smaller = "data:image/jpeg;base64,QUJD";

        expect(pickSmallerDataUrl(original, null)).toBe(original);
        expect(pickSmallerDataUrl(original, larger)).toBe(original);
        expect(pickSmallerDataUrl(original, equal)).toBe(original);
        expect(pickSmallerDataUrl(original, smaller)).toBe(smaller);
    });

    test("defines each compression parameter in one source location", () => {
        const definitions = [
            ["REFERENCE_LONG_EDGE", "1280", /\b1280\b/g],
            ["REFERENCE_JPEG_QUALITY", "0\\.85", /\b0\.85\b/g],
            ["REFERENCE_SKIP_BYTES", "262144", /\b262144\b/g],
        ] as const;

        for (const [name, valuePattern, literalPattern] of definitions) {
            expect(helperSource.match(new RegExp(`const ${name} = ${valuePattern};`, "g")) ?? []).toHaveLength(1);
            expect(helperSource.match(literalPattern) ?? []).toHaveLength(1);
        }
    });

    test("reuses the GSZ-01 model predicate instead of duplicating it", () => {
        expect(helperSource).toContain('import { isGptImageModel } from "@/lib/gpt-image-size";');
        expect(helperSource).not.toMatch(/function isGptImageModel/);
    });

    test("wires only the OpenAI requestEdit reference path after model resolution", () => {
        expect(imageApiSource).toContain('import { prepareGptImageReferenceDataUrl } from "@/lib/reference-image-compression";');
        expect(requestEditSource.match(/prepareGptImageReferenceDataUrl\(/g) ?? []).toHaveLength(1);
        expect(
            requestEditOpenAiSource.match(
                /prepareGptImageReferenceDataUrl\(\s*dataUrl,\s*Boolean\(mask\),\s*requestConfig\.model\s*\)/g,
            ) ?? [],
        ).toHaveLength(1);
        expect(requestEditOpenAiSource.match(/const dataUrl = await imageToDataUrl\(image\);/g) ?? []).toHaveLength(1);
        expect(requestEditOpenAiSource).toContain("dataUrlToFile({ ...image, dataUrl: preparedDataUrl })");
        expect(requestGenerationSource).not.toContain("prepareGptImageReferenceDataUrl");
        expect(requestEditGeminiSource).not.toContain("prepareGptImageReferenceDataUrl");
        expect(requestEditSource).toContain('if (mask) formData.set("mask", dataUrlToFile(mask));');
    });
});
