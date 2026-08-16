export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    label?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    label?: string;
    storageKey?: string;
    durationMs?: number;
};
