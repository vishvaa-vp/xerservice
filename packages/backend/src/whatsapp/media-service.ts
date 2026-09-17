/**
 * XerService Backend — Stage A13: WhatsApp Media Ingestion & Validation Service
 *
 * Implements:
 * - Meta media payload parsing & validation
 * - Sender active link verification (unlinked rejection)
 * - Size limit (<= 20 MB) & page limit (<= 500 pages) enforcement
 * - Magic byte inspection (PDF, PNG, JPEG, WebP)
 * - PDF parsing via pdf-lib (encrypted check, page count extraction)
 * - Private owner-scoped storage in order-documents bucket
 * - Persistence in whatsapp_imported_files with quarantine lifecycle
 * - Customer listing, cart import, and deletion operations
 */

import { PDFDocument } from 'pdf-lib';
import crypto from 'crypto';
import { getServiceRoleClient } from '../supabase/client';
import type { WhatsAppImportedFileRow } from './types';

export const MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB limit
export const MAX_PDF_PAGE_COUNT = 500; // 500 pages max

export const SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
] as const;

export type SupportedMimeType = typeof SUPPORTED_MIME_TYPES[number];

export interface IngestMediaInput {
    senderPhone: string;
    messageId: string;
    media: {
        id: string;
        mime_type: string;
        filename?: string;
        file_size?: number;
        sha256?: string;
    };
    directBuffer?: Buffer | Uint8Array;
    mediaUrl?: string;
}

export interface IngestMediaResult {
    success: boolean;
    status: 'valid' | 'rejected' | 'ignored' | 'duplicate';
    reason?: string;
    fileId?: string;
    file?: WhatsAppImportedFileRow;
    userId?: string;
}

function getGraphApiVersion(): string {
    const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
    return configured && /^v\d+\.\d+$/.test(configured) ? configured : 'v26.0';
}

function mediaDownloadEnabled(): boolean {
    return process.env.WHATSAPP_MEDIA_DOWNLOAD_ENABLED === 'true';
}

function isAllowedMetaMediaUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:') return false;
        const host = url.hostname.toLowerCase();
        return host === 'facebook.com' ||
            host.endsWith('.facebook.com') ||
            host === 'fbcdn.net' ||
            host.endsWith('.fbcdn.net') ||
            host === 'fbsbx.com' ||
            host.endsWith('.fbsbx.com');
    } catch {
        return false;
    }
}

async function downloadMetaMedia(rawUrl: string, accessToken: string): Promise<Uint8Array> {
    if (!isAllowedMetaMediaUrl(rawUrl)) {
        throw new Error('Provider returned an untrusted media URL.');
    }

    let currentUrl = rawUrl;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const response = await fetch(currentUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) throw new Error('Provider media redirect was invalid.');
            const nextUrl = new URL(location, currentUrl).toString();
            if (!isAllowedMetaMediaUrl(nextUrl)) {
                throw new Error('Provider media redirect was not trusted.');
            }
            currentUrl = nextUrl;
            continue;
        }

        if (!response.ok || !response.body) {
            throw new Error(`Provider media download failed (${response.status}).`);
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > MAX_MEDIA_SIZE_BYTES) {
            throw new Error('Provider media exceeds the maximum file size.');
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_MEDIA_SIZE_BYTES) {
                await reader.cancel();
                throw new Error('Provider media exceeds the maximum file size.');
            }
            chunks.push(value);
        }

        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    }

    throw new Error('Provider media exceeded the redirect limit.');
}

/**
 * Inspect magic bytes of buffer to confirm genuine MIME type.
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
 * Sanitize filename to prevent directory traversal and remove unsafe chars.
 */
export function sanitizeFilename(rawName: string | undefined, mimeType: SupportedMimeType): string {
    let name = (rawName || '').trim();
    // Remove any path traversal
    name = name.replace(/^.*[/\\]/, '');
    // Replace non-alphanumeric except dots, dashes, underscores
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_');

    if (!name) {
        const defaultExt =
            mimeType === 'application/pdf' ? 'pdf' :
            mimeType === 'image/png' ? 'png' :
            mimeType === 'image/webp' ? 'webp' : 'jpg';
        name = `whatsapp_document_${Date.now()}.${defaultExt}`;
    }

    return name;
}

/**
 * Core Media Ingestion Pipeline
 */
export async function validateAndIngestMedia(
    input: IngestMediaInput
): Promise<IngestMediaResult> {
    const sb = getServiceRoleClient();
    const cleanPhone = input.senderPhone.replace(/\D/g, '');

    // 1. Verify sender is actively linked in whatsapp_links
    const { data: link, error: linkErr } = await sb
        .from('whatsapp_links')
        .select('id, user_id, status')
        .eq('sender_id', cleanPhone)
        .eq('status', 'active')
        .maybeSingle();

    if (linkErr || !link || !link.user_id) {
        return {
            success: false,
            status: 'ignored',
            reason: 'unlinked_sender',
        };
    }

    const userId = link.user_id;

    // 2. Deduplication check: check if this messageId was already processed
    const { data: existingFile } = await sb
        .from('whatsapp_imported_files')
        .select('*')
        .eq('source_message_id', input.messageId)
        .maybeSingle();

    if (existingFile) {
        return {
            success: existingFile.validation_status === 'valid',
            status: 'duplicate',
            reason: 'already_ingested',
            fileId: existingFile.id,
            file: existingFile as WhatsAppImportedFileRow,
            userId,
        };
    }

    if (input.media.file_size && input.media.file_size > MAX_MEDIA_SIZE_BYTES) {
        return {
            success: false,
            status: 'rejected',
            reason: 'File exceeds the maximum size of 20 MB.',
            userId,
        };
    }

    // 3. Acquire buffer. Direct buffers are used by trusted internal callers and tests.
    let fileBytes: Uint8Array;
    if (input.directBuffer) {
        fileBytes = new Uint8Array(input.directBuffer);
    } else if (input.mediaUrl) {
        try {
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            if (!mediaDownloadEnabled() || !token) {
                throw new Error('WhatsApp media download is disabled.');
            }
            fileBytes = await downloadMetaMedia(input.mediaUrl, token);
        } catch {
            return {
                success: false,
                status: 'rejected',
                reason: 'WhatsApp media could not be downloaded securely.',
                userId,
            };
        }
    } else if (mediaDownloadEnabled() && process.env.WHATSAPP_ACCESS_TOKEN && input.media.id) {
        try {
            // Live Meta Cloud API download
            const metaRes = await fetch(`https://graph.facebook.com/${getGraphApiVersion()}/${encodeURIComponent(input.media.id)}`, {
                headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
                redirect: 'error',
                signal: AbortSignal.timeout(10_000),
            });
            if (!metaRes.ok) throw new Error(`Meta API error ${metaRes.status}`);
            const metaData = await metaRes.json();
            const downloadUrl = metaData.url;
            if (!downloadUrl) throw new Error('Meta did not return media URL');
            fileBytes = await downloadMetaMedia(downloadUrl, process.env.WHATSAPP_ACCESS_TOKEN);
        } catch {
            return {
                success: false,
                status: 'rejected',
                reason: 'WhatsApp media could not be retrieved securely.',
                userId,
            };
        }
    } else {
        return {
            success: false,
            status: 'rejected',
            reason: 'No media buffer or download source provided.',
            userId,
        };
    }

    const fileId = crypto.randomUUID();
    const declaredMime = input.media.mime_type || 'application/octet-stream';

    // 4. File size check (<= 20 MB)
    if (fileBytes.length > MAX_MEDIA_SIZE_BYTES) {
        // Record quarantine rejected
        await sb.from('whatsapp_imported_files').insert({
            id: fileId,
            user_id: userId,
            source_message_id: input.messageId,
            media_id: input.media.id,
            original_filename: input.media.filename || 'oversize_file',
            storage_path: '',
            mime_type: declaredMime,
            file_size: fileBytes.length,
            page_count: null,
            validation_status: 'rejected',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        return {
            success: false,
            status: 'rejected',
            reason: `File size ${fileBytes.length} exceeds max limit of ${MAX_MEDIA_SIZE_BYTES} bytes.`,
            fileId,
            userId,
        };
    }

    // 5. Magic byte & MIME type check
    const detectedMime = detectMagicMime(fileBytes);
    if (!detectedMime) {
        await sb.from('whatsapp_imported_files').insert({
            id: fileId,
            user_id: userId,
            source_message_id: input.messageId,
            media_id: input.media.id,
            original_filename: input.media.filename || 'invalid_file',
            storage_path: '',
            mime_type: declaredMime,
            file_size: fileBytes.length,
            page_count: null,
            validation_status: 'rejected',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        return {
            success: false,
            status: 'rejected',
            reason: 'File content does not match any supported format (PDF, PNG, JPEG, WebP).',
            fileId,
            userId,
        };
    }

    // 6. Detailed format inspection (PDF pages, encryption, etc.)
    let pageCount: number = 1;
    if (detectedMime === 'application/pdf') {
        try {
            const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
            if (pdfDoc.isEncrypted) {
                await sb.from('whatsapp_imported_files').insert({
                    id: fileId,
                    user_id: userId,
                    source_message_id: input.messageId,
                    media_id: input.media.id,
                    original_filename: input.media.filename || 'encrypted.pdf',
                    storage_path: '',
                    mime_type: detectedMime,
                    file_size: fileBytes.length,
                    page_count: null,
                    validation_status: 'rejected',
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                });
                return {
                    success: false,
                    status: 'rejected',
                    reason: 'Encrypted or password-protected PDFs are not supported for print orders.',
                    fileId,
                    userId,
                };
            }

            pageCount = pdfDoc.getPageCount();
            if (pageCount < 1 || pageCount > MAX_PDF_PAGE_COUNT) {
                await sb.from('whatsapp_imported_files').insert({
                    id: fileId,
                    user_id: userId,
                    source_message_id: input.messageId,
                    media_id: input.media.id,
                    original_filename: input.media.filename || 'oversize_pages.pdf',
                    storage_path: '',
                    mime_type: detectedMime,
                    file_size: fileBytes.length,
                    page_count: pageCount,
                    validation_status: 'rejected',
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                });
                return {
                    success: false,
                    status: 'rejected',
                    reason: `PDF page count (${pageCount}) exceeds maximum allowed of ${MAX_PDF_PAGE_COUNT} pages.`,
                    fileId,
                    userId,
                };
            }
        } catch (pdfErr) {
            await sb.from('whatsapp_imported_files').insert({
                id: fileId,
                user_id: userId,
                source_message_id: input.messageId,
                media_id: input.media.id,
                original_filename: input.media.filename || 'corrupted.pdf',
                storage_path: '',
                mime_type: detectedMime,
                file_size: fileBytes.length,
                page_count: null,
                validation_status: 'rejected',
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            });
            return {
                success: false,
                status: 'rejected',
                reason: `Corrupted PDF structure: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`,
                fileId,
                userId,
            };
        }
    } else {
        // Image formats (PNG, JPEG, WebP) count as 1 page
        pageCount = 1;
    }

    // 7. Store file in Supabase private storage (order-documents)
    const safeFilename = sanitizeFilename(input.media.filename, detectedMime);
    const storagePath = `users/${userId}/whatsapp-imports/${fileId}/${safeFilename}`;

    const { error: storageError } = await sb.storage
        .from('order-documents')
        .upload(storagePath, fileBytes, {
            contentType: detectedMime,
            upsert: true,
        });

    if (storageError) {
        console.error('[validateAndIngestMedia] Storage upload failed:', storageError);
    }

    // 8. Persist valid imported file record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: insertedFile, error: insertErr } = await sb
        .from('whatsapp_imported_files')
        .insert({
            id: fileId,
            user_id: userId,
            source_message_id: input.messageId,
            media_id: input.media.id,
            original_filename: safeFilename,
            storage_path: storagePath,
            mime_type: detectedMime,
            file_size: fileBytes.length,
            page_count: pageCount,
            validation_status: 'valid',
            expires_at: expiresAt,
        })
        .select('*')
        .single();

    if (insertErr || !insertedFile) {
        return {
            success: false,
            status: 'rejected',
            reason: `Database insert failed: ${insertErr?.message || 'Unknown error'}`,
            fileId,
            userId,
        };
    }

    return {
        success: true,
        status: 'valid',
        fileId: insertedFile.id,
        file: insertedFile as WhatsAppImportedFileRow,
        userId,
    };
}

/**
 * List active, valid imported files for a user.
 */
export async function listCustomerWhatsAppFiles(userId: string): Promise<WhatsAppImportedFileRow[]> {
    const sb = getServiceRoleClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await sb
        .from('whatsapp_imported_files')
        .select('*')
        .eq('user_id', userId)
        .eq('validation_status', 'valid')
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[listCustomerWhatsAppFiles] Error:', error);
        return [];
    }

    return (data || []) as WhatsAppImportedFileRow[];
}

/**
 * Delete a user's imported WhatsApp file.
 */
export async function deleteCustomerWhatsAppFile(userId: string, fileId: string): Promise<boolean> {
    const sb = getServiceRoleClient();

    const { data: file } = await sb
        .from('whatsapp_imported_files')
        .select('id, storage_path')
        .eq('id', fileId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!file) return false;

    if (file.storage_path) {
        await sb.storage.from('order-documents').remove([file.storage_path]).catch(() => {});
    }

    const { error } = await sb
        .from('whatsapp_imported_files')
        .delete()
        .eq('id', fileId)
        .eq('user_id', userId);

    return !error;
}
