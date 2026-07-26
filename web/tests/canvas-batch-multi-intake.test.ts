import { describe, expect, test } from "bun:test";

import { DUPLICATE_PRODUCT_IMAGE_MESSAGE } from "../src/lib/canvas/canvas-batch-intake";
import {
    BATCH_MULTI_INTAKE_MAX_FILES,
    BATCH_MULTI_INTAKE_MESSAGES,
    buildBatchMultiIntakeCommit,
    executeBatchMultiIntake,
    planBatchImagePlacements,
    preflightBatchIntakeWorker,
    resolveBatchMultiIntakeSelection,
    type BatchMultiIntakeDependencies,
    type BatchMultiIntakeItem,
    type BatchMultiIntakeProof,
    type BatchMultiIntakeSnapshot,
} from "../src/lib/canvas/canvas-batch-multi-intake";
import { applyIntakeRoleBadgesToNodes } from "../src/lib/canvas/canvas-intake-role-visibility";
import {
    CanvasNodeType,
    type CanvasBatchIntakeMetadata,
    type CanvasBatchSourceFile,
    type CanvasConnection,
    type CanvasNodeData,
} from "../src/types/canvas";

function card(
    id = "card",
    patch: Partial<CanvasBatchIntakeMetadata> = {},
): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 700, y: 100 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status: "draft",
                productType: "杯子",
                productHeightCm: 8,
                allowClearWater: false,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                ...patch,
            },
        },
    };
}

function workflow(
    id = "machine",
    position = { x: 1_600, y: 200 },
): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Workflow,
        title: "工作流",
        position,
        width: 420,
        height: 300,
    };
}

function imageNode(
    id: string,
    sourceFile: CanvasBatchSourceFile,
    position = { x: 0, y: 0 },
): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: sourceFile.name,
        position,
        width: 180,
        height: 180,
        metadata: {
            content: `blob:${id}`,
            storageKey: `image:${id}`,
            bytes: sourceFile.size,
            mimeType: sourceFile.type,
            sourceFile,
        },
    };
}

function connection(
    id: string,
    fromNodeId: string,
    toNodeId: string,
): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}

function fileAt(index: number, type = "image/png", bytes = `image-${index}`) {
    return new File([bytes], `角度-${index}.png`, {
        type,
        lastModified: 1_700_000_000_000 + index,
    });
}

function sourceFileFor(
    file: File,
    index: number,
    sha256 = `${index % 10}`.repeat(64),
): CanvasBatchSourceFile {
    return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        sha256,
    };
}

function proofFor(
    file: File,
    index: number,
    sha256?: string,
): BatchMultiIntakeProof {
    return { file, sourceFile: sourceFileFor(file, index, sha256) };
}

function uploaded(file: File, index: number, width = 800, height = 600) {
    return {
        url: `blob:${index}`,
        storageKey: `image:stored-${index}`,
        width,
        height,
        bytes: file.size,
        mimeType: file.type,
    };
}

function itemFor(file: File, index: number): BatchMultiIntakeItem {
    return {
        ...proofFor(file, index),
        image: uploaded(file, index),
    };
}

function readySnapshot(): BatchMultiIntakeSnapshot {
    const info = card();
    const machine = workflow();
    return {
        nodes: [info, machine],
        connections: [
            connection("card-machine", info.id, machine.id),
        ],
    };
}

function dependencies(
    snapshot: BatchMultiIntakeSnapshot,
    patch: Partial<BatchMultiIntakeDependencies> = {},
): BatchMultiIntakeDependencies {
    let nextId = 0;
    return {
        getSnapshot: () => snapshot,
        createSourceFile: async (file) => sourceFileFor(file, ++nextId),
        checkHealth: async () => ({ ok: true }),
        uploadImage: async (file) => uploaded(file, ++nextId),
        deleteStoredImages: async () => undefined,
        commit: () => undefined,
        register: () => undefined,
        idFactory: () => `${++nextId}`,
        ...patch,
    };
}

function overlaps(
    first: { position: { x: number; y: number }; width: number; height: number },
    second: { position: { x: number; y: number }; width: number; height: number },
) {
    return !(
        first.position.x + first.width <= second.position.x ||
        second.position.x + second.width <= first.position.x ||
        first.position.y + first.height <= second.position.y ||
        second.position.y + second.height <= first.position.y
    );
}

describe("MU-01 product-original multi-image intake", () => {
    test("rejects a busy or completed card and validates its existing batch facts", () => {
        const file = fileAt(1);
        const proofs = [proofFor(file, 1)];
        const machine = workflow();
        const links = [connection("card-machine", "card", machine.id)];

        expect(
            resolveBatchMultiIntakeSelection(
                "card",
                proofs,
                [card("card", { status: "queued" }), machine],
                links,
            ),
        ).toEqual({ ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.cardBusy });
        expect(
            resolveBatchMultiIntakeSelection(
                "card",
                proofs,
                [card("card", { status: "completed" }), machine],
                links,
            ),
        ).toEqual({ ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.cardCompleted });
        expect(
            resolveBatchMultiIntakeSelection(
                "card",
                proofs,
                [card("card", { productType: " " }), machine],
                links,
            ),
        ).toEqual({ ok: false, message: "请填写产品品类。" });
    });

    test("fails closed for zero, multiple, or shared workflow-machine connections", () => {
        const file = fileAt(1);
        const proofs = [proofFor(file, 1)];
        const info = card();
        const firstMachine = workflow("machine-a");
        const secondMachine = workflow("machine-b");
        const otherCard = card("other-card");

        expect(
            resolveBatchMultiIntakeSelection(info.id, proofs, [info], []),
        ).toEqual({
            ok: false,
            message: "请把这张信息卡连接到一台工作流机器。",
        });
        expect(
            resolveBatchMultiIntakeSelection(
                info.id,
                proofs,
                [info, firstMachine, secondMachine],
                [
                    connection("first", info.id, firstMachine.id),
                    connection("second", info.id, secondMachine.id),
                ],
            ),
        ).toEqual({
            ok: false,
            message: "一张信息卡只能连接一台工作流机器。",
        });
        expect(
            resolveBatchMultiIntakeSelection(
                info.id,
                proofs,
                [info, otherCard, firstMachine],
                [
                    connection("own", info.id, firstMachine.id),
                    connection("other", otherCard.id, firstMachine.id),
                ],
            ),
        ).toEqual({
            ok: false,
            message: "一台工作流机器只能连接一张批次信息卡。",
        });
    });

    test("rejects all 13 files before hashing, storage, health checks, or writes", async () => {
        expect(BATCH_MULTI_INTAKE_MAX_FILES).toBe(12);
        const files = Array.from({ length: 13 }, (_, index) => fileAt(index + 1));
        let touched = 0;
        const snapshot = readySnapshot();
        const result = await executeBatchMultiIntake({
            cardId: "card",
            files,
            dependencies: dependencies(snapshot, {
                getSnapshot: () => {
                    touched += 1;
                    return snapshot;
                },
                createSourceFile: async (file) => {
                    touched += 1;
                    return sourceFileFor(file, 1);
                },
                checkHealth: async () => {
                    touched += 1;
                    return { ok: true };
                },
                uploadImage: async (file) => {
                    touched += 1;
                    return uploaded(file, 1);
                },
                commit: () => {
                    touched += 1;
                },
                register: () => {
                    touched += 1;
                },
            }),
        });
        expect(result).toBe(BATCH_MULTI_INTAKE_MESSAGES.tooMany(13));
        expect(touched).toBe(0);
    });

    test("rejects an empty image or a non-image as one invalid whole selection", async () => {
        const snapshot = readySnapshot();
        let snapshots = 0;
        const deps = dependencies(snapshot, {
            getSnapshot: () => {
                snapshots += 1;
                return snapshot;
            },
        });
        const emptyImage = new File([], "空图.png", {
            type: "image/png",
            lastModified: 1,
        });
        const text = new File(["not-image"], "说明.txt", {
            type: "text/plain",
            lastModified: 2,
        });

        expect(
            await executeBatchMultiIntake({
                cardId: "card",
                files: [emptyImage],
                dependencies: deps,
            }),
        ).toBe(BATCH_MULTI_INTAKE_MESSAGES.invalidSelection);
        expect(
            await executeBatchMultiIntake({
                cardId: "card",
                files: [fileAt(1), text],
                dependencies: deps,
            }),
        ).toBe(BATCH_MULTI_INTAKE_MESSAGES.invalidSelection);
        expect(snapshots).toBe(0);
    });

    test("rejects two selected files with the same SHA-256 in the shared NC-01 preflight", () => {
        const first = fileAt(1);
        const second = fileAt(2);
        const snapshot = readySnapshot();
        expect(
            resolveBatchMultiIntakeSelection(
                "card",
                [
                    proofFor(first, 1, "a".repeat(64)),
                    proofFor(second, 2, "a".repeat(64)),
                ],
                snapshot.nodes,
                snapshot.connections,
            ),
        ).toEqual({
            ok: false,
            message: DUPLICATE_PRODUCT_IMAGE_MESSAGE,
        });
    });

    test("rejects a selected file whose SHA-256 already belongs to a connected original", () => {
        const snapshot = readySnapshot();
        const existingFile = fileAt(9);
        const existingProof = sourceFileFor(existingFile, 9, "b".repeat(64));
        const existing = imageNode("existing", existingProof);
        snapshot.nodes.push(existing);
        snapshot.connections.push(
            connection("existing-machine", existing.id, "machine"),
        );
        const selected = fileAt(1);

        expect(
            resolveBatchMultiIntakeSelection(
                "card",
                [proofFor(selected, 1, "b".repeat(64))],
                snapshot.nodes,
                snapshot.connections,
            ),
        ).toEqual({
            ok: false,
            message: DUPLICATE_PRODUCT_IMAGE_MESSAGE,
        });
    });

    test("distinguishes service-offline, worker-stopped, and canvas-reconnecting health failures", async () => {
        expect(
            await preflightBatchIntakeWorker({
                token: "token",
                fetcher: async () => {
                    throw new Error("offline");
                },
            }),
        ).toEqual({
            ok: false,
            message: BATCH_MULTI_INTAKE_MESSAGES.serviceNotRunning,
        });
        expect(
            await preflightBatchIntakeWorker({
                token: "token",
                fetcher: async () =>
                    new Response(
                        JSON.stringify({
                            workers: {
                                batch_intake: {
                                    status: "stopped",
                                    lastStatusAt: 1,
                                },
                            },
                        }),
                        {
                            status: 503,
                            headers: { "content-type": "application/json" },
                        },
                    ),
            }),
        ).toEqual({
            ok: false,
            message: BATCH_MULTI_INTAKE_MESSAGES.workerStopped,
        });
        expect(
            await preflightBatchIntakeWorker({
                token: "token",
                fetcher: async () =>
                    new Response(
                        JSON.stringify({
                            workers: {
                                batch_intake: {
                                    status: "waiting_canvas",
                                    lastStatusAt: 1,
                                },
                            },
                        }),
                        {
                            status: 200,
                            headers: { "content-type": "application/json" },
                        },
                    ),
            }),
        ).toEqual({
            ok: false,
            message: BATCH_MULTI_INTAKE_MESSAGES.reconnecting,
        });
    });

    test("hashes every file first, then sends each file once through the existing storage channel", async () => {
        const snapshot = readySnapshot();
        const files = [fileAt(1), fileAt(2)];
        const events: string[] = [];
        let committed:
            | ReturnType<typeof buildBatchMultiIntakeCommit>
            | undefined;
        const result = await executeBatchMultiIntake({
            cardId: "card",
            files,
            dependencies: dependencies(snapshot, {
                createSourceFile: async (file) => {
                    events.push(`proof:${file.name}`);
                    return sourceFileFor(file, files.indexOf(file) + 1);
                },
                checkHealth: async () => {
                    events.push("health");
                    return { ok: true };
                },
                uploadImage: async (file) => {
                    events.push(`store:${file.name}`);
                    return uploaded(file, files.indexOf(file) + 1);
                },
                commit: (value) => {
                    events.push("commit");
                    committed = value;
                },
                register: () => {
                    events.push("register");
                },
            }),
        });

        expect(result).toBeUndefined();
        expect(events).toEqual([
            `proof:${files[0]!.name}`,
            `proof:${files[1]!.name}`,
            "health",
            `store:${files[0]!.name}`,
            `store:${files[1]!.name}`,
            "commit",
            "register",
        ]);
        expect(
            committed?.newNodes.map((node) => ({
                storageKey: node.metadata?.storageKey,
                sourceFile: node.metadata?.sourceFile,
            })),
        ).toEqual([
            {
                storageKey: "image:stored-1",
                sourceFile: sourceFileFor(files[0]!, 1),
            },
            {
                storageKey: "image:stored-2",
                sourceFile: sourceFileFor(files[1]!, 2),
            },
        ]);
    });

    test("places twelve mixed-ratio images in a collision-free four-by-three input block", () => {
        const machine = workflow("machine", { x: 2_600, y: 500 });
        const existing = [
            machine,
            card(),
            {
                id: "blocker",
                type: CanvasNodeType.Text,
                title: "既有节点",
                position: { x: 1_300, y: 350 },
                width: 500,
                height: 500,
            } satisfies CanvasNodeData,
        ];
        const sizes = Array.from({ length: 12 }, (_, index) =>
            index % 2
                ? { width: 240, height: 360 }
                : { width: 360, height: 240 },
        );
        const positions = planBatchImagePlacements(machine, existing, sizes);
        const planned = positions.map((position, index) => ({
            position,
            ...sizes[index]!,
        }));

        expect(positions).toHaveLength(12);
        for (const node of planned) {
            expect(existing.some((other) => overlaps(node, other))).toBe(false);
        }
        for (let index = 0; index < planned.length; index++) {
            for (let other = index + 1; other < planned.length; other++) {
                expect(overlaps(planned[index]!, planned[other]!)).toBe(false);
            }
        }
        for (let row = 0; row < 3; row++) {
            const rowPositions = positions.slice(row * 4, row * 4 + 4);
            expect(rowPositions).toHaveLength(4);
            expect(rowPositions.every((value, index) =>
                index === 0 || value.x > rowPositions[index - 1]!.x,
            )).toBe(true);
        }
    });

    test("keeps a deterministic safe placement when the preferred input area is repeatedly blocked", () => {
        const machine = workflow("machine", { x: 2_800, y: 400 });
        const blockers = Array.from({ length: 6 }, (_, index): CanvasNodeData => ({
            id: `block-${index}`,
            type: CanvasNodeType.Text,
            title: `阻挡 ${index}`,
            position: { x: 2_000 - index * 650, y: 200 },
            width: 620,
            height: 900,
        }));
        const existing = [machine, ...blockers];
        const sizes = Array.from({ length: 6 }, () => ({
            width: 280,
            height: 220,
        }));
        const first = planBatchImagePlacements(machine, existing, sizes);
        const second = planBatchImagePlacements(
            { ...machine, position: { ...machine.position } },
            existing.map((node) => ({
                ...node,
                position: { ...node.position },
            })),
            sizes.map((size) => ({ ...size })),
        );

        expect(second).toEqual(first);
        first.forEach((position, index) => {
            const planned = { position, ...sizes[index]! };
            expect(existing.some((node) => overlaps(planned, node))).toBe(false);
        });
    });

    test("preserves selected-file order in nodes, connections, and derived NC-01 role numbers", () => {
        const snapshot = readySnapshot();
        const files = [fileAt(1), fileAt(2), fileAt(3)];
        let nextId = 0;
        const result = buildBatchMultiIntakeCommit({
            ...snapshot,
            workflowNodeId: "machine",
            items: files.map(itemFor),
            idFactory: () => `${++nextId}`,
        });
        const roleNodes = applyIntakeRoleBadgesToNodes(
            result.nodes,
            result.connections,
        );

        expect(result.newNodes.map((node) => node.title)).toEqual(
            files.map((file) => file.name),
        );
        expect(result.newConnections.map((edge) => edge.fromNodeId)).toEqual(
            result.newNodes.map((node) => node.id),
        );
        expect(
            result.newNodes.map((node) =>
                roleNodes.find((item) => item.id === node.id)?.metadata
                    ?.batchIntakeRole,
            ),
        ).toEqual([
            { role: "product_original", index: 1, count: 3 },
            { role: "product_original", index: 2, count: 3 },
            { role: "product_original", index: 3, count: 3 },
        ]);
    });

    test("keeps the card edge untouched, targets only the unique workflow, and preserves no-op references", () => {
        const snapshot = readySnapshot();
        const originalNodes = [...snapshot.nodes];
        const cardEdge = snapshot.connections[0]!;
        let nextId = 0;
        const result = buildBatchMultiIntakeCommit({
            ...snapshot,
            workflowNodeId: "machine",
            items: [itemFor(fileAt(1), 1), itemFor(fileAt(2), 2)],
            idFactory: () => `${++nextId}`,
        });

        expect(result.nodes[0]).toBe(originalNodes[0]);
        expect(result.nodes[1]).toBe(originalNodes[1]);
        expect(result.connections[0]).toBe(cardEdge);
        expect(result.newConnections.every((edge) =>
            edge.toNodeId === "machine" &&
            result.newNodes.some((node) => node.id === edge.fromNodeId),
        )).toBe(true);
        expect(result.newConnections.some((edge) => edge.toNodeId === "card"))
            .toBe(false);

        const noOp = buildBatchMultiIntakeCommit({
            ...snapshot,
            workflowNodeId: "machine",
            items: [],
        });
        expect(noOp.nodes).toBe(snapshot.nodes);
        expect(noOp.connections).toBe(snapshot.connections);
        expect(noOp.newNodes).toEqual([]);
        expect(noOp.newConnections).toEqual([]);
    });

    test("the button contract uses one multiple picker, quantity-role copy, and synchronous double-click guards", async () => {
        const source = await Bun.file(
            new URL(
                "../src/components/canvas/canvas-batch-multi-intake-button.tsx",
                import.meta.url,
            ),
        ).text();

        expect(source).toContain("multiple");
        expect(source).toContain("选择 1–12 张产品原图");
        expect(source).toContain("正在导入 ${activeFileCount} 张产品原图");
        expect(source).toContain("submitGuard.current");
        expect(source).toContain("if (disabled || submitGuard.current) return;");
        expect(source).toContain("disabled={disabled || busy}");
    });

    test("stops at the kth storage failure, cleans known keys, and performs zero canvas writes or registration", async () => {
        const snapshot = readySnapshot();
        const files = [fileAt(1), fileAt(2), fileAt(3)];
        const uploadCalls: string[] = [];
        const cleaned: string[][] = [];
        let commits = 0;
        let registrations = 0;

        const result = await executeBatchMultiIntake({
            cardId: "card",
            files,
            dependencies: dependencies(snapshot, {
                createSourceFile: async (file) =>
                    sourceFileFor(file, files.indexOf(file) + 1),
                uploadImage: async (file) => {
                    uploadCalls.push(file.name);
                    const index = files.indexOf(file) + 1;
                    if (index === 2) throw new Error("read failed");
                    return uploaded(file, index);
                },
                deleteStoredImages: async (keys) => {
                    cleaned.push(Array.from(keys));
                },
                commit: () => {
                    commits += 1;
                },
                register: () => {
                    registrations += 1;
                },
            }),
        });

        expect(result).toBe(
            BATCH_MULTI_INTAKE_MESSAGES.localFailure(2, files[1]!.name),
        );
        expect(uploadCalls).toEqual([files[0]!.name, files[1]!.name]);
        expect(cleaned).toEqual([["image:stored-1"]]);
        expect(commits).toBe(0);
        expect(registrations).toBe(0);
    });

    test("cleans every known key when the latest source signature changes before commit", async () => {
        const initial = readySnapshot();
        const lateFile = fileAt(9);
        const lateImage = imageNode(
            "late-original",
            sourceFileFor(lateFile, 9),
        );
        const changed: BatchMultiIntakeSnapshot = {
            nodes: [...initial.nodes, lateImage],
            connections: [
                ...initial.connections,
                connection("late-machine", lateImage.id, "machine"),
            ],
        };
        const files = [fileAt(1), fileAt(2)];
        const cleaned: string[][] = [];
        let snapshots = 0;
        let commits = 0;
        let registrations = 0;

        const result = await executeBatchMultiIntake({
            cardId: "card",
            files,
            dependencies: dependencies(initial, {
                getSnapshot: () => (++snapshots === 1 ? initial : changed),
                createSourceFile: async (file) =>
                    sourceFileFor(file, files.indexOf(file) + 1),
                uploadImage: async (file) =>
                    uploaded(file, files.indexOf(file) + 1),
                deleteStoredImages: async (keys) => {
                    cleaned.push(Array.from(keys));
                },
                commit: () => {
                    commits += 1;
                },
                register: () => {
                    registrations += 1;
                },
            }),
        });

        expect(result).toBe(BATCH_MULTI_INTAKE_MESSAGES.canvasChanged);
        expect(cleaned).toEqual([
            ["image:stored-1", "image:stored-2"],
        ]);
        expect(commits).toBe(0);
        expect(registrations).toBe(0);
    });

    test("publishes complete node and edge refs before exactly one call to the existing registration entry", async () => {
        const initial = readySnapshot();
        const files = [fileAt(1), fileAt(2)];
        let liveNodes = initial.nodes;
        let liveConnections = initial.connections;
        let registrations = 0;
        const result = await executeBatchMultiIntake({
            cardId: "card",
            files,
            dependencies: dependencies(initial, {
                getSnapshot: () => ({
                    nodes: liveNodes,
                    connections: liveConnections,
                }),
                createSourceFile: async (file) =>
                    sourceFileFor(file, files.indexOf(file) + 1),
                uploadImage: async (file) =>
                    uploaded(file, files.indexOf(file) + 1),
                commit: (value) => {
                    liveNodes = value.nodes;
                    liveConnections = value.connections;
                },
                register: (cardId) => {
                    registrations += 1;
                    expect(cardId).toBe("card");
                    const newImages = liveNodes.filter(
                        (node) => node.type === CanvasNodeType.Image,
                    );
                    expect(newImages).toHaveLength(2);
                    expect(
                        newImages.every((node) =>
                            liveConnections.some(
                                (edge) =>
                                    edge.fromNodeId === node.id &&
                                    edge.toNodeId === "machine",
                            ),
                        ),
                    ).toBe(true);
                },
            }),
        });

        expect(result).toBeUndefined();
        expect(registrations).toBe(1);
    });
});
