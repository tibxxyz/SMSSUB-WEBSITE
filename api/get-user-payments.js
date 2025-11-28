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

        console.log('Getting payment history for user:', userEmail);

        // Get all payments for this user from Firebase
        const payments = await getUserPayments(userEmail);

        return res.status(200).json({
            success: true,
            data: payments
        });

    } catch (error) {
        console.error('Error getting user payments:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

// Get user payment history from Firebase
async function getUserPayments(userEmail) {
    try {
        const snapshot = await db.collection('payments')
            .where('email', '==', userEmail)
            .orderBy('createdAt', 'desc')
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            const paymentData = doc.data();
            // Calculate credits that were/will be added ($1 = 1 credit)
            const credits = Math.floor(paymentData.amount || 0);
            
            payments.push({
                id: doc.id,
                email: paymentData.email,
                amount: paymentData.amount,
                credits: credits,
                txid: paymentData.txid,
                status: paymentData.status || 'pending',
                createdAt: paymentData.createdAt,
                approvedAt: paymentData.approvedAt || null,
                updatedAt: paymentData.updatedAt || null
            });
        });

        return payments;
    } catch (error) {
        console.error('Error reading payments from Firebase:', error);
        throw error;
    }
}

