import { db } from './lib/firebase.js';
// We need to dynamically import verifyPassword because it might not be needed for all actions
// and to avoid issues if the file is missing (though it should be there).
// Actually, standard import is fine since it's bundled.
import { verifyPassword } from './lib/password.js';

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

    const { action } = req.query;

    console.log(`Users API called with action: ${action}`);

    switch (action) {
        case 'register-main-app-user':
            return registerMainAppUser(req, res);
        case 'validate-user':
            return validateUser(req, res);
        case 'get-user-data':
            return getUserData(req, res);
        case 'get-all-users':
            return getAllUsers(req, res);
        case 'check-admin':
            return checkAdmin(req, res);
        case 'admin-login':
            return adminLogin(req, res);
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
}

// --- Register Main App User ---
async function registerMainAppUser(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email, firstName, lastName, phone } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Save to Firestore
        await db.collection('users').doc(email).set({
            email,
            firstName,
            lastName,
            phone,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return res.status(200).json({ success: true, message: 'User registered' });
    } catch (error) {
        console.error('Registration error:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Validate User ---
async function validateUser(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const doc = await db.collection('users').doc(email).get();
        if (doc.exists) {
            return res.status(200).json({ success: true, valid: true });
        } else {
            return res.status(200).json({ success: true, valid: false });
        }
    } catch (error) {
        console.error('Validation error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Get User Data ---
async function getUserData(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;
        if (!userEmail) return res.status(400).json({ error: 'Email is required' });

        const doc = await db.collection('users').doc(userEmail).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.status(200).json({ success: true, user: doc.data() });
    } catch (error) {
        console.error('Get user data error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Get All Users ---
async function getAllUsers(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const usersSnapshot = await db.collection('users').get();
        const users = [];

        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            users.push({
                email: doc.id,
                ...userData
            });
        });

        // Sort by createdAt (newest first) or updatedAt
        users.sort((a, b) => {
            const dateA = a.createdAt || a.updatedAt || '';
            const dateB = b.createdAt || b.updatedAt || '';
            return dateB.localeCompare(dateA);
        });

        return res.status(200).json({ 
            success: true, 
            users: users,
            count: users.length 
        });
    } catch (error) {
        console.error('Get all users error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Check Admin ---
async function checkAdmin(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;
        if (!userEmail) return res.status(400).json({ error: 'Email is required' });

        const doc = await db.collection('admins').doc(userEmail).get();
        const isAdmin = doc.exists && doc.data().active !== false;

        return res.status(200).json({ success: true, isAdmin });
    } catch (error) {
        console.error('Check admin error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Admin Login ---
async function adminLogin(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const doc = await db.collection('admins').doc(email).get();
        if (!doc.exists) return res.status(401).json({ error: 'Invalid credentials' });

        const adminData = doc.data();
        if (adminData.active === false) return res.status(403).json({ error: 'Account inactive' });

        if (!verifyPassword(password, adminData.passwordHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.collection('admins').doc(email).update({ lastLogin: new Date().toISOString() });

        return res.status(200).json({
            success: true,
            admin: {
                email: adminData.email,
                role: adminData.role || 'admin'
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
