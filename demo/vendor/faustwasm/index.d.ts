export function instantiateFaustModuleFromFile(
  jsUrl: string,
  dataUrl: string,
  wasmUrl: string,
): Promise<any>;
export class LibFaust {
  constructor(module: any);
  version(): string;
}
export class FaustCompiler {
  constructor(libFaust: LibFaust);
}
export class FaustMonoDspGenerator {
  compile(compiler: FaustCompiler, name: string, code: string, args: string): Promise<FaustMonoDspGenerator | null>;
  createNode(context: BaseAudioContext, name?: string): Promise<AudioWorkletNode | null>;
  getUI(): any[];
  getMeta(): any;
  getJSON(): string;
}
export class FaustPolyDspGenerator {
  compile(compiler: FaustCompiler, name: string, code: string, args: string): Promise<FaustPolyDspGenerator | null>;
  createNode(context: BaseAudioContext, voices: number, name?: string): Promise<AudioWorkletNode | null>;
  getUI(): any[];
}
