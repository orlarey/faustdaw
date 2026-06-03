/**************************** faust-compiler.ts ******************************
 *
 * Purpose: Manage the Faust WASM compiler lifecycle and serialize compilation.
 * How: Lazily load faustwasm on first use, cache the compiler instance, and
 *      expose queueFaustCompilation() so callers can run compilation work
 *      one-at-a-time — the WASM compiler is single-threaded.
 *
 *****************************************************************************/

type FaustWasmModule = {
  FaustCompiler: any;
  LibFaust: any;
  FaustMonoDspGenerator: any;
  instantiateFaustModuleFromFile: (jsUrl: string, dataUrl: string, wasmUrl: string) => Promise<any>;
};

let faustWasmModule: FaustWasmModule | null = null;
let faustCompiler: any | null = null;
let compilerLoadingPromise: Promise<void> | null = null;
let compilationQueue: Promise<void> = Promise.resolve();

/**
 * Purpose: Ensure the Faust compiler is loaded and ready.
 * How: Dynamically import faustwasm and instantiate the compiler from the
 *      three libfaust-wasm static files. Subsequent calls return immediately.
 */
export async function ensureFaustCompiler(): Promise<void> {
  if (faustCompiler) {
    return;
  }
  if (compilerLoadingPromise) {
    return compilerLoadingPromise;
  }
  compilerLoadingPromise = (async () => {
    try {
      console.log("[faust] Loading faustwasm module…");
      const faustwsamUrl = new URL("/demo/vendor/faustwasm/index.js", window.location.origin).href;
      const mod: FaustWasmModule = await import(/* @vite-ignore */ faustwsamUrl);
      faustWasmModule = mod;
      console.log("[faust] faustwasm module loaded, instantiating compiler…");

      const base = `${window.location.origin}/demo/libfaust-wasm/libfaust-wasm.js`;
      const faustModule = await mod.instantiateFaustModuleFromFile(
        base,
        base.replace(/\.js$/, ".data"),
        base.replace(/\.js$/, ".wasm"),
      );
      console.log("[faust] libfaust-wasm instantiated");
      const libFaust = new mod.LibFaust(faustModule);
      faustCompiler = new mod.FaustCompiler(libFaust);
      console.log("[faust] Compiler ready, version:", libFaust.version());
    } catch (error) {
      compilerLoadingPromise = null;
      throw error;
    }
  })();
  return compilerLoadingPromise;
}

export type FaustCompilationContext = {
  compiler: any;
  createGenerator: () => any;
};

/**
 * Purpose: Run compilation work serialized behind any in-flight compilation.
 * How: Chain `work` after the current compilationQueue, passing a ready
 *      compiler and a mono-DSP generator factory. The queue is advanced
 *      even on failure so a single error does not stall future compilations;
 *      the caller still sees the error via the returned promise.
 */
export async function queueFaustCompilation<T>(
  work: (ctx: FaustCompilationContext) => Promise<T>,
): Promise<T> {
  const result = compilationQueue.then(async () => {
    await ensureFaustCompiler();
    if (!faustWasmModule || !faustCompiler) {
      throw new Error("Faust compiler not available");
    }
    const mod = faustWasmModule;
    return work({
      compiler: faustCompiler,
      createGenerator: () => new mod.FaustMonoDspGenerator(),
    });
  });
  compilationQueue = result.then(() => {}, () => {});
  return result;
}
