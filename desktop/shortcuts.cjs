function resolveReloadAction(input) {
    if (input?.type !== "keyDown" || input.alt || input.meta) return null;

    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
    const control = input.control === true;
    const shift = input.shift === true;

    if (key === "r") {
        if (control && shift) return "force-reload";
        return control ? "reload" : null;
    }
    if (key === "f5") {
        if (control === shift) return control ? null : "reload";
        return "force-reload";
    }
    return null;
}

module.exports = { resolveReloadAction };
