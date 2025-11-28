import { db } from '../../lib/firebase';
import { sendTelegramNotification } from '../../lib/telegram';

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

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, amount, txid } = req.body;

        if (!email || !amount || !txid) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const paymentRequest = {
            email,
            amount: parseFloat(amount),
            txid,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save to 'payments' collection in Firestore
        await db.collection('payments').add(paymentRequest);

        // Send Telegram Notification
        const message = `
<b>💰 New Payment Request!</b>

<b>User:</b> ${email}
<b>Amount:</b> $${amount}
<b>TXID:</b> <code>${txid}</code>

<i>Check Admin Panel to approve.</i>
        `;

        // Don't await this, let it run in background so user doesn't wait
        sendTelegramNotification(message).catch(console.error);

        return res.status(200).json({
            success: true,
            message: 'Payment submitted for review'
        });

    } catch (error) {
        console.error('Payment submission error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}
