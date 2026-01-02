/**
 * Payments API for Cloudflare Pages Functions
 */
import { initFirebase, getDb } from '../lib/firebase.js';
import { sendTelegramNotification, sendPaymentNotificationWithButtons } from '../lib/telegram.js';

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

    console.log(`Payments API called with action: ${action}`);

    try {
        switch (action) {
            case 'submit-payment':
                return await submitPayment(request, db, env);
            case 'approve-payment':
                return await approvePayment(request, db, env);
            case 'reject-payment':
                return await rejectPayment(request, db, env);
            case 'delete-payment':
                return await deletePayment(request, db);
            case 'get-pending-payments':
                return await getPendingPayments(db);
            case 'get-user-payments':
                return await getUserPayments(request, db, method, url);
            default:
                return jsonResponse({ error: 'Invalid action' }, 400);
        }
    } catch (error) {
        console.error('Payments API Error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Submit Payment ---
async function submitPayment(request, db, env) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { email, amount, txid, currency } = body;

        if (!email || !amount || !txid) {
            return jsonResponse({ error: 'Missing fields' }, 400);
        }

        const paymentData = {
            email,
            amount: parseFloat(amount),
            txid,
            currency: currency || 'USDT',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        const paymentRef = await db.collection('payments').add(paymentData);
        const paymentId = paymentRef.id;

        sendPaymentNotificationWithButtons(email, amount, txid, paymentId, env).catch(console.error);

        return jsonResponse({ success: true, message: 'Payment submitted' });
    } catch (error) {
        console.error('Submit payment error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Approve Payment ---
async function approvePayment(request, db, env) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { paymentId, adminEmail } = body;

        if (!paymentId) {
            return jsonResponse({ error: 'Payment ID required' }, 400);
        }

        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            return jsonResponse({ error: 'Payment not found' }, 404);
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'approved') {
            return jsonResponse({ error: 'Already approved' }, 400);
        }

        const userEmail = paymentData.email;
        const creditsToAdd = Math.floor(paymentData.amount);

        // Update payment status
        await paymentRef.update({
            status: 'approved',
            approvedBy: adminEmail || 'admin',
            approvedAt: new Date().toISOString()
        });

        // Get current user credits and increment
        const userRef = db.collection('users').doc(userEmail);
        const userDoc = await userRef.get();
        const currentCredits = userDoc.exists ? (userDoc.data().smsCredits || 0) : 0;

        await userRef.set({
            smsCredits: currentCredits + creditsToAdd,
            lastPaymentDate: new Date().toISOString(),
            subscriptionStatus: 'active'
        }, { merge: true });

        const message = `
✅ <b>Payment Approved!</b>

<b>User:</b> ${userEmail}
<b>Amount:</b> $${paymentData.amount}
<b>Credits Added:</b> ${creditsToAdd} SMS
<b>Approved By:</b> ${adminEmail || 'admin'}
        `;
        sendTelegramNotification(message, env).catch(console.error);

        return jsonResponse({ success: true, message: 'Payment approved and credits added' });
    } catch (error) {
        console.error('Approve payment error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Reject Payment ---
async function rejectPayment(request, db, env) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { paymentId, adminEmail } = body;

        if (!paymentId) {
            return jsonResponse({ error: 'Payment ID required' }, 400);
        }

        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            return jsonResponse({ error: 'Payment not found' }, 404);
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'rejected') {
            return jsonResponse({ error: 'Already rejected' }, 400);
        }
        if (paymentData.status === 'approved') {
            return jsonResponse({ error: 'Cannot reject approved payment' }, 400);
        }

        await paymentRef.update({
            status: 'rejected',
            rejectedBy: adminEmail || 'admin',
            rejectedAt: new Date().toISOString()
        });

        const message = `
❌ <b>Payment Rejected</b>

<b>User:</b> ${paymentData.email}
<b>Amount:</b> $${paymentData.amount}
<b>TXID:</b> <code>${paymentData.txid}</code>
<b>Rejected By:</b> ${adminEmail || 'admin'}
        `;
        sendTelegramNotification(message, env).catch(console.error);

        return jsonResponse({ success: true, message: 'Payment rejected' });
    } catch (error) {
        console.error('Reject payment error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Delete Payment ---
async function deletePayment(request, db) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { paymentId } = body;

        if (!paymentId) {
            return jsonResponse({ error: 'Payment ID required' }, 400);
        }

        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            return jsonResponse({ error: 'Payment not found' }, 404);
        }

        await paymentRef.delete();
        return jsonResponse({ success: true, message: 'Payment deleted' });
    } catch (error) {
        console.error('Delete payment error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Get Pending Payments ---
async function getPendingPayments(db) {
    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        payments.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
        });

        return jsonResponse({ success: true, payments });
    } catch (error) {
        console.error('Get pending payments error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Get User Payments ---
async function getUserPayments(request, db, method, url) {
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

        const snapshot = await db.collection('payments')
            .where('email', '==', userEmail)
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        payments.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
        });

        return jsonResponse({ success: true, payments });
    } catch (error) {
        console.error('Get user payments error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}
