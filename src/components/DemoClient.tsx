"use client";

import { useCallback, useRef, useState } from "react";
import { BeforeAfter } from "./BeforeAfter";

interface ElementReport {
  verdict: "PASS" | "REPAIR" | "REGENERATE";
  mae: number;
  ms_ssim: number;
  edge_recall: number;
  contrast_retention: number;
  reasons: string[];
}

interface FidelityReport {
  verdict: "PASS" | "REPAIR" | "REGENERATE";
  elements: Record<string, ElementReport>;
  summary: Record<string, number>;
}

interface EditResult {
  ok: boolean;
  error?: string;
  route: { route: string; reason: string; decision: string; costEstimateMs: number };
  chain: { cmd: string; params?: Record<string, unknown> }[];
  timingMs: { cli: number; fidelity: number; total: number };
  fidelity: FidelityReport;
  fidelityAction: { action: string; reason: string; scope?: string[] };
  repairTrail: { level: number; desc: string; verdict: string }[];
  levelUsed: number;
  image: { base64: string; width: number; height: number };
  psd?: { base64: string; layers: { name: string; kind: string }[] };
  meta: { source: string; engine: string; license: string };
}

type Input = { kind: "sample"; id: string } | { kind: "b64"; data: string };

const SAMPLES = [
  { id: "serum", name: "Serum bottles" },
  { id: "phones", name: "Earbuds" },
  { id: "coffee", name: "Coffee bag" },
];

const ACTIONS = [
  {
    id: "remove_bg_white",
    label: "去背景换白底",
    hint: "subject · inverse · white fill",
    instruction: "去掉背景换成白底",
  },
  {
    id: "warm_up",
    label: "Warm it up",
    hint: "curves · deterministic",
    instruction: "make it warmer",
  },
  {
    id: "brighten",
    label: "Brighten",
    hint: "brightness / contrast",
    instruction: "brighten the photo",
  },
  {
    id: "boost_saturation",
    label: "Vivid colours",
    hint: "hue / saturation",
    instruction: "make colours more vivid",
  },
  {
    id: "resize_for_platform",
    label: "Resize 800×800",
    hint: "fit + pad · no crop",
    instruction: "resize to 800x800",
  },
  { id: "sharpen", label: "Sharpen", hint: "smart sharpen", instruction: "sharpen the image" },
  {
    id: "watermark",
    label: "Add watermark",
    hint: "editable text layer",
    instruction: "add a SUREPIX watermark",
  },
];

interface HistoryEntry {
  input: Input;
  label: string;
  thumb: string; // data or path for the chip thumbnail
}

export default function DemoClient() {
  const [input, setInput] = useState<Input>({ kind: "sample", id: "serum" });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [actionId, setActionId] = useState(ACTIONS[0].id);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const inputSrc =
    input.kind === "b64" ? `data:image/png;base64,${input.data}` : `/samples/${input.id}.png`;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const action = ACTIONS.find((a) => a.id === actionId) ?? ACTIONS[0];
    try {
      const body: Record<string, unknown> = { intent: action.instruction };
      if (input.kind === "b64") {
        body.imageBase64 = input.data;
      } else {
        body.sampleId = input.id;
      }
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as EditResult;
      if (!res.ok || !data.ok) {
        setError(data.error || `request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setLoading(false);
    }
  }, [actionId, input]);

  const setInputAndTrack = (next: Input, label: string, thumb: string) => {
    setHistory((h) => [...h.slice(-4), { input, label, thumb: inputSrc }]);
    setInput(next);
    setResult(null);
    setError(null);
  };

  const useResultAsInput = () => {
    if (!result?.ok) return;
    const action = ACTIONS.find((a) => a.id === actionId);
    setInputAndTrack({ kind: "b64", data: result.image.base64 }, action?.label ?? "edit", inputSrc);
  };

  const resetToSample = () => {
    setInput({ kind: "sample", id: "serum" });
    setHistory([]);
    setResult(null);
    setError(null);
  };

  const onUpload = (file: File) => {
    if (file.size > 3.5 * 1024 * 1024) {
      setError("image too large for the demo (max 3.5MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const b64 = s.includes(",") ? s.split(",")[1] : s;
      setInputAndTrack({ kind: "b64", data: b64 }, "your upload", inputSrc);
    };
    reader.readAsDataURL(file);
  };

  const routeClass =
    result?.route.route === "photocraft"
      ? "photocraft"
      : result?.route.route === "reject"
        ? "reject"
        : "regenerate";

  return (
    <div className="wrap demo-shell">
      <header
        className="nav"
        style={{
          position: "static",
          background: "transparent",
          border: "none",
          backdropFilter: "none",
          marginBottom: 8,
        }}
      >
        <div className="nav-inner" style={{ height: 48 }}>
          <a href="/" className="logo">
            <span className="logo-mark" aria-hidden="true">
              S
            </span>
            Surepix
          </a>
          <nav className="nav-links">
            <a href="/">← Back to home</a>
          </nav>
        </div>
      </header>

      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>Live demo</h1>
        <p style={{ color: "var(--ink-2)", margin: "8px 0 0", maxWidth: "56em", fontSize: 15.5 }}>
          The real pipeline, running now: intent routing → whitelist validation → PhotoCraft CLI →
          per-element fidelity verification. Sample photos carry a 6-element brand manifest; your
          uploads get a whole-image check.
        </p>
      </div>

      <div className="demo-grid">
        {/* 左：画布 */}
        <div className="panel">
          <div className="panel-head">
            <span>Canvas</span>
            <span className="hint">
              {result
                ? `${result.image.width}×${result.image.height}px · ${result.timingMs.total.toFixed(0)}ms end-to-end`
                : "no edit yet"}
            </span>
          </div>
          <div className="panel-body">
            <div className="sample-row" role="group" aria-label="Sample photos">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  className={`sample-chip${input.kind === "sample" && input.id === s.id ? " on" : ""}`}
                  onClick={() => setInputAndTrack({ kind: "sample", id: s.id }, s.name, inputSrc)}
                >
                  <img src={`/samples/${s.id}.png`} alt="" width={40} height={30} />
                  {s.name}
                </button>
              ))}
              <button className="sample-chip" onClick={() => fileRef.current?.click()}>
                Upload yours
              </button>
              {input.kind === "b64" && (
                <button className="sample-chip" onClick={resetToSample}>
                  Reset
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
              />
            </div>

            {result?.ok ? (
              <BeforeAfter
                before={inputSrc}
                after={`data:image/png;base64,${result.image.base64}`}
                altBefore="input image"
                altAfter="edited image"
                initial={50}
              />
            ) : (
              <div className="canvas" style={{ minHeight: 300 }}>
                <img src={inputSrc} alt="current input image" />
                {loading && <div className="spin">running pipeline…</div>}
              </div>
            )}

            {history.length > 0 && (
              <div className="history-row">
                <span className="hr-label">history:</span>
                {history.map((h, i) => (
                  <button
                    key={`${h.label}-${i}`}
                    className="history-chip"
                    onClick={() => {
                      setInput(h.input);
                      setResult(null);
                      setError(null);
                    }}
                  >
                    <img src={h.thumb} alt="" />
                    {h.label}
                  </button>
                ))}
              </div>
            )}

            {result?.ok && (
              <div className="chain-row">
                <button className="chain-btn" onClick={useResultAsInput}>
                  Use result as input →
                </button>
                <a
                  className="chain-btn"
                  style={{ textDecoration: "none" }}
                  href={`data:image/png;base64,${result.image.base64}`}
                  download="surepix-result.png"
                >
                  Download PNG
                </a>
                {result.psd && (
                  <a
                    className="chain-btn"
                    style={{ textDecoration: "none" }}
                    href={`data:image/octet-stream;base64,${result.psd.base64}`}
                    download="surepix-master.psd"
                  >
                    Download PSD ({result.psd.layers.filter((l) => l.kind === "Type").length} text
                    layer
                    {result.psd.layers.filter((l) => l.kind === "Type").length === 1 ? "" : "s"})
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右：控制 + 报告 */}
        <div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <span>Edit action</span>
              <span className="hint">routed deterministically</span>
            </div>
            <div className="panel-body">
              <div className="action-grid" role="group" aria-label="Edit actions">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    className={`action-btn${actionId === a.id ? " on" : ""}`}
                    onClick={() => setActionId(a.id)}
                  >
                    {a.label}
                    <small>{a.hint}</small>
                  </button>
                ))}
              </div>
              <div className="run-row">
                <button className="btn btn-brand" onClick={run} disabled={loading}>
                  {loading ? "Running…" : "Run & verify →"}
                </button>
              </div>
              <p className="demo-note">
                Semantic requests (“change the background”) are detected by the router and routed to
                the generative path. In demo mode it runs through the mock provider; set
                GENERATIVE_PROVIDER=fal + FAL_KEY to use a real model.
              </p>
            </div>
          </div>

          {error && <div className="error-box">{error}</div>}

          {result?.ok && (
            <>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <span>Pipeline report</span>
                  <span className="hint">{result.meta.engine}</span>
                </div>
                <div className="panel-body">
                  <div className={`route-box ${routeClass}`}>
                    <div className="rt">route: {result.route.route}</div>
                    <div>{result.route.reason}</div>
                    <div style={{ opacity: 0.75, marginTop: 2 }}>{result.route.decision}</div>
                  </div>
                  <div className="result-meta">
                    <div className="metric">
                      <div className="k">CLI</div>
                      <div className="v">
                        {result.timingMs.cli}
                        <small> ms</small>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="k">Fidelity</div>
                      <div className="v">
                        {result.timingMs.fidelity}
                        <small> ms</small>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="k">Total</div>
                      <div className="v">
                        {result.timingMs.total}
                        <small> ms</small>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-3)",
                      fontFamily: "var(--mono)",
                      wordBreak: "break-all",
                    }}
                  >
                    chain: {result.chain.map((c) => c.cmd).join(" → ")}
                  </div>
                  {result.repairTrail.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        background: "var(--warn-bg)",
                        border: "1px solid #fde68a",
                        color: "var(--warn)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 13,
                      }}
                    >
                      <b>Auto-repaired:</b> level{" "}
                      {result.repairTrail.map((r) => `L${r.level} (${r.verdict})`).join(" → ")} →
                      retried with gentler parameters → delivered at L{result.levelUsed}
                    </div>
                  )}
                  {result.fidelityAction.action !== "accept" && result.repairTrail.length === 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        background: "var(--bad-bg)",
                        border: "1px solid #fecaca",
                        color: "var(--bad)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 13,
                      }}
                    >
                      <b>Escalation needed:</b> {result.fidelityAction.reason}
                      {result.fidelityAction.scope
                        ? ` · scope: ${result.fidelityAction.scope.join(", ")}`
                        : ""}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span>Fidelity verification</span>
                  <span className="hint">
                    overall{" "}
                    <span className={`badge ${result.fidelity.verdict}`}>
                      {result.fidelity.verdict}
                    </span>
                  </span>
                </div>
                <div className="panel-body">
                  <div className="fid-scroll">
                    <table className="fid-table">
                      <thead>
                        <tr>
                          <th>Element</th>
                          <th>Verdict</th>
                          <th>MAE</th>
                          <th>MS-SSIM</th>
                          <th>Edge recall</th>
                          <th>Contrast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.fidelity.elements).map(([name, el]) => (
                          <tr key={name}>
                            <td>{name}</td>
                            <td>
                              <span className={`badge ${el.verdict}`}>{el.verdict}</span>
                            </td>
                            <td>{el.mae.toFixed(1)}</td>
                            <td>{el.ms_ssim.toFixed(3)}</td>
                            <td>{el.edge_recall.toFixed(3)}</td>
                            <td>{el.contrast_retention.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 13, color: "var(--ink-2)" }}>
                    <b>Decision:</b> {result.fidelityAction.reason}
                    {result.fidelityAction.scope && result.fidelityAction.scope.length > 0 && (
                      <> · scope: {result.fidelityAction.scope.join(", ")}</>
                    )}
                  </div>
                  <p className="demo-note">
                    Thresholds adapt per element type: logos &amp; text require MS-SSIM ≥ 0.95, edge
                    recall ≥ 0.75; product bodies ≥ 0.85 / 0.60. REPAIR retries with gentler
                    parameters; REGENERATE escalates to AI on the damaged region only.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
