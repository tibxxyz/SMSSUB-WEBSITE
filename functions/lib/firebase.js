/**
 * Firebase Admin SDK initialization for Cloudflare Workers
 * Uses nodejs_compat flag for Firebase Admin support
 */
import admin from 'firebase-admin';

let db = null;
let adminInstance = null;

/**
 * Initialize Firebase Admin SDK
 * @param {Object} env - Cloudflare environment bindings
 * @returns {FirebaseFirestore.Firestore} Firestore database instance
 */
export function initFirebase(env) {
    if (db) return db;

    try {
        if (!admin.apps.length) {
            adminInstance = admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: env.FIREBASE_PROJECT_ID,
                    clientEmail: env.FIREBASE_CLIENT_EMAIL,
                    privateKey: env.FIREBASE_PRIVATE_KEY
                        ? env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                        : undefined,
                }),
            });
            console.log('Firebase Admin Initialized');
        }
        db = admin.firestore();
    } catch (error) {
        console.error('Firebase Admin Initialization Error:', error.message);
        throw error;
    }

    return db;
}

/**
 * Get Firestore database instance
 * @returns {FirebaseFirestore.Firestore}
 */
export function getDb() {
    if (!db) {
        throw new Error('Firebase not initialized. Call initFirebase(env) first.');
    }
    return db;
}

/**
 * Get Firebase Admin instance for FieldValue operations
 * @returns {admin}
 */
export function getAdmin() {
    return admin;
}

export { db };
