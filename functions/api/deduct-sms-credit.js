/**
 * Deduct SMS Credit API - Cloudflare Pages Function
 * Handles: /api/deduct-sms-credit
 */
import { initFirebase, getDb, getAdmin } from '../lib/firebase.js';

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
    const admin = getAdmin();

    try {
        const body = await request.json();
        const { userEmail } = body;

        if (!userEmail) {
            return jsonResponse({ error: 'Email required' }, 400);
        }

        const userRef = db.collection('users').doc(userEmail);

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error("User does not exist!");
            }

            const newCredits = (doc.data().smsCredits || 0) - 1;
            if (newCredits < 0) {
                throw new Error("Insufficient credits");
            }

            t.update(userRef, {
                smsCredits: newCredits,
                lastUsed: new Date().toISOString(),
                totalSent: admin.firestore.FieldValue.increment(1),
                thisMonthSent: admin.firestore.FieldValue.increment(1)
            });
        });

        const updatedDoc = await userRef.get();
        const smsCredits = updatedDoc.data().smsCredits || 0;

        return jsonResponse({
            success: true,
            message: 'Credit deducted successfully',
            data: {
                userEmail,
                smsCredits,
                hasCredits: smsCredits > 0
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
