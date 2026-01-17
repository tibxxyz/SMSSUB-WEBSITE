/**
 * Check SMS Credits API - Cloudflare Pages Function
 * Handles: /api/check-sms-credits
 */
import { initFirebase, getDb } from '../lib/firebase.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Content-Type': 'application/json'
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

// CORS preflight
export async function onRequestOptions() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

// POST handler
export async function onRequestPost(context) {
    const { request, env } = context;
    initFirebase(env);
    const db = getDb();

    try {
        const body = await request.json();
        const userEmail = body.userEmail;

        if (!userEmail) {
            return jsonResponse({ error: 'Email required' }, 400);
        }

        const userDoc = await db.collection('users').doc(userEmail).get();
        const smsCredits = userDoc.exists ? (userDoc.data().smsCredits || 0) : 0;

        return jsonResponse({
            success: true,
            data: {
                hasCredits: smsCredits > 0,
                smsCredits
            }
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// GET handler (for backwards compatibility)
export async function onRequestGet(context) {
    const { request, env } = context;
    initFirebase(env);
    const db = getDb();

    const url = new URL(request.url);
    const userEmail = url.searchParams.get('userEmail');

    if (!userEmail) {
        return jsonResponse({ error: 'Email required' }, 400);
    }

    try {
        const userDoc = await db.collection('users').doc(userEmail).get();
        const smsCredits = userDoc.exists ? (userDoc.data().smsCredits || 0) : 0;

        return jsonResponse({
            success: true,
            data: {
                hasCredits: smsCredits > 0,
                smsCredits
            }
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}
