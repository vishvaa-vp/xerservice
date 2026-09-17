import fs from 'node:fs/promises';
import ts from 'typescript';
export { resolve } from './alias-loader.mjs';
export async function load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
        const source = await fs.readFile(new URL(url), 'utf8');
        return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    return nextLoad(url, context);
}
