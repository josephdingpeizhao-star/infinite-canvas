const GPT_IMAGE_SIZE_TIERS = {
    landscape: "1536x1024",
    square: "1024x1024",
    portrait: "1024x1536",
} as const;

const LANDSCAPE_RATIO_THRESHOLD = 1.2247;
const PORTRAIT_RATIO_THRESHOLD = 0.8165;
const SIZE_FORMAT_ERROR = "图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024";
const SIZE_PATTERN = /^(\d+(?:\.\d+)?)(?::|x)(\d+(?:\.\d+)?)$/i;

export function isGptImageModel(model: string): boolean {
    return model.toLowerCase().includes("gpt-image");
}

export function resolveGptImageSize(size: string): string | undefined {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;

    const match = value.match(SIZE_PATTERN);
    if (!match) throw new Error(SIZE_FORMAT_ERROR);
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(SIZE_FORMAT_ERROR);

    const ratio = width / height;
    if (ratio >= LANDSCAPE_RATIO_THRESHOLD) return GPT_IMAGE_SIZE_TIERS.landscape;
    if (ratio <= PORTRAIT_RATIO_THRESHOLD) return GPT_IMAGE_SIZE_TIERS.portrait;
    return GPT_IMAGE_SIZE_TIERS.square;
}
