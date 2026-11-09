/**************************** faust-editor.ts ****************************
 *
 * Purpose: Faust code editor with CodeMirror 6, compilation, and live-coding.
 * How: Provide a single openEditor() entry point that both FxChainPanel and
 *      TransformPanel call. Manage CodeMirror instance, compile/revert/close
 *      actions, auto-compile with debounce, and immutable FxResource creation.
 *
 *****************************************************************************/
import type { Elements } from "../bind-elements.js";
import type { FxEffect, FxParam } from "../../src/domain/fx-chain.js";
import { importFxResource } from "../../src/fx-chain.js";
import { demoState } from "../state.js";
import {
  compileFxEffect,
  destroyEffectRuntime,
  registerEffectRuntime,
  getEffectRuntime,
} from "../fx-chain/fx-chain-runtime.js";
import {
  captureEffectParameters,
  restoreEffectParameters,
} from "../fx-chain/fx-chain-audio.js";
import { getEffectName, buildFxResourceName, extractDeclareName } from "../fx-chain/faust-resource.js";
import { pushRenderLog, render } from "../daw-render/daw-render-runtime.js";
import { persistCurrentSessionDocument } from "../session-history.js";
import { recordFaustFxOp } from "../faust-fx-undo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaustEditorContext = {
  /** Called after successful recompilation to rewire the audio graph. */
  rewireTrackAudio: (trackId: string) => void;
  /** Refresh the FX panel list or Transform panel list after recompilation. */
  refreshPanel: () => void;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cmView: any = null;
let cmModule: any = null;
let currentEffectId: string | null = null;
let currentTrackId: string | null = null;
let currentCtx: FaustEditorContext | null = null;
let currentElements: Elements | null = null;
let autoCompileTimeout: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// CodeMirror lazy loader
// ---------------------------------------------------------------------------

async function loadCodeMirror(): Promise<any> {
  if (cmModule) return cmModule;
  const url = new URL("./vendor/codemirror/codemirror.js", document.baseURI).href;
  cmModule = await import(/* @vite-ignore */ url);
  return cmModule;
}

// ---------------------------------------------------------------------------
// Faust syntax highlighting (simple StreamLanguage mode)
// ---------------------------------------------------------------------------

function createFaustLanguage(cm: any): any {
  const keywords = new Set([
    "import", "process", "with", "environment", "library", "declare",
    "component", "ffunction", "fvariable", "fconstant", "route",
    "waveform", "soundfile", "inputs", "outputs", "int", "float",
    "case", "seq", "par", "sum", "prod", "rec", "rdtable", "rwtable",
    "select2", "select3", "prefix", "letrec", "where", "effect",
  ]);
  return cm.StreamLanguage.define({
    startState() {
      return { inBlockComment: false };
    },
    token(stream: any, state: any) {
      if (state.inBlockComment) {
        if (stream.match(/.*?\*\//)) {
          state.inBlockComment = false;
        } else {
          stream.skipToEnd();
        }
        return "comment";
      }
      if (stream.match("/*")) {
        state.inBlockComment = true;
        return "comment";
      }
      if (stream.match(/\/\/.*/)) {
        return "comment";
      }
      if (stream.match(/"(?:[^"\\]|\\.)*"/)) {
        return "string";
      }
      if (stream.match(/'(?:[^'\\]|\\.)*'/)) {
        return "string";
      }
      if (stream.match(/\d+\.?\d*(?:e[+-]?\d+)?/i)) {
        return "number";
      }
      if (stream.match(/\.\d+(?:e[+-]?\d+)?/i)) {
        return "number";
      }
      if (stream.match(/[a-zA-Z_]\w*/)) {
        const word = stream.current();
        if (keywords.has(word)) return "keyword";
        return "variableName";
      }
      if (stream.match(/[+\-*\/\\%@!<>=&|^~,:;?#]+/)) {
        return "operator";
      }
      stream.next();
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Create or replace CodeMirror editor
// ---------------------------------------------------------------------------

async function initCodeMirror(container: HTMLElement, code: string): Promise<void> {
  const cm = await loadCodeMirror();

  // Destroy previous instance
  if (cmView) {
    cmView.destroy();
    cmView = null;
  }
  container.innerHTML = "";

  const faustLang = createFaustLanguage(cm);
  const darkTheme = cm.EditorView.theme({
    "&": {
      backgroundColor: "rgba(10, 18, 28, 0.95)",
      color: "#c8dcf0",
      fontSize: "13px",
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    },
    ".cm-gutters": {
      backgroundColor: "rgba(10, 18, 28, 0.95)",
      color: "rgba(142, 161, 191, 0.4)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(145, 178, 215, 0.06)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(145, 178, 215, 0.06)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(130, 100, 220, 0.3) !important",
    },
    ".cm-cursor": {
      borderLeftColor: "#c8dcf0",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(145, 178, 215, 0.2)",
      outline: "1px solid rgba(145, 178, 215, 0.4)",
    },
  }, { dark: true });

  const highlightStyle = cm.syntaxHighlighting(cm.defaultHighlightStyle);

  cmView = new cm.EditorView({
    doc: code,
    extensions: [
      cm.lineNumbers(),
      cm.highlightActiveLine(),
      cm.highlightSpecialChars(),
      cm.drawSelection(),
      cm.indentOnInput(),
      cm.bracketMatching(),
      cm.closeBrackets(),
      cm.history(),
      cm.highlightSelectionMatches(),
      cm.keymap.of([
        ...cm.closeBracketsKeymap,
        ...cm.defaultKeymap,
        ...cm.searchKeymap,
        ...cm.historyKeymap,
        cm.indentWithTab,
      ]),
      darkTheme,
      highlightStyle,
      new cm.LanguageSupport(faustLang),
      cm.EditorView.updateListener.of((update: any) => {
        if (update.docChanged && currentElements) {
          onDocChanged();
        }
      }),
    ],
    parent: container,
  });
}

// ---------------------------------------------------------------------------
// Auto-compile debounce
// ---------------------------------------------------------------------------

function onDocChanged(): void {
  if (!currentElements) return;
  if (currentElements.faustEditorAutoCompile.checked) {
    if (autoCompileTimeout !== null) {
      clearTimeout(autoCompileTimeout);
    }
    autoCompileTimeout = setTimeout(() => {
      autoCompileTimeout = null;
      void doCompile();
    }, 500);
  }
}

// ---------------------------------------------------------------------------
// Find the effect in track effects or transform chain
// ---------------------------------------------------------------------------

type EffectLocation =
  | { source: "track"; trackId: string; effect: FxEffect }
  | { source: "transform"; index: number; effect: FxEffect };

function findEffect(effectId: string): EffectLocation | null {
  // Search in track effects
  for (const track of demoState.project.timeline.tracks) {
    const chain = demoState.project.chains.get(track.chainId);
    const effect = chain?.effects.find((e) => e.id === effectId);
    if (effect) {
      return { source: "track", trackId: track.id, effect };
    }
  }
  // Search in transform chain
  const idx = demoState.transformChain.findIndex((e) => e.id === effectId);
  if (idx >= 0) {
    return { source: "transform", index: idx, effect: demoState.transformChain[idx]! };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

async function doCompile(): Promise<void> {
  if (!currentEffectId || !currentCtx || !currentElements) return;
  const elements = currentElements;
  const ctx = currentCtx;

  const location = findEffect(currentEffectId);
  if (!location) {
    showError("Effect no longer exists");
    return;
  }
  const effect = location.effect;
  const code = cmView?.state?.doc?.toString() ?? "";
  if (!code.trim()) {
    showError("Code is empty");
    return;
  }

  const audioContext = demoState.audio.ensureContext();
  if (!audioContext) {
    showError("AudioContext not available");
    return;
  }

  const effectName = getEffectName(effect);
  const codeStateBefore = { fxResourceId: effect.fxResourceId, parameters: [...effect.parameters] };
  demoState.footer.setStatus(`Compiling "${effectName}"…`);

  try {
    // 1. Create new FxResource (immutable — never modify existing)
    const newResourceId = `fxr-${crypto.randomUUID()}`;
    const oldResource = demoState.project.fxResources.get(effect.fxResourceId);
    // Use declare name if present, otherwise strip old hash suffix to get base name
    const declaredName = extractDeclareName(code);
    const oldName = oldResource?.name ?? effectName;
    const baseName = declaredName ?? oldName.replace(/-[0-9a-f]{6}$/, "");
    const resourceName = buildFxResourceName(baseName, code);
    demoState.project = importFxResource(demoState.project, {
      id: newResourceId,
      name: resourceName,
      code,
    });

    // 2. Compile new code under a temporary ID (old runtime stays active)
    const tempId = `__compile_${crypto.randomUUID()}`;
    const trackId = location.source === "track" ? location.trackId : "__transform__";
    const runtime = await compileFxEffect(
      tempId as any,
      resourceName,
      code,
      audioContext,
    );

    // 3. Swap: destroy old runtime, register new one under the real ID
    destroyEffectRuntime(currentEffectId);
    destroyEffectRuntime(tempId as any);
    registerEffectRuntime(currentEffectId as any, runtime);

    // 4. Update effect to point to new resource
    if (location.source === "track") {
      const track = demoState.project.timeline.tracks.find((t) => t.id === location.trackId);
      const chain = track ? demoState.project.chains.get(track.chainId) : undefined;
      if (track && chain) {
        const nextEffects = chain.effects.map((e) =>
          e.id === currentEffectId ? { ...e, fxResourceId: newResourceId } : e,
        );
        const nextChains = new Map(demoState.project.chains);
        nextChains.set(chain.id, { ...chain, effects: nextEffects });
        demoState.project = { ...demoState.project, chains: nextChains };
      }
    } else {
      demoState.transformChain = demoState.transformChain.map((e) =>
        e.id === currentEffectId ? { ...e, fxResourceId: newResourceId } : e,
      );
    }

    // 5. Restore compatible parameters
    if (runtime.node) {
      const newDescriptors = captureEffectParameters(runtime.node);
      const savedValues = new Map(effect.parameters.map((p) => [p.address, p.value]));
      const mergedParams: FxParam[] = newDescriptors.map((p) => {
        const saved = savedValues.get(p.address);
        return saved !== undefined ? { ...p, value: saved } : p;
      });
      // Apply restored values to the node
      restoreEffectParameters(runtime.node, mergedParams);

      // Update domain model
      if (location.source === "track") {
        const track = demoState.project.timeline.tracks.find((t) => t.id === location.trackId);
        const chain = track ? demoState.project.chains.get(track.chainId) : undefined;
        if (track && chain) {
          const nextEffects = chain.effects.map((e) =>
            e.id === currentEffectId ? { ...e, parameters: mergedParams } : e,
          );
          const nextChains = new Map(demoState.project.chains);
          nextChains.set(chain.id, { ...chain, effects: nextEffects });
          demoState.project = { ...demoState.project, chains: nextChains };
        }
      } else {
        demoState.transformChain = demoState.transformChain.map((e) =>
          e.id === currentEffectId ? { ...e, parameters: mergedParams } : e,
        );
      }

      // Update channel label
      const node = runtime.node as any;
      if (typeof node.getNumInputs === "function") {
        elements.faustEditorChannels.textContent =
          `${node.getNumInputs()}→${node.getNumOutputs()}`;
      }
    }

    // 6. Rewire audio and refresh panel
    ctx.rewireTrackAudio(trackId);
    ctx.refreshPanel();

    // 7. Undo/redo: a compile is an op of the effect's own scope (level 2,
    //    UNDOREDOSPEC-WEBDAW "Save / compile du code: 2a → 2"), undone with the
    //    focus on the effect, never by a project-level undo.
    const effectAfter = findEffect(currentEffectId)?.effect;
    recordFaustFxOp(
      { kind: "faustFx", effectId: currentEffectId },
      {
        kind: "code",
        before: codeStateBefore,
        after: { fxResourceId: newResourceId, parameters: [...(effectAfter?.parameters ?? effect.parameters)] },
      },
    );
    persistCurrentSessionDocument(elements);
    pushRenderLog(`Edit "${resourceName}" code`);

    // 8. Clear error, show success
    hideError();
    demoState.footer.setStatus(`"${resourceName}" compiled successfully`);
    render(elements);
  } catch (error) {
    // Compilation failed — show error, keep old code in project
    const message = error instanceof Error ? error.message : String(error);
    showError(message);
    demoState.footer.setStatus(`Compilation failed`, "error");
    pushRenderLog(`ERROR: ${message}`);
    render(elements);
  }
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function showError(message: string): void {
  if (!currentElements) return;
  currentElements.faustEditorError.textContent = message;
  currentElements.faustEditorError.hidden = false;
}

function hideError(): void {
  if (!currentElements) return;
  currentElements.faustEditorError.textContent = "";
  currentElements.faustEditorError.hidden = true;
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

function doRevert(): void {
  if (!currentEffectId || !cmView) return;
  const location = findEffect(currentEffectId);
  if (!location) return;
  const code = demoState.project.fxResources.get(location.effect.fxResourceId)?.code ?? "";
  cmView.dispatch({
    changes: { from: 0, to: cmView.state.doc.length, insert: code },
  });
  hideError();
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

function closeEditor(): void {
  if (autoCompileTimeout !== null) {
    clearTimeout(autoCompileTimeout);
    autoCompileTimeout = null;
  }
  if (currentElements) {
    currentElements.faustEditor.hidden = true;
  }
  currentEffectId = null;
  currentTrackId = null;
  currentCtx = null;
  currentElements = null;
}

export async function openEditor(
  effectId: string,
  trackId: string,
  elements: Elements,
  ctx: FaustEditorContext,
): Promise<void> {
  // Close previous if different
  if (currentEffectId && currentEffectId !== effectId) {
    closeEditor();
  }

  currentEffectId = effectId;
  currentTrackId = trackId;
  currentCtx = ctx;
  currentElements = elements;

  const location = findEffect(effectId);
  if (!location) return;

  const effect = location.effect;
  const effectName = getEffectName(effect);
  const code = demoState.project.fxResources.get(effect.fxResourceId)?.code ?? "";

  // Update header
  elements.faustEditorTitle.textContent = effectName;
  const runtime = getEffectRuntime(effectId);
  if (runtime?.node) {
    const node = runtime.node as any;
    if (typeof node.getNumInputs === "function") {
      elements.faustEditorChannels.textContent =
        `${node.getNumInputs()}→${node.getNumOutputs()}`;
    }
  } else {
    elements.faustEditorChannels.textContent = "";
  }

  // Show modal
  elements.faustEditor.hidden = false;
  hideError();

  // Init CodeMirror
  await initCodeMirror(elements.faustEditorCodeMirror, code);
}

// ---------------------------------------------------------------------------
// Wire events (called once from main)
// ---------------------------------------------------------------------------

export function wireFaustEditor(elements: Elements): void {
  // Close buttons
  elements.faustEditorClose.addEventListener("click", closeEditor);
  elements.faustEditorCloseBtn.addEventListener("click", closeEditor);

  // Compile button
  elements.faustEditorCompile.addEventListener("click", () => {
    void doCompile();
  });

  // Revert button
  elements.faustEditorRevert.addEventListener("click", doRevert);

  // Ctrl+Enter / Cmd+Enter to compile
  elements.faustEditorCodeMirror.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void doCompile();
    }
  });

  // Draggable header
  const content = elements.faustEditor.querySelector(".faust-editor-content") as HTMLElement;
  const header = elements.faustEditor.querySelector(".faust-editor-header") as HTMLElement;
  {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      const rect = content.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      content.style.position = "fixed";
      content.style.left = `${e.clientX - offsetX}px`;
      content.style.top = `${e.clientY - offsetY}px`;
      content.style.margin = "0";
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }
}
