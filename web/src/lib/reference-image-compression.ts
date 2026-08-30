// 主仓 RN-01 使用更高阈值与多级长边，本前端直连版因缺少后端退避重试而采用更激进的单级参数。
import { isGptImageModel } from "@/lib/gpt-image-size";

const REFERENCE_LONG_EDGE = 1280;
const REFERENCE_JPEG_QUALITY = 0.85;
const REFERENCE_SKIP_BYTES = 262144;

export function dataUrlByteLength(dataUrl: string): number {
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex < 0 || !/;base64$/i.test(dataUrl.slice(0, commaIndex))) return 0;

    const base64 = dataUrl.slice(commaIndex + 1);
    if (!base64) return 0;
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function shouldCompressReference(byteLength: number, hasMask: boolean, model: string): boolean {
    if (hasMask) return false;
    if (!isGptImageModel(model)) return false;
    return byteLength > REFERENCE_SKIP_BYTES;
}

export function pickSmallerDataUrl(original: string, candidate: string | null): string {
    if (!candidate || dataUrlByteLength(candidate) >= dataUrlByteLength(original)) return original;
    return candidate;
}

export async function reencodeDataUrl(dataUrl: string): Promise<string | null> {
    try {
        if (typeof Image === "undefined" || typeof document === "undefined") return null;

        return await new Promise<string | null>((resolve) => {
            const image = new Image();
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout>;
            const finish = (value: string | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                image.onload = null;
                image.onerror = null;
                resolve(value);
            };

            timeoutId = setTimeout(() => finish(null), 5000);
            image.onload = () => {
                try {
                    const width = image.naturalWidth || image.width;
                    const height = image.naturalHeight || image.height;
                    if (width <= 0 || height <= 0) return finish(null);

                    const scale = Math.min(1, REFERENCE_LONG_EDGE / Math.max(width, height));
                    const targetWidth = Math.max(1, Math.round(width * scale));
                    const targetHeight = Math.max(1, Math.round(height * scale));
                    const canvas = document.createElement("canvas");
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    const context = canvas.getContext("2d");
                    if (!context) return finish(null);

                    context.fillStyle = "#ffffff";
                    context.fillRect(0, 0, targetWidth, targetHeight);
                    context.drawImage(image, 0, 0, targetWidth, targetHeight);
                    finish(canvas.toDataURL("image/jpeg", REFERENCE_JPEG_QUALITY));
                } catch {
                    finish(null);
                }
            };
            image.onerror = () => finish(null);
            image.src = dataUrl;
        });
    } catch {
        return null;
    }
}

export async function prepareGptImageReferenceDataUrl(dataUrl: string, hasMask: boolean, model: string): Promise<string> {
    if (!shouldCompressReference(dataUrlByteLength(dataUrl), hasMask, model)) return dataUrl;
    try {
        return pickSmallerDataUrl(dataUrl, await reencodeDataUrl(dataUrl));
    } catch {
        return dataUrl;
    }
}
