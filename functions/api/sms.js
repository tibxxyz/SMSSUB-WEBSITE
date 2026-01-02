/**
 * SMS API for Cloudflare Pages Functions
 */
import { initFirebase, getDb, getAdmin } from '../lib/firebase.js';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Content-Type': 'application/json'
};

// JSON response helper
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders
    });
}

// Handle OPTIONS preflight
export async function onRequestOptions() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

// Handle all other requests
export async function onRequest(context) {
    const { request, env } = context;

    initFirebase(env);
    const db = getDb();

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const method = request.method;

    console.log(`SMS API called with action: ${action}`);

    try {
        switch (action) {
            case 'check-sms-credits':
                return await checkSmsCreditsEndpoint(request, db, method, url);
            case 'deduct-sms-credit':
                return await deductSmsCreditEndpoint(request, db);
            default:
                return jsonResponse({ error: 'Invalid action' }, 400);
        }
    } catch (error) {
        console.error('SMS API Error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Check SMS Credits Endpoint ---
async function checkSmsCreditsEndpoint(request, db, method, url) {
    if (method !== 'GET' && method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        let userEmail;
        if (method === 'POST') {
            const body = await request.json();
            userEmail = body.userEmail;
        } else {
            userEmail = url.searchParams.get('userEmail');
        }

        if (!userEmail) {
            return jsonResponse({ error: 'Email required' }, 400);
        }

        const creditInfo = await checkSmsCreditsLogic(db, userEmail);

        return jsonResponse({
            success: true,
            data: {
                userEmail,
                smsCredits: creditInfo.creditsRemaining,
                hasCredits: creditInfo.hasCredits
            }
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Deduct SMS Credit Endpoint ---
async function deductSmsCreditEndpoint(request, db) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { userEmail } = body;

        if (!userEmail) {
            return jsonResponse({ error: 'Email required' }, 400);
        }

        await deductSmsCredit(db, userEmail);
        const creditInfo = await checkSmsCreditsLogic(db, userEmail);

        return jsonResponse({
            success: true,
            message: 'Credit deducted successfully',
            data: {
                userEmail,
                smsCredits: creditInfo.creditsRemaining,
                hasCredits: creditInfo.hasCredits
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

// --- Helpers ---

async function checkSmsCreditsLogic(db, userEmail) {
    const userDoc = await db.collection('users').doc(userEmail).get();
    if (!userDoc.exists) {
        return { hasCredits: false, creditsRemaining: 0 };
    }

    const credits = userDoc.data().smsCredits || 0;
    return { hasCredits: credits > 0, creditsRemaining: credits };
}

async function deductSmsCredit(db, userEmail) {
    const admin = getAdmin();
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
}
