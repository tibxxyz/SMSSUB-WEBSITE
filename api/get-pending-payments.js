import { db } from '../lib/firebase';
import { checkAdminStatus } from './check-admin.js';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get adminEmail from query (GET) or body (POST)
        const adminEmail = req.method === 'POST' ? req.body.adminEmail : req.query.adminEmail;

        // Check admin status
        if (!adminEmail) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'Admin authentication required'
            });
        }

        const isAdmin = await checkAdminStatus(adminEmail);
        if (!isAdmin) {
            console.warn(`Unauthorized admin access attempt: ${adminEmail}`);
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'Admin access required. You do not have permission to view pending payments.'
            });
        }

        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });

        return res.status(200).json({
            success: true,
            payments
        });

    } catch (error) {
        console.error('Error fetching payments:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}
