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
                success: false,
                error: 'Missing required parameter: userEmail' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userEmail)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid email format' 
            });
        }

        console.log('Checking admin status for:', userEmail);

        // Check if user is admin
        const isAdmin = await checkAdminStatus(userEmail);

        if (isAdmin) {
            return res.status(200).json({
                success: true,
                isAdmin: true,
                message: 'User is an admin'
            });
        } else {
            return res.status(403).json({
                success: false,
                isAdmin: false,
                error: 'Access denied',
                message: 'User is not an admin'
            });
        }

    } catch (error) {
        console.error('Error checking admin status:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

// Check if user is admin in Firebase
async function checkAdminStatus(userEmail) {
    try {
        const adminDoc = await db.collection('admins').doc(userEmail).get();

        if (!adminDoc.exists) {
            return false;
        }

        const adminData = adminDoc.data();
        
        // Check if admin is active
        if (adminData.active === false) {
            return false;
        }

        // User is admin
        return true;
    } catch (error) {
        console.error('Error reading admin from Firebase:', error);
        // Fail safe: deny access on error
        return false;
    }
}

// Export helper function for use in other API endpoints
export { checkAdminStatus };

