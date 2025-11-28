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

        console.log('Getting user data for:', userEmail);

        // Get user data from Firebase
        const userData = await getUserDataFromFirebase(userEmail);

        if (!userData) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'User does not exist in the system'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                email: userData.email,
                name: userData.name || '',
                location: userData.location || '',
                country: userData.country || '',
                smsCredits: userData.smsCredits || 0,
                subscriptionStatus: userData.subscriptionStatus || 'inactive',
                lastUsed: userData.lastUsed || null,
                totalSent: userData.totalSent || 0,
                thisMonthSent: userData.thisMonthSent || 0,
                recentActivity: userData.recentActivity || [],
                createdAt: userData.createdAt || null,
                lastUpdated: userData.lastUpdated || null,
                lastPaymentDate: userData.lastPaymentDate || null
            }
        });

    } catch (error) {
        console.error('Error getting user data:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

// Get user data from Firebase
async function getUserDataFromFirebase(userEmail) {
    try {
        const userDoc = await db.collection('users').doc(userEmail).get();

        if (!userDoc.exists) {
            return null;
        }

        const userData = userDoc.data();
        return {
            email: userEmail,
            name: userData.name || '',
            location: userData.location || '',
            country: userData.country || '',
            smsCredits: userData.smsCredits || 0,
            subscriptionStatus: userData.subscriptionStatus || 'inactive',
            lastUsed: userData.lastUsed || null,
            totalSent: userData.totalSent || 0,
            thisMonthSent: userData.thisMonthSent || 0,
            recentActivity: userData.recentActivity || [],
            createdAt: userData.createdAt || null,
            lastUpdated: userData.lastUpdated || null,
            lastPaymentDate: userData.lastPaymentDate || null
        };
    } catch (error) {
        console.error('Error reading user from Firebase:', error);
        throw error;
    }
}

