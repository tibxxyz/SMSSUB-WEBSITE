import { db } from '../lib/firebase';
import { verifyPassword } from '../lib/password';

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

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        console.log('Admin login attempt for:', email);

        // Get admin from Firebase
        const adminDoc = await db.collection('admins').doc(email).get();

        if (!adminDoc.exists) {
            // Don't reveal if email exists (security best practice)
            console.warn(`Admin login failed: Email not found - ${email}`);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const adminData = adminDoc.data();

        // Check if admin is active
        if (adminData.active === false) {
            console.warn(`Admin login failed: Account inactive - ${email}`);
            return res.status(403).json({
                success: false,
                error: 'Account is inactive. Contact administrator.'
            });
        }

        // Verify password
        const storedPasswordHash = adminData.passwordHash;
        if (!storedPasswordHash) {
            console.error(`Admin login failed: No password hash found - ${email}`);
            return res.status(500).json({
                success: false,
                error: 'Account configuration error. Contact administrator.'
            });
        }

        const passwordValid = verifyPassword(password, storedPasswordHash);

        if (!passwordValid) {
            console.warn(`Admin login failed: Invalid password - ${email}`);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Update last login timestamp
        try {
            await db.collection('admins').doc(email).update({
                lastLogin: new Date().toISOString()
            });
        } catch (updateError) {
            // Log but don't fail login if update fails
            console.error('Failed to update lastLogin:', updateError);
        }

        console.log(`Admin login successful: ${email}`);

        // Return success with admin info (no sensitive data)
        return res.status(200).json({
            success: true,
            message: 'Login successful',
            admin: {
                email: adminData.email,
                role: adminData.role || 'admin',
                active: adminData.active
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

