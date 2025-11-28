import { db } from '../lib/firebase';
import admin from 'firebase-admin';
import { checkAdminStatus } from './check-admin.js';

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

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentId, email, amount, adminEmail } = req.body;

        // Check admin status - require adminEmail in request
        if (!adminEmail) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'Admin authentication required'
            });
        }

        const isAdmin = await checkAdminStatus(adminEmail);
        if (!isAdmin) {
            console.warn(`Unauthorized admin access attempt: ${adminEmail}`);
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'Admin access required. You do not have permission to approve payments.'
            });
        }

        if (!paymentId || !email || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Calculate credits: $1 = 1 SMS credit (strictly)
        // Example: $5 = 5 credits, $20 = 20 credits, $60 = 60 credits
        const creditsToAdd = Math.floor(amount);

        // Calculate new expiry date (e.g., +30 days from now)
        const now = new Date();
        const expiryDate = new Date(now.setDate(now.getDate() + 30)).toISOString();

        // Run as a transaction to ensure data integrity
        await db.runTransaction(async (t) => {
            // 1. Get Payment Doc
            const paymentRef = db.collection('payments').doc(paymentId);
            const paymentDoc = await t.get(paymentRef);

            if (!paymentDoc.exists) {
                throw new Error('Payment request not found');
            }

            if (paymentDoc.data().status === 'approved') {
                throw new Error('Payment already approved');
            }

            // 2. Get User Doc
            const userRef = db.collection('users').doc(email);
            const userDoc = await t.get(userRef);

            if (!userDoc.exists) {
                throw new Error('User not found');
            }

            const userData = userDoc.data();
            const currentCredits = userData.smsCredits || 0;

            // 3. Update Payment Status
            t.update(paymentRef, {
                status: 'approved',
                approvedAt: new Date().toISOString()
            });

            // 4. Update User Credits (No Expiry)
            t.update(userRef, {
                smsCredits: currentCredits + creditsToAdd,
                subscriptionStatus: 'active',
                lastPaymentDate: new Date().toISOString()
            });
        });

        console.log(`Approved payment ${paymentId} for ${email}: +${creditsToAdd} credits`);

        return res.status(200).json({
            success: true,
            message: 'Payment approved and credits added'
        });

    } catch (error) {
        console.error('Approval error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
