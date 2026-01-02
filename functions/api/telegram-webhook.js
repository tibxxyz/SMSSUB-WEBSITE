/**
 * Telegram Webhook API for Cloudflare Pages Functions
 */
import { initFirebase, getDb, getAdmin } from '../lib/firebase.js';
import { sendTelegramNotification, sendPendingPaymentReminder } from '../lib/telegram.js';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

// Handle POST requests
export async function onRequestPost(context) {
    const { request, env } = context;

    console.log('=== TELEGRAM WEBHOOK CALLED ===');

    initFirebase(env);
    const db = getDb();

    try {
        const update = await request.json();
        console.log('Webhook update:', JSON.stringify(update, null, 2));

        if (!update) {
            return jsonResponse({ error: 'No update provided' }, 400);
        }

        // Handle callback queries (button clicks)
        if (update.callback_query) {
            console.log('Handling callback query:', update.callback_query.data);
            await handleCallbackQuery(update.callback_query, db, env);
            return jsonResponse({ ok: true });
        }

        // Handle commands
        if (update.message && update.message.text) {
            const text = update.message.text;
            if (text.startsWith('/')) {
                console.log('Handling command:', text);
                await handleCommand(update.message, db, env);
                return jsonResponse({ ok: true });
            }
        }

        return jsonResponse({ ok: true });
    } catch (error) {
        console.error('Telegram webhook error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

// Handle callback queries (button clicks)
async function handleCallbackQuery(callbackQuery, db, env) {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;
    const adminChatId = env.TELEGRAM_ADMIN_CHAT_ID;

    if (chatId.toString() !== adminChatId) {
        await answerCallbackQuery(callbackQuery.id, "❌ Unauthorized access", env);
        return;
    }

    try {
        if (data.startsWith('approve_')) {
            const paymentId = data.replace('approve_', '');
            await approvePaymentFromTelegram(paymentId, db, env, callbackQuery.id);
        } else if (data.startsWith('reject_')) {
            const paymentId = data.replace('reject_', '');
            await rejectPaymentFromTelegram(paymentId, db, env, callbackQuery.id);
        } else if (data.startsWith('delete_payment_')) {
            const paymentId = data.replace('delete_payment_', '');
            await deletePaymentFromTelegram(paymentId, db, env, callbackQuery.id);
        } else if (data.startsWith('delete_user_')) {
            const userEmail = decodeURIComponent(data.replace('delete_user_', ''));
            await deleteUserFromTelegram(userEmail, db, env, callbackQuery.id);
        } else if (data === 'list_users') {
            await listUsersFromTelegram(db, env, callbackQuery.id);
        } else if (data === 'list_pending') {
            await listPendingPayments(db, env);
            await answerCallbackQuery(callbackQuery.id, "Loading pending payments...", env);
        } else if (data === 'show_stats') {
            await sendStats(db, env);
            await answerCallbackQuery(callbackQuery.id, "Loading statistics...", env);
        } else if (data === 'show_monthly') {
            await sendMonthlyReport(db, env);
            await answerCallbackQuery(callbackQuery.id, "Generating monthly report...", env);
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await answerCallbackQuery(callbackQuery.id, "❌ Error processing request", env);
    }
}

// Handle commands
async function handleCommand(message, db, env) {
    const { text, chat } = message;
    const chatId = chat.id;
    const command = text.split(' ')[0].toLowerCase();
    const adminChatId = env.TELEGRAM_ADMIN_CHAT_ID;

    if (!adminChatId || chatId.toString() !== adminChatId) {
        await sendTelegramNotification("❌ Unauthorized access.", env, { chatId });
        return;
    }

    try {
        switch (command) {
            case '/start':
            case '/help':
                await sendHelpMessage(env);
                break;
            case '/pending':
                await listPendingPayments(db, env);
                break;
            case '/pending_alert':
                await sendPendingPaymentAlert(db, env);
                break;
            case '/users':
                await listUsersFromTelegram(db, env);
                break;
            case '/stats':
                await sendStats(db, env);
                break;
            case '/monthly':
                await sendMonthlyReport(db, env);
                break;
            case '/approve':
                const approveId = text.split(' ')[1];
                if (approveId) {
                    await approvePaymentFromTelegram(approveId, db, env);
                } else {
                    await sendTelegramNotification("❌ Usage: /approve <payment_id>", env);
                }
                break;
            case '/reject':
                const rejectId = text.split(' ')[1];
                if (rejectId) {
                    await rejectPaymentFromTelegram(rejectId, db, env);
                } else {
                    await sendTelegramNotification("❌ Usage: /reject <payment_id>", env);
                }
                break;
            case '/delete_payment':
                const deletePaymentId = text.split(' ')[1];
                if (deletePaymentId) {
                    await deletePaymentFromTelegram(deletePaymentId, db, env);
                } else {
                    await sendTelegramNotification("❌ Usage: /delete_payment <payment_id>", env);
                }
                break;
            case '/delete_user':
                const userEmail = text.split(' ')[1];
                if (userEmail) {
                    await deleteUserFromTelegram(userEmail, db, env);
                } else {
                    await sendTelegramNotification("❌ Usage: /delete_user <email>", env);
                }
                break;
            default:
                await sendTelegramNotification("❌ Unknown command. Use /help", env);
        }
    } catch (error) {
        console.error('Error handling command:', error);
        await sendTelegramNotification("❌ Error processing command", env);
    }
}

// Approve payment from Telegram
async function approvePaymentFromTelegram(paymentId, db, env, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found", env);
            return;
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'approved') {
            await answerCallbackQuery(callbackQueryId, "⚠️ Already approved", env);
            return;
        }

        const userEmail = paymentData.email;
        const creditsToAdd = Math.floor(paymentData.amount);
        const admin = getAdmin();

        await db.runTransaction(async (t) => {
            t.update(paymentRef, {
                status: 'approved',
                approvedBy: 'telegram_admin',
                approvedAt: new Date().toISOString()
            });

            const userRef = db.collection('users').doc(userEmail);
            t.set(userRef, {
                smsCredits: admin.firestore.FieldValue.increment(creditsToAdd),
                lastPaymentDate: new Date().toISOString(),
                subscriptionStatus: 'active'
            }, { merge: true });
        });

        await answerCallbackQuery(callbackQueryId, "✅ Payment approved!", env);
        await sendTelegramNotification(`
✅ <b>Payment Approved via Telegram</b>

<b>User:</b> ${userEmail}
<b>Amount:</b> $${paymentData.amount}
<b>Credits Added:</b> ${creditsToAdd} SMS
        `, env);
    } catch (error) {
        console.error('Error approving payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error approving", env);
    }
}

// Reject payment from Telegram
async function rejectPaymentFromTelegram(paymentId, db, env, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found", env);
            return;
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'rejected') {
            await answerCallbackQuery(callbackQueryId, "⚠️ Already rejected", env);
            return;
        }

        await paymentRef.update({
            status: 'rejected',
            rejectedBy: 'telegram_admin',
            rejectedAt: new Date().toISOString()
        });

        await answerCallbackQuery(callbackQueryId, "❌ Payment rejected", env);
        await sendTelegramNotification(`
❌ <b>Payment Rejected via Telegram</b>

<b>User:</b> ${paymentData.email}
<b>Amount:</b> $${paymentData.amount}
        `, env);
    } catch (error) {
        console.error('Error rejecting payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error rejecting", env);
    }
}

// Delete payment from Telegram
async function deletePaymentFromTelegram(paymentId, db, env, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found", env);
            return;
        }

        await paymentRef.delete();
        await answerCallbackQuery(callbackQueryId, "🗑️ Payment deleted", env);
        await sendTelegramNotification(`🗑️ <b>Payment Deleted</b>\nID: <code>${paymentId}</code>`, env);
    } catch (error) {
        console.error('Error deleting payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error deleting", env);
    }
}

// Delete user from Telegram
async function deleteUserFromTelegram(userEmail, db, env, callbackQueryId = null) {
    try {
        const userRef = db.collection('users').doc(userEmail);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ User not found", env);
            return;
        }

        await userRef.delete();
        await answerCallbackQuery(callbackQueryId, "🗑️ User deleted", env);
        await sendTelegramNotification(`🗑️ <b>User Deleted:</b> ${userEmail}`, env);
    } catch (error) {
        console.error('Error deleting user:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error deleting", env);
    }
}

// List pending payments
async function listPendingPayments(db, env) {
    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            await sendTelegramNotification("✅ No pending payments", env);
            return;
        }

        let message = `📋 <b>Pending Payments (${snapshot.size})</b>\n\n`;
        const buttons = [];

        let i = 0;
        snapshot.forEach((doc) => {
            i++;
            const data = doc.data();
            const paymentId = doc.id;
            const emailShort = (data.email || 'Unknown').split('@')[0];

            message += `${i}. <b>$${data.amount}</b> - ${data.email}\n`;
            message += `   TXID: <code>${data.txid}</code>\n\n`;

            buttons.push([
                { text: `✅ ${emailShort}`, callback_data: `approve_${paymentId}` },
                { text: `❌ ${emailShort}`, callback_data: `reject_${paymentId}` }
            ]);
        });

        await sendTelegramNotification(message, env, { inlineKeyboard: buttons });
    } catch (error) {
        console.error('Error listing pending:', error);
        await sendTelegramNotification("❌ Error fetching payments", env);
    }
}

// Send pending payment alert
async function sendPendingPaymentAlert(db, env) {
    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            await sendTelegramNotification("✅ No pending payments", env);
            return;
        }

        const payments = [];
        snapshot.forEach(doc => payments.push({ id: doc.id, ...doc.data() }));

        await sendPendingPaymentReminder(payments.length, payments, env);
    } catch (error) {
        console.error('Error sending alert:', error);
        await sendTelegramNotification("❌ Error", env);
    }
}

// List users from Telegram
async function listUsersFromTelegram(db, env, callbackQueryId = null) {
    try {
        const snapshot = await db.collection('users').limit(50).get();

        if (snapshot.empty) {
            await answerCallbackQuery(callbackQueryId, "No users", env);
            await sendTelegramNotification("📭 No users found", env);
            return;
        }

        let message = `👥 <b>Users (${snapshot.size})</b>\n\n`;
        const buttons = [];

        let i = 0;
        snapshot.forEach((doc) => {
            i++;
            const data = doc.data();
            const email = doc.id;
            const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || email.split('@')[0];
            const credits = data.smsCredits || 0;

            message += `${i}. <b>${name}</b>\n   ${email} | ${credits} SMS\n\n`;
            buttons.push([{ text: `🗑️ ${name}`, callback_data: `delete_user_${encodeURIComponent(email)}` }]);
        });

        await answerCallbackQuery(callbackQueryId, "Users listed", env);
        await sendTelegramNotification(message, env, { inlineKeyboard: buttons });
    } catch (error) {
        console.error('Error listing users:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error", env);
    }
}

// Send stats
async function sendStats(db, env) {
    try {
        const usersSnapshot = await db.collection('users').get();
        const paymentsSnapshot = await db.collection('payments').get();

        let totalRevenue = 0, pending = 0, approved = 0, totalCredits = 0;

        paymentsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'approved') {
                totalRevenue += data.amount;
                approved++;
            } else if (data.status === 'pending') {
                pending++;
            }
        });

        usersSnapshot.forEach(doc => {
            totalCredits += doc.data().smsCredits || 0;
        });

        await sendTelegramNotification(`
📊 <b>Statistics</b>

👥 Users: ${usersSnapshot.size}
💰 Revenue: $${totalRevenue.toFixed(2)}
✅ Approved: ${approved}
⏳ Pending: ${pending}
💳 Credits: ${totalCredits} SMS
        `, env);
    } catch (error) {
        console.error('Error sending stats:', error);
        await sendTelegramNotification("❌ Error", env);
    }
}

// Send monthly report
async function sendMonthlyReport(db, env) {
    try {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const usersSnapshot = await db.collection('users').get();
        const paymentsSnapshot = await db.collection('payments').get();

        let revenue = 0, payments = 0, newUsers = 0;

        paymentsSnapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? new Date(data.createdAt) : null;
            if (date && date >= firstDay && date <= lastDay && data.status === 'approved') {
                revenue += data.amount;
                payments++;
            }
        });

        usersSnapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? new Date(data.createdAt) : null;
            if (date && date >= firstDay && date <= lastDay) newUsers++;
        });

        const month = now.toLocaleString('default', { month: 'long', year: 'numeric' });

        await sendTelegramNotification(`
📈 <b>Monthly Report - ${month}</b>

👥 New users: ${newUsers}
💰 Revenue: $${revenue.toFixed(2)}
💳 Payments: ${payments}
        `, env);
    } catch (error) {
        console.error('Error:', error);
        await sendTelegramNotification("❌ Error", env);
    }
}

// Send help message
async function sendHelpMessage(env) {
    const message = `
🤖 <b>SMS Subscription Bot</b>

<b>Commands:</b>
/pending - List pending payments
/users - List users
/stats - Statistics
/monthly - Monthly report
/help - Show this message
    `;

    const inlineKeyboard = [
        [{ text: '📋 Pending', callback_data: 'list_pending' }, { text: '👥 Users', callback_data: 'list_users' }],
        [{ text: '📊 Stats', callback_data: 'show_stats' }, { text: '📈 Monthly', callback_data: 'show_monthly' }],
        [{ text: '🔗 Admin Panel', url: env.ADMIN_PANEL_URL || 'https://smssub-website.pages.dev/admin-panel.html' }]
    ];

    await sendTelegramNotification(message, env, { inlineKeyboard });
}

// Answer callback query
async function answerCallbackQuery(callbackQueryId, text, env) {
    if (!callbackQueryId) return;

    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: false
            })
        });
    } catch (error) {
        console.error('Error answering callback:', error);
    }
}
