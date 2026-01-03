/**
 * Firebase REST API Client for Cloudflare Workers
 * Uses Firestore REST API instead of Admin SDK
 */

let firebaseConfig = null;
let accessToken = null;
let tokenExpiry = 0;

/**
 * Initialize Firebase with environment variables
 */
export function initFirebase(env) {
    console.log('[Firebase] Initializing...');
    console.log('[Firebase] Project ID exists:', !!env.FIREBASE_PROJECT_ID);
    console.log('[Firebase] Client Email exists:', !!env.FIREBASE_CLIENT_EMAIL);
    console.log('[Firebase] Private Key exists:', !!env.FIREBASE_PRIVATE_KEY);
    console.log('[Firebase] Private Key length:', env.FIREBASE_PRIVATE_KEY?.length || 0);

    firebaseConfig = {
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };

    console.log('[Firebase] Config set. Project ID:', firebaseConfig.projectId);
    console.log('[Firebase] Client Email:', firebaseConfig.clientEmail);
    console.log('[Firebase] Private Key starts with BEGIN:', firebaseConfig.privateKey?.startsWith('-----BEGIN') || false);
}

/**
 * Create a JWT for Firebase authentication
 */
async function createJWT() {
    console.log('[JWT] Creating JWT...');

    try {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 3600; // 1 hour

        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        const payload = {
            iss: firebaseConfig.clientEmail,
            sub: firebaseConfig.clientEmail,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: exp,
            scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database'
        };

        console.log('[JWT] Payload ISS:', payload.iss);

        const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const signatureInput = `${encodedHeader}.${encodedPayload}`;

        // Import private key
        console.log('[JWT] Extracting private key...');
        const pemContents = firebaseConfig.privateKey
            .replace('-----BEGIN PRIVATE KEY-----', '')
            .replace('-----END PRIVATE KEY-----', '')
            .replace(/\s/g, '');

        console.log('[JWT] PEM contents length:', pemContents.length);

        const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
        console.log('[JWT] Binary key length:', binaryKey.length);

        console.log('[JWT] Importing crypto key...');
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            binaryKey,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );
        console.log('[JWT] Crypto key imported successfully');

        console.log('[JWT] Signing...');
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            new TextEncoder().encode(signatureInput)
        );

        const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        console.log('[JWT] JWT created successfully');
        return `${signatureInput}.${encodedSignature}`;
    } catch (error) {
        console.error('[JWT] Error creating JWT:', error.message);
        console.error('[JWT] Error stack:', error.stack);
        throw error;
    }
}

/**
 * Get OAuth2 access token
 */
async function getAccessToken() {
    console.log('[Token] Getting access token...');

    const now = Date.now();
    if (accessToken && tokenExpiry > now) {
        console.log('[Token] Using cached token');
        return accessToken;
    }

    console.log('[Token] Fetching new token...');
    const jwt = await createJWT();

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const data = await response.json();
    console.log('[Token] Response status:', response.status);

    if (!response.ok) {
        console.error('[Token] Token error:', JSON.stringify(data));
        throw new Error(`Failed to get access token: ${data.error_description || data.error}`);
    }

    accessToken = data.access_token;
    tokenExpiry = now + (data.expires_in - 60) * 1000;

    console.log('[Token] Access token obtained successfully');
    return accessToken;
}

/**
 * Firestore REST API base URL
 */
function getFirestoreUrl(path = '') {
    return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents${path}`;
}

/**
 * Convert Firestore document to plain object
 */
function docToObject(doc) {
    if (!doc.fields) return null;
    const obj = {};
    for (const [key, value] of Object.entries(doc.fields)) {
        obj[key] = parseFirestoreValue(value);
    }
    return obj;
}

function parseFirestoreValue(value) {
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return parseInt(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(parseFirestoreValue);
    if ('mapValue' in value) return docToObject({ fields: value.mapValue.fields });
    return null;
}

/**
 * Convert plain object to Firestore format
 */
function objectToDoc(obj) {
    const fields = {};
    for (const [key, value] of Object.entries(obj)) {
        fields[key] = toFirestoreValue(value);
    }
    return { fields };
}

function toFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
    if (typeof value === 'object') return { mapValue: { fields: objectToDoc(value).fields } };
    return { stringValue: String(value) };
}

/**
 * FirestoreDB class - mimics Admin SDK interface
 */
class FirestoreDB {
    collection(name) {
        return new CollectionRef(name);
    }

    async runTransaction(callback) {
        // Simple implementation - just run the callback
        const batch = new TransactionBatch();
        await callback(batch);
        await batch.commit();
    }
}

class CollectionRef {
    constructor(name) {
        this.name = name;
    }

    doc(id) {
        return new DocumentRef(this.name, id);
    }

    async add(data) {
        const token = await getAccessToken();
        const doc = objectToDoc(data);

        const response = await fetch(getFirestoreUrl(`/${this.name}`), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(doc)
        });

        const result = await response.json();
        const id = result.name?.split('/').pop();
        return { id };
    }

    async get() {
        const token = await getAccessToken();
        const response = await fetch(getFirestoreUrl(`/${this.name}`), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        return new QuerySnapshot(data.documents || [], this.name);
    }

    where(field, op, value) {
        return new QueryRef(this.name, [{ field, op, value }]);
    }

    limit(n) {
        return new QueryRef(this.name, [], n);
    }
}

class QueryRef {
    constructor(collection, filters = [], limitCount = null) {
        this.collection = collection;
        this.filters = filters;
        this.limitCount = limitCount;
    }

    where(field, op, value) {
        return new QueryRef(this.collection, [...this.filters, { field, op, value }], this.limitCount);
    }

    limit(n) {
        return new QueryRef(this.collection, this.filters, n);
    }

    async get() {
        const token = await getAccessToken();

        const structuredQuery = {
            from: [{ collectionId: this.collection }],
        };

        if (this.filters.length > 0) {
            const opMap = { '==': 'EQUAL', '<': 'LESS_THAN', '>': 'GREATER_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>=': 'GREATER_THAN_OR_EQUAL' };
            structuredQuery.where = {
                compositeFilter: {
                    op: 'AND',
                    filters: this.filters.map(f => ({
                        fieldFilter: {
                            field: { fieldPath: f.field },
                            op: opMap[f.op] || 'EQUAL',
                            value: toFirestoreValue(f.value)
                        }
                    }))
                }
            };
            if (this.filters.length === 1) {
                structuredQuery.where = structuredQuery.where.compositeFilter.filters[0];
            }
        }

        if (this.limitCount) {
            structuredQuery.limit = this.limitCount;
        }

        const response = await fetch(
            `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ structuredQuery })
            }
        );

        const results = await response.json();
        const docs = results
            .filter(r => r.document)
            .map(r => {
                const name = r.document.name;
                const id = name.split('/').pop();
                return { id, name, fields: r.document.fields };
            });

        return new QuerySnapshot(docs, this.collection);
    }
}

class QuerySnapshot {
    constructor(docs, collection) {
        this._docs = docs;
        this.collection = collection;
        this.size = docs.length;
        this.empty = docs.length === 0;
    }

    forEach(callback) {
        this._docs.forEach(doc => {
            callback(new DocumentSnapshot(doc, this.collection));
        });
    }
}

class DocumentSnapshot {
    constructor(doc, collection) {
        this._doc = doc;
        this.collection = collection;
        this.id = doc.id || doc.name?.split('/').pop();
        this.exists = !!doc.fields;
    }

    data() {
        return docToObject(this._doc);
    }
}

class DocumentRef {
    constructor(collection, id) {
        this.collection = collection;
        this.id = id;
    }

    async get() {
        const token = await getAccessToken();
        const response = await fetch(getFirestoreUrl(`/${this.collection}/${this.id}`), {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 404) {
            return new DocumentSnapshot({ id: this.id }, this.collection);
        }

        const data = await response.json();
        return new DocumentSnapshot({ id: this.id, ...data }, this.collection);
    }

    async set(obj, options = {}) {
        const token = await getAccessToken();
        const doc = objectToDoc(obj);

        let url = getFirestoreUrl(`/${this.collection}/${this.id}`);

        if (options.merge) {
            const updateMask = Object.keys(obj).map(k => `updateMask.fieldPaths=${k}`).join('&');
            url += `?${updateMask}`;
        }

        await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(doc)
        });
    }

    async update(obj) {
        const token = await getAccessToken();
        const doc = objectToDoc(obj);
        const updateMask = Object.keys(obj).map(k => `updateMask.fieldPaths=${k}`).join('&');

        await fetch(getFirestoreUrl(`/${this.collection}/${this.id}?${updateMask}`), {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(doc)
        });
    }

    async delete() {
        const token = await getAccessToken();
        await fetch(getFirestoreUrl(`/${this.collection}/${this.id}`), {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }
}

class TransactionBatch {
    constructor() {
        this.operations = [];
    }

    update(ref, data) {
        this.operations.push({ type: 'update', ref, data });
    }

    set(ref, data, options = {}) {
        this.operations.push({ type: 'set', ref, data, options });
    }

    async commit() {
        for (const op of this.operations) {
            if (op.type === 'update') {
                await op.ref.update(op.data);
            } else if (op.type === 'set') {
                await op.ref.set(op.data, op.options);
            }
        }
    }
}

// Singleton instance
let dbInstance = null;

export function getDb() {
    if (!dbInstance) {
        dbInstance = new FirestoreDB();
    }
    return dbInstance;
}

// Field value helpers (mimicking Admin SDK)
export const FieldValue = {
    increment: (n) => ({ __fieldTransform: 'increment', value: n }),
    serverTimestamp: () => ({ __fieldTransform: 'serverTimestamp' })
};

export function getAdmin() {
    return {
        firestore: {
            FieldValue
        }
    };
}
