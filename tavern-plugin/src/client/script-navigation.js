function ScriptNavigation(props) {
    const h = React.createElement;
    const [page, setPage] = React.useState(null);
    const [chunkSize, setChunkSize] = React.useState("500");
    const [position, setPosition] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    const generation = React.useRef(0);
    const activeSession = React.useRef(null);
    if (activeSession.current?.id !== props.sessionId) activeSession.current = { id: props.sessionId };
    const previousSession = React.useRef(null);
    function currentBlock(value) {
        return value?.totalChunks ? String(Math.min(value.totalChunks, value.cursor + 1)) : "";
    }
    async function load(target) {
        const ticket = ++generation.current;
        setLoading(true); setError("");
        try {
            const result = await rpc("browseScript", target === undefined ? {} : { position: target }, props.sessionId);
            if (ticket === generation.current) {
                setPage(result);
                setChunkSize(String(result.chunkSize || 500));
                setPosition(value => value.trim() === "" ? currentBlock(result) : value);
            }
        } catch (err) { if (ticket === generation.current) setError(String(err.message || err)); }
        finally { if (ticket === generation.current) setLoading(false); }
    }
    React.useEffect(() => {
        if (previousSession.current !== props.sessionId) {
            setPage(null); setPosition(""); setChunkSize("500"); setNotice(""); setSaving(false);
            previousSession.current = props.sessionId;
        }
        load();
        return () => { generation.current++; };
    }, [props.sessionId, props.cursor, props.total, props.chunkSize]);
    async function point(number) {
        if (props.busy || saving || loading || !page) return;
        const session = activeSession.current;
        setSaving(true); setError(""); setNotice("");
        try {
            const result = await rpc("pointScript", { position: number, revision: page.revision, cardPath: page.cardPath, scriptVersion: page.scriptVersion }, props.sessionId);
            if (session !== activeSession.current) return;
            setPage(current => current ? { ...current, cursor: result.cursor } : current);
            setNotice("游标已设为第 " + String(result.cursor + 1).padStart(2, "0") + " 块，下一轮从这里继续。");
            liveTavernView.invalidate(props.sessionId);
            setSaving(false);
            await load(number);
        } catch (err) { if (session === activeSession.current) setError(String(err.message || err)); }
        finally { if (session === activeSession.current) setSaving(false); }
    }
    async function saveChunkSize(event) {
        event.preventDefault();
        if (props.busy || saving || loading || !page) return;
        const value = Number(chunkSize);
        if (!Number.isSafeInteger(value) || value < 100 || value > 10000) { setError("请输入 100–10000 的整数"); return; }
        const session = activeSession.current;
        setSaving(true); setError(""); setNotice("");
        try {
            await rpc("setScriptChunkSize", { chunkSize: value, revision: page.revision, cardPath: page.cardPath, scriptVersion: page.scriptVersion }, props.sessionId);
            if (session !== activeSession.current) return;
            setPosition("");
            setNotice("已保存推进字数，原文阅读位置保持不变，下一轮生效。");
            liveTavernView.invalidate(props.sessionId);
            await load();
        } catch (err) { if (session === activeSession.current) setError(String(err.message || err)); }
        finally { if (session === activeSession.current) setSaving(false); }
    }
    function jump(event) {
        event.preventDefault();
        const value = position.trim() === "" ? currentBlock(page) : position;
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1 || number > (page?.totalChunks || 0)) { setError("请输入有效的剧本块号"); return; }
        setPosition(value);
        load(number);
    }
    return h("section", { className: "dsh-tavern-status-section dsh-script-nav", "aria-label": "剧本块列表" },
        h("div", { className: "dsh-tavern-status-label" }, "剧本块"),
        h("p", { className: "dsh-script-nav-hint" }, "先浏览，再选择起点。调整将在下一轮生效。"),
        h("form", { className: "dsh-script-nav-toolbar", onSubmit: jump },
            h("label", { className: "dsh-script-nav-position" }, "剧本块号", h("input", { type: "number", min: 1, max: page?.totalChunks || 1, step: 1, "aria-label": "剧本块号", placeholder: "剧本块号", value: position, disabled: saving,
                onChange: event => setPosition(event.target.value) })),
            h("button", { type: "submit", disabled: loading || saving || !page?.totalChunks }, "跳转到"),
            h("button", { type: "button", disabled: loading || saving, onClick: () => load() }, "回到当前")),
        h("form", { className: "dsh-script-nav-toolbar", onSubmit: saveChunkSize },
            h("label", { className: "dsh-script-nav-position" }, "每轮推进字数", h("input", { type: "number", min: 100, max: 10000, step: 1, "aria-label": "每轮推进字数", value: chunkSize, disabled: props.busy || saving || loading || !page,
                onChange: event => setChunkSize(event.target.value) })),
            h("button", { type: "submit", disabled: props.busy || saving || loading || !page || Number(chunkSize) === (page.chunkSize || 500) }, saving ? "保存中…" : "保存字数")),
        h("p", { className: "dsh-script-nav-hint" }, "默认 500，范围 100–10000，按汉字计数，尽量在句末或段落末切分。仅当前游玩生效；重新切片保留原文阅读位置。"),
        error ? h("p", { role: "alert" }, error) : null,
        notice ? h("p", { role: "status", className: "dsh-script-nav-notice" }, notice) : null,
        props.busy ? h("p", null, "任务进行中，可浏览，暂不能修改游标或推进字数。") : null,
        loading ? h("p", { role: "status" }, "读取中…") : null,
        page ? h("div", null,
            h("p", { className: "dsh-script-nav-range" }, (page.cursor < page.totalChunks ? "当前游标：第 " + String(page.cursor + 1).padStart(2, "0") + " 块 · " : "") + page.from + "–" + page.to + " / " + page.totalChunks + " 块" + (page.cursor >= page.totalChunks && page.totalChunks ? " · 剧本已结束" : "")),
            page.chunks.map(chunk => h("div", { key: chunk.number, className: "dsh-tavern-script-chunk dsh-script-nav-item", "aria-current": chunk.number === page.cursor + 1 ? "step" : undefined },
                h("details", null, h("summary", null, (chunk.number === page.cursor + 1 ? "当前 · " : "") + "第 " + String(chunk.number).padStart(2, "0") + " 块"),
                    h("div", { className: "dsh-tavern-script-chunk-text", style: { whiteSpace: "pre-wrap" } }, chunk.text)),
                h("button", { type: "button", className: "dsh-script-nav-choose", disabled: props.busy || loading || saving || chunk.number === page.cursor + 1, onClick: () => point(chunk.number), "aria-label": "切换游标到第 " + chunk.number + " 块" }, chunk.number === page.cursor + 1 ? "✓ 当前游标" : "切换游标位置"))),
            h("div", { className: "dsh-script-nav-pages" }, h("button", { type: "button", disabled: loading || saving || page.from <= 1, onClick: () => load(Math.max(1, page.from - 6)) }, "← 剧本块"),
            h("button", { type: "button", disabled: loading || saving || page.to >= page.totalChunks, onClick: () => load(Math.min(page.totalChunks, page.from + 14)) }, "剧本块 →"))) : null);
}
