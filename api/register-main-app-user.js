import { db } from '../../lib/firebase';

export default async function handler(req, res) {
    // Set CORS headers to allow requests from the main app (even if served from different port/domain locally)
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
        const { email, name, location, country } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Check if user already exists
        const userRef = db.collection('users').doc(email);
        const userDoc = await userRef.get();
        
        const userData = {
            email,
            name: name || '',
            location: location || '',
            country: country || '',
            lastUpdated: new Date().toISOString(),
            source: 'main_app'
        };

        // If user doesn't exist, initialize SMS credits and subscription status
        if (!userDoc.exists) {
            userData.smsCredits = 0;
            userData.subscriptionStatus = 'inactive';
            userData.totalSent = 0;
            userData.thisMonthSent = 0;
            userData.recentActivity = [];
            userData.createdAt = new Date().toISOString();
        }

        // Save to Firestore (merge: true updates existing docs without overwriting missing fields)
        await userRef.set(userData, { merge: true });

        console.log(`User registered/updated in Firestore: ${email}`);

        return res.status(200).json({
            success: true,
            message: 'User registered successfully',
            user: userData
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}
