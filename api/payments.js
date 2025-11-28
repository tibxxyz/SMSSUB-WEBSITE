import { db } from './lib/firebase.js';
import { sendTelegramNotification } from './lib/telegram.js';
import admin from 'firebase-admin';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { action } = req.query;
    console.log(`Payments API called with action: ${action}`);

    switch (action) {
        case 'submit-payment':
            return submitPayment(req, res);
        case 'approve-payment':
            return approvePayment(req, res);
        case 'get-pending-payments':
            return getPendingPayments(req, res);
        case 'get-user-payments':
            return getUserPayments(req, res);
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
}

// --- Submit Payment ---
async function submitPayment(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email, amount, txid, currency } = req.body;
        if (!email || !amount || !txid) return res.status(400).json({ error: 'Missing fields' });

        const paymentData = {
            email,
            amount: parseFloat(amount),
            txid,
            currency: currency || 'USDT',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        await db.collection('payments').add(paymentData);

        // Telegram Notification
        const message = `
<b>💰 New Payment Request!</b>

<b>User:</b> ${email}
<b>Amount:</b> $${amount}
<b>TXID:</b> <code>${txid}</code>

<i>Check Admin Panel to approve.</i>
        `;
        sendTelegramNotification(message).catch(console.error);

        return res.status(200).json({ success: true, message: 'Payment submitted' });
    } catch (error) {
        console.error('Submit payment error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Approve Payment ---
async function approvePayment(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { paymentId, adminEmail } = req.body;
        if (!paymentId) return res.status(400).json({ error: 'Payment ID required' });

        // Get payment
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) return res.status(404).json({ error: 'Payment not found' });
        const paymentData = paymentDoc.data();

        if (paymentData.status === 'approved') return res.status(400).json({ error: 'Already approved' });

        const userEmail = paymentData.email;
        const creditsToAdd = Math.floor(paymentData.amount); // $1 = 1 credit

        // Run transaction
        await db.runTransaction(async (t) => {
            // Update payment status
            t.update(paymentRef, {
                status: 'approved',
                approvedBy: adminEmail || 'admin',
                approvedAt: new Date().toISOString()
            });

            // Update user credits
            const userRef = db.collection('users').doc(userEmail);
            t.set(userRef, {
                smsCredits: admin.firestore.FieldValue.increment(creditsToAdd),
                lastPaymentDate: new Date().toISOString(),
                subscriptionStatus: 'active'
            }, { merge: true });
        });

        return res.status(200).json({ success: true, message: 'Payment approved and credits added' });
    } catch (error) {
        console.error('Approve payment error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Get Pending Payments ---
async function getPendingPayments(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        return res.status(200).json({ success: true, payments });
    } catch (error) {
        console.error('Get pending payments error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Get User Payments ---
async function getUserPayments(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;
        if (!userEmail) return res.status(400).json({ error: 'Email required' });

        const snapshot = await db.collection('payments')
            .where('email', '==', userEmail)
            .orderBy('createdAt', 'desc')
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        return res.status(200).json({ success: true, payments });
    } catch (error) {
        console.error('Get user payments error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
