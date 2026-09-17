import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, defaultResolve) {
    if (specifier.startsWith('@/')) {
        const target = path.resolve(process.cwd(), 'src', specifier.slice(2));
        for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
            try {
                return await defaultResolve(pathToFileURL(target + ext).href, context);
            } catch {}
        }
    }
    if (specifier.startsWith('@packages/')) {
        const subpath = specifier.slice(10);
        const [pkg, ...rest] = subpath.split('/');
        const restPath = rest.join('/');
        const candidates = restPath
            ? [
                path.resolve(process.cwd(), 'packages', pkg, 'src', restPath),
                path.resolve(process.cwd(), 'packages', pkg, restPath),
            ]
            : [
                path.resolve(process.cwd(), 'packages', pkg, 'src', 'index'),
                path.resolve(process.cwd(), 'packages', pkg, 'index'),
            ];

        for (const candidate of candidates) {
            for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
                try {
                    return await defaultResolve(pathToFileURL(candidate + ext).href, context);
                } catch {}
            }
        }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.includes('.ts')) {
        try {
            return await defaultResolve(specifier, context);
        } catch {
            const parentDir = path.dirname(fileURLToPath(context.parentURL));
            const target = path.resolve(parentDir, specifier);
            for (const ext of ['.ts', '.tsx', '/index.ts']) {
                try {
                    return await defaultResolve(pathToFileURL(target + ext).href, context);
                } catch {}
            }
        }
    }
    return defaultResolve(specifier, context);
}
