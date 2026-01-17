/**
 * Deduct SMS Credit API - Cloudflare Pages Function
 * Handles: /api/deduct-sms-credit
 */
import { initFirebase, getDb, FieldValue } from '../lib/firebase.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
        const { userEmail } = body;

        if (!userEmail) {
            return jsonResponse({ error: 'Email required' }, 400);
        }

        const userRef = db.collection('users').doc(userEmail);

        // Get current credits
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return jsonResponse({ error: 'User does not exist' }, 404);
        }

        const currentCredits = userDoc.data().smsCredits || 0;
        if (currentCredits <= 0) {
            return jsonResponse({
                error: 'Insufficient credits',
                data: { smsCredits: 0, hasCredits: false }
            }, 402);
        }

        // Deduct credit
        const newCredits = currentCredits - 1;
        await userRef.update({
            smsCredits: newCredits,
            lastUsed: new Date().toISOString()
        });

        return jsonResponse({
            success: true,
            message: 'Credit deducted successfully',
            data: {
                userEmail,
                smsCredits: newCredits,
                hasCredits: newCredits > 0
            }
        });
    } catch (error) {
        console.error('Deduct credit error:', error);
        return jsonResponse({
            error: 'Internal server error',
            details: error.message
        }, 500);
    }
}
