import { db } from '../lib/firebase';

// Validate email from main app's stored user data
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

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                error: 'Email address is required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Invalid email format'
            });
        }

        console.log('Validating email from main app (Firestore):', email);

        // Check if email exists in Firestore
        const userRecord = await checkEmailInMainApp(email);

        if (userRecord) {
            return res.status(200).json({
                success: true,
                message: 'Email validated successfully',
                data: {
                    email: userRecord.email,
                    name: userRecord.name,
                    isRegistered: true,
                    source: 'main_app_storage',
                    accessLevel: 'full'
                }
            });
        } else {
            return res.status(403).json({
                success: false,
                error: 'Access Denied',
                message: 'This email address is not registered in the main app.',
                details: {
                    email: email,
                    isRegistered: false,
                    reason: 'email_not_found_in_main_app',
                    solution: 'save_email_in_main_app'
                },
                instructions: {
                    step1: 'Go to the main Ticketmaster app',
                    step2: 'Navigate to My Account page',
                    step3: 'Save your email address in the account settings',
                    step4: 'Return to login with the same email'
                }
            });
        }

    } catch (error) {
        console.error('Email validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Unable to validate email at this time. Please try again later.'
        });
    }
}

// Check if email exists in Firestore
async function checkEmailInMainApp(email) {
    try {
        const doc = await db.collection('users').doc(email).get();
        if (doc.exists) {
            return doc.data();
        }
        return null;
    } catch (error) {
        console.error('Error reading user database:', error);
        return null;
    }
}
