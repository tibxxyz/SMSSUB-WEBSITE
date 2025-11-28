import { db } from '../lib/firebase';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow GET and POST requests
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;

        if (!userEmail) {
            return res.status(400).json({ 
                error: 'Missing required parameter: userEmail' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userEmail)) {
            return res.status(400).json({ 
                error: 'Invalid email format' 
            });
        }

        console.log('Checking SMS credits for user:', userEmail);

        // Check SMS credits for user using Firebase
        const creditInfo = await getUserSmsCredits(userEmail);

        return res.status(200).json({
            success: true,
            data: {
                userEmail,
                smsCredits: creditInfo.credits,
                hasCredits: creditInfo.credits > 0,
                subscriptionStatus: creditInfo.subscriptionStatus,
                lastUsed: creditInfo.lastUsed,
                totalSent: creditInfo.totalSent,
                thisMonthSent: creditInfo.thisMonthSent
            }
        });

    } catch (error) {
        console.error('SMS credits check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

// Get user SMS credits from Firebase
async function getUserSmsCredits(userEmail) {
    try {
        const userDoc = await db.collection('users').doc(userEmail).get();

        if (!userDoc.exists) {
            return {
                credits: 0,
                subscriptionStatus: 'inactive',
                lastUsed: null,
                totalSent: 0,
                thisMonthSent: 0
            };
        }

        const userData = userDoc.data();
        const credits = userData.smsCredits || 0;
        const subscriptionStatus = userData.subscriptionStatus || 'inactive';
        const lastUsed = userData.lastUsed || null;
        const totalSent = userData.totalSent || 0;
        const thisMonthSent = userData.thisMonthSent || 0;

        return {
            credits,
            subscriptionStatus,
            lastUsed,
            totalSent,
            thisMonthSent
        };
    } catch (error) {
        console.error('Error checking credits:', error);
        // Fail safe: return zero credits if DB error
        return {
            credits: 0,
            subscriptionStatus: 'inactive',
            lastUsed: null,
            totalSent: 0,
            thisMonthSent: 0,
            error: error.message
        };
    }
}

