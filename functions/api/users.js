/**
 * Users API for Cloudflare Pages Functions
 */
import { initFirebase, getDb } from '../lib/firebase.js';
import { verifyPassword } from '../lib/password.js';
import { sendTelegramNotification } from '../lib/telegram.js';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Content-Type': 'application/json'
};

// JSON response helper
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders
    });
}

// Handle OPTIONS preflight
export async function onRequestOptions() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

// Handle all other requests
export async function onRequest(context) {
    const { request, env } = context;

    // Initialize Firebase
    initFirebase(env);
    const db = getDb();

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const method = request.method;

    console.log(`Users API called with action: ${action}`);

    try {
        switch (action) {
            case 'register-main-app-user':
                return await registerMainAppUser(request, db, env);
            case 'validate-user':
                return await validateUser(request, db);
            case 'get-user-data':
                return await getUserData(request, db, method, url);
            case 'get-all-users':
                return await getAllUsers(db);
            case 'check-admin':
                return await checkAdmin(request, db, method, url);
            case 'admin-login':
                return await adminLogin(request, db);
            case 'delete-user':
                return await deleteUser(request, db);
            default:
                return jsonResponse({ error: 'Invalid action' }, 400);
        }
    } catch (error) {
        console.error('API Error:', error);
        return jsonResponse({
            error: 'Internal server error',
            message: error.message,
            stack: error.stack
        }, 500);
    }
}

// --- Register Main App User ---
async function registerMainAppUser(request, db, env) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { email, firstName, lastName, phone, name, source } = body;

        if (!email) {
            return jsonResponse({ error: 'Email is required' }, 400);
        }

        let finalFirstName = firstName || '';
        let finalLastName = lastName || '';
        let finalPhone = phone || '';

        if (name && !firstName) {
            const nameParts = name.trim().split(' ');
            finalFirstName = nameParts[0] || '';
            finalLastName = nameParts.slice(1).join(' ') || '';
        }

        const fullName = [finalFirstName, finalLastName].filter(Boolean).join(' ');

        // Check if user already exists
        const existingDoc = await db.collection('users').doc(email).get();
        const isNewUser = !existingDoc.exists;

        // Check for duplicate name (only if a name is provided)
        if (fullName && fullName.trim()) {
            const usersSnapshot = await db.collection('users').get();
            let duplicateNameUser = null;

            usersSnapshot.forEach(doc => {
                if (doc.id !== email) { // Don't check against self
                    const userData = doc.data();
                    const existingFullName = [userData.firstName || '', userData.lastName || ''].filter(Boolean).join(' ');
                    if (existingFullName.toLowerCase() === fullName.toLowerCase()) {
                        duplicateNameUser = doc.id;
                    }
                }
            });

            if (duplicateNameUser) {
                return jsonResponse({
                    success: false,
                    error: 'Name already taken',
                    message: `The name "${fullName}" is already registered to another user.`
                }, 409);
            }
        }

        const userData = {
            email,
            updatedAt: new Date().toISOString()
        };

        if (finalFirstName) userData.firstName = finalFirstName;
        if (finalLastName) userData.lastName = finalLastName;
        if (finalPhone) userData.phone = finalPhone;

        // Set createdAt only for new users
        if (isNewUser) {
            userData.createdAt = new Date().toISOString();
        }

        await db.collection('users').doc(email).set(userData, { merge: true });
        console.log('[Register] User saved to Firestore:', email, 'isNewUser:', isNewUser);

        // Only send Telegram notification for NEW users
        if (isNewUser) {
            const phoneDisplay = finalPhone || 'N/A';
            const registrationSource = source || 'TM App';
            const message = `
👤 <b>New User Registration!</b>

<b>Email:</b> ${email}
<b>Name:</b> ${fullName || 'N/A'}
<b>Phone:</b> ${phoneDisplay}
<b>Source:</b> ${registrationSource}
            `;
            console.log('[Register] Sending Telegram notification for new user:', email);
            console.log('[Register] TELEGRAM_BOT_TOKEN exists:', !!env.TELEGRAM_BOT_TOKEN);
            console.log('[Register] TELEGRAM_ADMIN_CHAT_ID exists:', !!env.TELEGRAM_ADMIN_CHAT_ID);

            try {
                await sendTelegramNotification(message, env);
                console.log('[Register] Telegram notification sent successfully');
            } catch (telegramError) {
                console.error('[Register] Telegram notification failed:', telegramError);
            }
        }

        return jsonResponse({
            success: true,
            message: isNewUser ? 'User registered' : 'User profile updated',
            isNewUser: isNewUser
        });
    } catch (error) {
        console.error('Registration error:', error);
        return jsonResponse({ error: 'Internal server error', message: error.message }, 500);
    }
}

// --- Validate User ---
async function validateUser(request, db) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { email } = body;

        if (!email) {
            return jsonResponse({ error: 'Email is required' }, 400);
        }

        console.log('[ValidateUser] Checking email:', email);

        // First try: document ID is the email
        const doc = await db.collection('users').doc(email).get();

        if (doc.exists) {
            console.log('[ValidateUser] Found user by doc ID:', email);
            return jsonResponse({ success: true, valid: true });
        }

        // Second try: search by email field (in case doc ID is different)
        console.log('[ValidateUser] Doc ID not found, searching by email field...');
        const querySnapshot = await db.collection('users').where('email', '==', email).get();

        if (!querySnapshot.empty) {
            console.log('[ValidateUser] Found user by email field query');
            return jsonResponse({ success: true, valid: true });
        }

        console.log('[ValidateUser] User not found:', email);
        return jsonResponse({ success: true, valid: false });
    } catch (error) {
        console.error('Validation error:', error);
        return jsonResponse({ error: 'Internal server error', message: error.message }, 500);
    }
}

// --- Get User Data ---
async function getUserData(request, db, method, url) {
    if (method !== 'GET' && method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        let userEmail;
        if (method === 'POST') {
            const body = await request.json();
            userEmail = body.userEmail;
        } else {
            userEmail = url.searchParams.get('userEmail');
        }

        if (!userEmail) {
            return jsonResponse({ error: 'Email is required' }, 400);
        }

        const doc = await db.collection('users').doc(userEmail).get();
        if (!doc.exists) {
            return jsonResponse({ error: 'User not found' }, 404);
        }

        return jsonResponse({ success: true, user: doc.data() });
    } catch (error) {
        console.error('Get user data error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Get All Users ---
async function getAllUsers(db) {
    try {
        const usersSnapshot = await db.collection('users').get();
        const users = [];

        usersSnapshot.forEach(doc => {
            users.push({ email: doc.id, ...doc.data() });
        });

        users.sort((a, b) => {
            const dateA = a.createdAt || a.updatedAt || '';
            const dateB = b.createdAt || b.updatedAt || '';
            return dateB.localeCompare(dateA);
        });

        return jsonResponse({ success: true, users, count: users.length });
    } catch (error) {
        console.error('Get all users error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Check Admin ---
async function checkAdmin(request, db, method, url) {
    if (method !== 'GET' && method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        let userEmail;
        if (method === 'POST') {
            const body = await request.json();
            userEmail = body.userEmail;
        } else {
            userEmail = url.searchParams.get('userEmail');
        }

        if (!userEmail) {
            return jsonResponse({ error: 'Email is required' }, 400);
        }

        const doc = await db.collection('admins').doc(userEmail).get();
        const isAdmin = doc.exists && doc.data().active !== false;

        return jsonResponse({ success: true, isAdmin });
    } catch (error) {
        console.error('Check admin error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Admin Login ---
async function adminLogin(request, db) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { email, password } = body;

        if (!email || !password) {
            return jsonResponse({ error: 'Email and password required' }, 400);
        }

        const doc = await db.collection('admins').doc(email).get();
        if (!doc.exists) {
            return jsonResponse({ error: 'Invalid credentials' }, 401);
        }

        const adminData = doc.data();
        if (adminData.active === false) {
            return jsonResponse({ error: 'Account inactive' }, 403);
        }

        const isValid = await verifyPassword(password, adminData.passwordHash);
        if (!isValid) {
            return jsonResponse({ error: 'Invalid credentials' }, 401);
        }

        await db.collection('admins').doc(email).update({
            lastLogin: new Date().toISOString()
        });

        return jsonResponse({
            success: true,
            admin: { email: adminData.email, role: adminData.role || 'admin' }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// --- Delete User ---
async function deleteUser(request, db) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const { userEmail } = body;

        if (!userEmail) {
            return jsonResponse({ error: 'Email is required' }, 400);
        }

        const userRef = db.collection('users').doc(userEmail);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return jsonResponse({ error: 'User not found' }, 404);
        }

        await userRef.delete();
        return jsonResponse({ success: true, message: 'User deleted' });
    } catch (error) {
        console.error('Delete user error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}
