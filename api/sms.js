import { db } from './lib/firebase.js';
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
    console.log(`SMS API called with action: ${action}`);

    switch (action) {
        case 'check-sms-credits':
            return checkSmsCreditsEndpoint(req, res);
        case 'deduct-sms-credit':
            return deductSmsCreditEndpoint(req, res);
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
}

// --- Check SMS Credits Endpoint ---
async function checkSmsCreditsEndpoint(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;
        if (!userEmail) return res.status(400).json({ error: 'Email required' });

        const creditInfo = await checkSmsCreditsLogic(userEmail);

        return res.status(200).json({
            success: true,
            data: {
                userEmail,
                smsCredits: creditInfo.creditsRemaining,
                hasCredits: creditInfo.hasCredits
            }
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Deduct SMS Credit Endpoint ---
async function deductSmsCreditEndpoint(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.body;
        if (!userEmail) return res.status(400).json({ error: 'Email required' });

        // Deduct credit using the existing helper function
        await deductSmsCredit(userEmail);

        // Get updated credit count
        const creditInfo = await checkSmsCreditsLogic(userEmail);

        return res.status(200).json({
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
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
}

// --- Helpers ---

async function checkSmsCreditsLogic(userEmail) {
    const userDoc = await db.collection('users').doc(userEmail).get();
    if (!userDoc.exists) return { hasCredits: false, creditsRemaining: 0 };

    const credits = userDoc.data().smsCredits || 0;
    return { hasCredits: credits > 0, creditsRemaining: credits };
}

async function deductSmsCredit(userEmail) {
    const userRef = db.collection('users').doc(userEmail);
    await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        if (!doc.exists) throw new Error("User does not exist!");

        const newCredits = (doc.data().smsCredits || 0) - 1;
        if (newCredits < 0) throw new Error("Insufficient credits");

        t.update(userRef, {
            smsCredits: newCredits,
            lastUsed: new Date().toISOString(),
            totalSent: admin.firestore.FieldValue.increment(1),
            thisMonthSent: admin.firestore.FieldValue.increment(1)
        });
    });
}

