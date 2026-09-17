import { PDFDocument } from 'pdf-lib';
import { getServiceRoleClient } from '../supabase/server';
import type { WhatsAppUploadRecord } from './upload-service';

export const ORDER_DOCUMENTS_BUCKET = 'order-documents';
export const MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB limit (aligned with order-documents bucket)
export const MAX_PDF_PAGE_COUNT = 500; // 500 pages max

export const SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
] as const;

export type SupportedMimeType = typeof SUPPORTED_MIME_TYPES[number];

export function isMediaDownloadEnabled(): boolean {
    const val = process.env.WHATSAPP_MEDIA_DOWNLOAD_ENABLED;
    return val === 'true' || val === '1';
}

export function getGraphApiVersion(): string {
    const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
    return configured && /^v\d+\.\d+$/.test(configured) ? configured : 'v26.0';
}

export function getWhatsAppAccessToken(): string | null {
    return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

function isAllowedMetaMediaUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:') return false;
        const host = url.hostname.toLowerCase();
        return host === 'facebook.com' || host.endsWith('.facebook.com') ||
            host === 'fbcdn.net' || host.endsWith('.fbcdn.net') ||
            host === 'fbsbx.com' || host.endsWith('.fbsbx.com');
    } catch {
        return false;
    }
}

/**
 * Inspect magic bytes of buffer to confirm genuine MIME type.
 * Aligned with XerService security standards.
 */
export function detectMagicMime(buffer: Uint8Array): SupportedMimeType | null {
    if (!buffer || buffer.length < 4) return null;

    // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
    if (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
    ) {
        return 'application/pdf';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    // JPEG: FF D8 FF
    if (
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return 'image/jpeg';
    }

    // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
    if (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
        return 'image/webp';
    }

    return null;
}

/**
 * Sanitize filename to prevent directory traversal and remove dangerous chars.
 * Ensures a valid extension matching the detected MIME type.
 */
export function sanitizeFilename(rawName: string | undefined, mimeType: SupportedMimeType): string {
    let name = (rawName || '').trim();
    // Remove directory traversal characters (Unix and Windows)
    name = name.replace(/^.*[/\\]/, '');
    // Replace non-alphanumeric (except dots, dashes, underscores)
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_');

    const expectedExt =
        mimeType === 'application/pdf' ? '.pdf' :
        mimeType === 'image/png' ? '.png' :
        mimeType === 'image/webp' ? '.webp' : '.jpg';

    if (!name || name === expectedExt) {
        name = `whatsapp_document_${Date.now()}${expectedExt}`;
    } else if (!name.toLowerCase().endsWith(expectedExt)) {
        name = `${name.replace(/\.[^/.]+$/, '')}${expectedExt}`;
    }

    return name;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
    detectedMime?: SupportedMimeType;
    safeFilename?: string;
    pageCount?: number;
    fileSize?: number;
}

/**
 * Validates the media buffer before persistent storage:
 * - Allowed MIME type (magic bytes inspection)
 * - Maximum file size (<= 20 MB)
 * - Safe filename
 * - PDF inspection (password encryption check & page count <= 500)
 */
export async function validateMediaBuffer(
    buffer: Uint8Array,
    declaredFilename?: string
): Promise<ValidationResult> {
    // 1. File size check
    if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
        return {
            valid: false,
            error: `File size (${buffer.length} bytes) exceeds the maximum limit of ${MAX_MEDIA_SIZE_BYTES} bytes (20 MB).`,
            fileSize: buffer.length,
        };
    }

    if (buffer.length === 0) {
        return {
            valid: false,
            error: 'File buffer is empty (0 bytes).',
            fileSize: 0,
        };
    }

    // 2. Magic byte inspection
    const detectedMime = detectMagicMime(buffer);
    if (!detectedMime) {
        return {
            valid: false,
            error: 'File content does not match any supported format (PDF, PNG, JPEG, WebP).',
            fileSize: buffer.length,
        };
    }

    const safeFilename = sanitizeFilename(declaredFilename, detectedMime);

    // 3. Format-specific inspection (PDF)
    let pageCount = 1;
    if (detectedMime === 'application/pdf') {
        try {
            const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
            if (pdfDoc.isEncrypted) {
                return {
                    valid: false,
                    error: 'Encrypted or password-protected PDFs are not supported for print orders.',
                    detectedMime,
                    safeFilename,
                    fileSize: buffer.length,
                };
            }

            pageCount = pdfDoc.getPageCount();
            if (pageCount < 1 || pageCount > MAX_PDF_PAGE_COUNT) {
                return {
                    valid: false,
                    error: `PDF page count (${pageCount}) exceeds the maximum allowed limit of ${MAX_PDF_PAGE_COUNT} pages.`,
                    detectedMime,
                    safeFilename,
                    fileSize: buffer.length,
                };
            }
        } catch (pdfErr) {
            return {
                valid: false,
                error: `Corrupted or unreadable PDF structure: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`,
                detectedMime,
                safeFilename,
                fileSize: buffer.length,
            };
        }
    }

    return {
        valid: true,
        detectedMime,
        safeFilename,
        pageCount,
        fileSize: buffer.length,
    };
}

/**
 * Downloads media from Meta Graph API using the temporary media URL and Bearer token.
 * If WHATSAPP_MEDIA_DOWNLOAD_ENABLED is false, skips real API calls.
 */
export async function downloadMetaMedia(
    mediaId: string,
    options?: {
        fetchFn?: typeof fetch;
        accessToken?: string;
    }
): Promise<{ buffer: Uint8Array; mimeType?: string }> {
    const isEnabled = isMediaDownloadEnabled();
    const token = options?.accessToken || getWhatsAppAccessToken();
    const fetchImpl = options?.fetchFn || fetch;

    if (!isEnabled && !options?.fetchFn) {
        throw new Error(
            '[WhatsApp Media Service] Media downloading is currently disabled (WHATSAPP_MEDIA_DOWNLOAD_ENABLED=false).'
        );
    }

    if (!token) {
        throw new Error(
            '[WhatsApp Media Service] WHATSAPP_ACCESS_TOKEN is not configured.'
        );
    }

    const version = getGraphApiVersion();
    const metaGraphUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`;

    // Step 1: Obtain temporary download URL from Meta
    const metaRes = await fetchImpl(metaGraphUrl, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!metaRes.ok) {
        throw new Error(`Meta Graph API media retrieval failed [HTTP ${metaRes.status}].`);
    }

    const metaData = (await metaRes.json()) as { url?: string; mime_type?: string };
    const downloadUrl = metaData.url;

    if (!downloadUrl) {
        throw new Error('Meta Graph API response did not contain a media URL.');
    }
    if (!options?.fetchFn && !isAllowedMetaMediaUrl(downloadUrl)) {
        throw new Error('Meta Graph API returned an untrusted media URL.');
    }

    // Step 2: Download the binary file using Bearer token
    const dlRes = await fetchImpl(downloadUrl, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'XerService-WhatsApp-Downloader/1.0',
        },
    });

    if (!dlRes.ok) {
        throw new Error(`Meta media file download failed [HTTP ${dlRes.status}] from temporary URL.`);
    }

    const ab = await dlRes.arrayBuffer();
    if (ab.byteLength > MAX_MEDIA_SIZE_BYTES) {
        throw new Error('Meta media file exceeds the 20 MB limit.');
    }
    return {
        buffer: new Uint8Array(ab),
        mimeType: metaData.mime_type,
    };
}

export interface ProcessMediaResult {
    success: boolean;
    status: 'downloaded' | 'failed' | 'pending_download' | 'skipped_unlinked' | 'download_disabled';
    storagePath?: string | null;
    error?: string;
    record?: WhatsAppUploadRecord;
}

/**
 * Main Service Pipeline:
 * Processes an existing whatsapp_uploads record, downloads/acquires media,
 * validates content (MIME, size, filename), uploads to private Supabase
 * 'order-documents' bucket at users/<user_id>/whatsapp/<upload_id>-<filename>,
 * and updates whatsapp_uploads status (received -> pending_download -> downloaded / failed).
 *
 * Rule: If user_id is NULL, do NOT put the file inside another user's folder. Leave waiting for linking.
 */
export async function processAndStoreWhatsAppUpload(
    uploadId: string,
    options?: {
        directBuffer?: Uint8Array;
        customFetch?: typeof fetch;
    }
): Promise<ProcessMediaResult> {
    const sb = getServiceRoleClient();

    // 1. Fetch current upload record
    const { data: upload, error: fetchErr } = await sb
        .from('whatsapp_uploads')
        .select('*')
        .eq('id', uploadId)
        .maybeSingle();

    if (fetchErr || !upload) {
        return {
            success: false,
            status: 'failed',
            error: `Upload record not found for ID: ${uploadId}`,
        };
    }

    // 2. User Isolation Rule: If user_id is NULL, do NOT put the file inside another user's folder.
    // Leave it waiting for account linking.
    if (!upload.user_id) {
        return {
            success: false,
            status: 'skipped_unlinked',
            error: 'Unlinked sender: user_id is null. Awaiting customer account linking.',
            record: upload as WhatsAppUploadRecord,
        };
    }

    const userId = upload.user_id;

    // 3. Mark status as pending_download
    await sb
        .from('whatsapp_uploads')
        .update({
            status: 'pending_download',
            updated_at: new Date().toISOString(),
        })
        .eq('id', uploadId);

    // 4. Acquire file buffer
    let fileBuffer: Uint8Array;
    try {
        if (options?.directBuffer) {
            // Direct buffer provided (e.g., local mock or testing)
            fileBuffer = options.directBuffer;
        } else {
            // Check feature flag before attempting real Meta download
            if (!isMediaDownloadEnabled()) {
                await sb
                    .from('whatsapp_uploads')
                    .update({
                        status: 'received',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', uploadId);

                return {
                    success: false,
                    status: 'download_disabled',
                    error: 'WHATSAPP_MEDIA_DOWNLOAD_ENABLED is false. Real Meta download skipped.',
                    record: upload as WhatsAppUploadRecord,
                };
            }

            const downloaded = await downloadMetaMedia(upload.media_id, {
                fetchFn: options?.customFetch,
            });
            fileBuffer = downloaded.buffer;
        }
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[WhatsApp Media Service] Media download failed.');

        await sb
            .from('whatsapp_uploads')
            .update({
                status: 'failed',
                updated_at: new Date().toISOString(),
            })
            .eq('id', uploadId);

        return {
            success: false,
            status: 'failed',
            error: errorMsg,
        };
    }

    // 5. Validate file before storage
    const validation = await validateMediaBuffer(fileBuffer, upload.filename);
    if (!validation.valid || !validation.detectedMime || !validation.safeFilename) {
        console.warn('[WhatsApp Media Service] File validation failed.');

        await sb
            .from('whatsapp_uploads')
            .update({
                status: 'failed',
                updated_at: new Date().toISOString(),
            })
            .eq('id', uploadId);

        return {
            success: false,
            status: 'failed',
            error: validation.error || 'Validation failed',
        };
    }

    // 6. Upload to private Supabase order-documents bucket
    // Path structure: users/<user_id>/whatsapp/<upload_id>-<safe_filename>
    const storagePath = `users/${userId}/whatsapp/${upload.id}-${validation.safeFilename}`;

    const { error: storageError } = await sb.storage
        .from(ORDER_DOCUMENTS_BUCKET)
        .upload(storagePath, fileBuffer, {
            contentType: validation.detectedMime,
            upsert: true,
        });

    if (storageError) {
        console.error('[WhatsApp Media Service] Storage upload failed.');

        await sb
            .from('whatsapp_uploads')
            .update({
                status: 'failed',
                updated_at: new Date().toISOString(),
            })
            .eq('id', uploadId);

        return {
            success: false,
            status: 'failed',
            error: `Storage upload failed: ${storageError.message}`,
        };
    }

    // 7. Update whatsapp_uploads record with downloaded status and storage_path
    const { data: updatedRecord, error: updateErr } = await sb
        .from('whatsapp_uploads')
        .update({
            status: 'downloaded',
            storage_path: storagePath,
            filename: validation.safeFilename,
            mime_type: validation.detectedMime,
            updated_at: new Date().toISOString(),
        })
        .eq('id', uploadId)
        .select('*')
        .single();

    if (updateErr || !updatedRecord) {
        console.error(`[WhatsApp Media Service] Failed to update upload status to downloaded:`, updateErr);
        return {
            success: false,
            status: 'failed',
            error: updateErr?.message,
        };
    }

    return {
        success: true,
        status: 'downloaded',
        storagePath,
        record: updatedRecord as WhatsAppUploadRecord,
    };
}
