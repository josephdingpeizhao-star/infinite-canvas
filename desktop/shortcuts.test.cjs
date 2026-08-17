const assert = require("node:assert/strict");
const { test } = require("node:test");

const { resolveReloadAction } = require("./shortcuts.cjs");

function keyboardInput(overrides = {}) {
    return {
        type: "keyDown",
        key: "",
        control: false,
        shift: false,
        alt: false,
        meta: false,
        ...overrides,
    };
}

test("Ctrl+R and F5 request a normal reload", () => {
    for (const input of [
        keyboardInput({ key: "r", control: true }),
        keyboardInput({ key: "F5" }),
    ]) {
        assert.equal(resolveReloadAction(input), "reload");
    }
});

test("Ctrl+Shift+R, Ctrl+F5 and Shift+F5 request a force reload", () => {
    for (const input of [
        keyboardInput({ key: "R", control: true, shift: true }),
        keyboardInput({ key: "F5", control: true }),
        keyboardInput({ key: "F5", shift: true }),
    ]) {
        assert.equal(resolveReloadAction(input), "force-reload");
    }
});

test("unrecognized keys, events and modifier combinations are ignored", () => {
    for (const input of [
        keyboardInput({ key: "r" }),
        keyboardInput({ key: "r", shift: true }),
        keyboardInput({ key: "q", control: true }),
        keyboardInput({ type: "keyUp", key: "F5" }),
        keyboardInput({ key: "r", control: true, alt: true }),
        keyboardInput({ key: "r", control: true, meta: true }),
        keyboardInput({ key: "r", meta: true }),
        keyboardInput({ key: "F5", control: true, shift: true }),
    ]) {
        assert.equal(resolveReloadAction(input), null);
    }
});
