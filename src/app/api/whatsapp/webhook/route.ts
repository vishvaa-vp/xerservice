/**
 * Backward-compatible alias for the canonical signed Meta webhook.
 * Existing provider subscriptions keep working while all processing follows
 * the same verification, deduplication, and privacy controls.
 */
import {
    GET as canonicalGet,
    POST as canonicalPost,
} from '../../webhooks/whatsapp/route';

export const runtime = 'nodejs';
export const GET = canonicalGet;
export const POST = canonicalPost;
