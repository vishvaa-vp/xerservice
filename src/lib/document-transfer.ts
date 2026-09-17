/** Uses the same authenticated Storage endpoint as storage-js, with real transfer events. */
export function transferDocument(options: {
    url: string; key: string; token: string; path: string; file: File;
    signal: AbortSignal; onProgress: (percent: number) => void;
}): Promise<void> {
    return new Promise((resolve, reject) => {
        if (options.signal.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = (error?: Error) => {
            options.signal.removeEventListener('abort', abort);
            if (error) reject(error); else resolve();
        };
        const path = options.path.split('/').map(encodeURIComponent).join('/');
        xhr.open('POST', `${options.url.replace(/\/$/, '')}/storage/v1/object/order-documents/${path}`);
        xhr.setRequestHeader('apikey', options.key);
        xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.timeout = 180_000;
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) options.onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
        };
        xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error(xhr.status === 401 || xhr.status === 403 ? 'Your session expired or this upload is not allowed. Sign in and try again.' : 'The upload could not be saved. Please retry.'));
        xhr.onerror = () => finish(new Error('Connection lost. Reconnect and retry this file.'));
        xhr.ontimeout = () => finish(new Error('The upload timed out. Check your connection and retry.'));
        xhr.onabort = () => finish(new DOMException('Upload cancelled', 'AbortError'));
        options.signal.addEventListener('abort', abort, { once: true });
        const body = new FormData();
        body.append('cacheControl', '3600');
        body.append('', options.file);
        xhr.send(body);
    });
}
