import admin from 'firebase-admin';

// Suppress DEP0169 deprecation warning from transitive dependencies
// This warning comes from url.parse() usage in google-auth-library or its deps
// It's safe to suppress as it doesn't affect functionality
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, type, code, ...args) {
    // Suppress only DEP0169 warnings (url.parse deprecation)
    if (code === 'DEP0169' || (typeof warning === 'string' && warning.includes('DEP0169'))) {
        return; // Suppress this specific warning
    }
    return originalEmitWarning.call(process, warning, type, code, ...args);
};

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Handle private key newlines for Vercel/Env variables
                privateKey: process.env.FIREBASE_PRIVATE_KEY
                    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                    : undefined,
            }),
        });
        console.log('Firebase Admin Initialized');
    } catch (error) {
        console.error('Firebase Admin Initialization Error:', error.stack);
    }
}

const db = admin.firestore();

export { db };
