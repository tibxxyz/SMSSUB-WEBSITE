import { db } from './lib/firebase.js';
import { sendTelegramNotification, sendPendingPaymentReminder } from './lib/telegram.js';
import admin from 'firebase-admin';

export default async function handler(req, res) {
    console.log('=== TELEGRAM WEBHOOK CALLED ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Body:', JSON.stringify(req.body, null, 2));

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const update = req.body;

        if (!update) {
            console.error('No update in request body');
            return res.status(400).json({ error: 'No update provided' });
        }

        // Handle callback queries (button clicks)
        if (update.callback_query) {
            console.log('Handling callback query:', update.callback_query.data);
            await handleCallbackQuery(update.callback_query);
            return res.status(200).json({ ok: true });
        }

        // Handle commands (text messages starting with /)
        if (update.message && update.message.text) {
            const text = update.message.text;
            console.log('Received message:', text);
            
            if (text.startsWith('/')) {
                console.log('Handling command:', text);
                await handleCommand(update.message);
                return res.status(200).json({ ok: true });
            }
        }

        console.log('Update type not recognized, returning ok');
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Telegram webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// Handle callback queries (button clicks)
async function handleCallbackQuery(callbackQuery) {
    const { data, message, from } = callbackQuery;
    const chatId = message.chat.id;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // Verify admin chat ID
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (chatId.toString() !== adminChatId) {
        await answerCallbackQuery(callbackQuery.id, "❌ Unauthorized access");
        return;
    }

    try {
        if (data.startsWith('approve_')) {
            const paymentId = data.replace('approve_', '');
            await approvePaymentFromTelegram(paymentId, chatId, callbackQuery.id);
        } else if (data.startsWith('reject_')) {
            const paymentId = data.replace('reject_', '');
            await rejectPaymentFromTelegram(paymentId, chatId, callbackQuery.id);
        } else if (data.startsWith('delete_payment_')) {
            const paymentId = data.replace('delete_payment_', '');
            await deletePaymentFromTelegram(paymentId, chatId, callbackQuery.id);
        } else if (data.startsWith('delete_user_')) {
            const userEmail = decodeURIComponent(data.replace('delete_user_', ''));
            await deleteUserFromTelegram(userEmail, chatId, callbackQuery.id);
        } else if (data === 'list_users') {
            await listUsersFromTelegram(chatId, callbackQuery.id);
        } else if (data === 'list_pending') {
            await listPendingPayments(chatId);
            await answerCallbackQuery(callbackQuery.id, "Loading pending payments...");
        } else if (data === 'show_stats') {
            await sendStats(chatId);
            await answerCallbackQuery(callbackQuery.id, "Loading statistics...");
        } else if (data === 'show_monthly') {
            await sendMonthlyReport(chatId);
            await answerCallbackQuery(callbackQuery.id, "Generating monthly report...");
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await answerCallbackQuery(callbackQuery.id, "❌ Error processing request");
    }
}

// Handle commands (text messages)
async function handleCommand(message) {
    const { text, chat } = message;
    const chatId = chat.id;
    const command = text.split(' ')[0].toLowerCase();

    console.log(`Handling command: ${command} from chatId: ${chatId}`);

    // Verify admin chat ID
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!adminChatId) {
        console.error('TELEGRAM_ADMIN_CHAT_ID not set!');
        return;
    }
    
    if (chatId.toString() !== adminChatId) {
        console.log(`Unauthorized access attempt from chatId: ${chatId}, expected: ${adminChatId}`);
        await sendTelegramNotification("❌ Unauthorized access. Only admins can use commands.", { chatId });
        return;
    }

    try {
        switch (command) {
            case '/start':
            case '/help':
                await sendHelpMessage(chatId);
                break;
            case '/pending':
                await listPendingPayments(chatId);
                break;
            case '/pending_alert':
                await sendPendingPaymentAlert(chatId);
                break;
            case '/users':
                await listUsersFromTelegram(chatId);
                break;
            case '/stats':
                await sendStats(chatId);
                break;
            case '/monthly':
                await sendMonthlyReport(chatId);
                break;
            case '/approve':
                const approveId = text.split(' ')[1];
                if (approveId) {
                    await approvePaymentFromTelegram(approveId, chatId);
                } else {
                    await sendTelegramNotification("❌ Usage: /approve <payment_id>");
                }
                break;
            case '/reject':
                const rejectId = text.split(' ')[1];
                if (rejectId) {
                    await rejectPaymentFromTelegram(rejectId, chatId);
                } else {
                    await sendTelegramNotification("❌ Usage: /reject <payment_id>");
                }
                break;
            case '/delete_payment':
                const deletePaymentId = text.split(' ')[1];
                if (deletePaymentId) {
                    await deletePaymentFromTelegram(deletePaymentId, chatId);
                } else {
                    await sendTelegramNotification("❌ Usage: /delete_payment <payment_id>");
                }
                break;
            case '/delete_user':
                const userEmail = text.split(' ')[1];
                if (userEmail) {
                    await deleteUserFromTelegram(userEmail, chatId);
                } else {
                    await sendTelegramNotification("❌ Usage: /delete_user <email>");
                }
                break;
            default:
                await sendTelegramNotification("❌ Unknown command. Use /help for available commands.");
        }
    } catch (error) {
        console.error('Error handling command:', error);
        await sendTelegramNotification("❌ Error processing command");
    }
}

// Approve payment from Telegram
async function approvePaymentFromTelegram(paymentId, chatId, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found");
            await sendTelegramNotification("❌ Payment not found");
            return;
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'approved') {
            await answerCallbackQuery(callbackQueryId, "⚠️ Payment already approved");
            await sendTelegramNotification("⚠️ Payment already approved");
            return;
        }

        const userEmail = paymentData.email;
        const creditsToAdd = Math.floor(paymentData.amount);

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

        await answerCallbackQuery(callbackQueryId, "✅ Payment approved!");
        await sendTelegramNotification(`
✅ <b>Payment Approved via Telegram</b>

<b>User:</b> ${userEmail}
<b>Amount:</b> $${paymentData.amount}
<b>Credits Added:</b> ${creditsToAdd} SMS
<b>Payment ID:</b> <code>${paymentId}</code>
        `);
    } catch (error) {
        console.error('Error approving payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error approving payment");
    }
}

// Reject payment from Telegram
async function rejectPaymentFromTelegram(paymentId, chatId, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found");
            return;
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status === 'rejected') {
            await answerCallbackQuery(callbackQueryId, "⚠️ Payment already rejected");
            return;
        }

        await paymentRef.update({
            status: 'rejected',
            rejectedBy: 'telegram_admin',
            rejectedAt: new Date().toISOString()
        });

        await answerCallbackQuery(callbackQueryId, "❌ Payment rejected");
        await sendTelegramNotification(`
❌ <b>Payment Rejected via Telegram</b>

<b>User:</b> ${paymentData.email}
<b>Amount:</b> $${paymentData.amount}
<b>Payment ID:</b> <code>${paymentId}</code>
        `);
    } catch (error) {
        console.error('Error rejecting payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error rejecting payment");
    }
}

// Delete payment from Telegram
async function deletePaymentFromTelegram(paymentId, chatId, callbackQueryId = null) {
    try {
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ Payment not found");
            return;
        }

        await paymentRef.delete();
        await answerCallbackQuery(callbackQueryId, "🗑️ Payment deleted");
        await sendTelegramNotification(`
🗑️ <b>Payment Deleted via Telegram</b>

<b>Payment ID:</b> <code>${paymentId}</code>
        `);
    } catch (error) {
        console.error('Error deleting payment:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error deleting payment");
    }
}

// Delete user from Telegram
async function deleteUserFromTelegram(userEmail, chatId, callbackQueryId = null) {
    try {
        const userRef = db.collection('users').doc(userEmail);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            await answerCallbackQuery(callbackQueryId, "❌ User not found");
            await sendTelegramNotification("❌ User not found");
            return;
        }

        await userRef.delete();
        await answerCallbackQuery(callbackQueryId, "🗑️ User deleted");
        await sendTelegramNotification(`
🗑️ <b>User Deleted via Telegram</b>

<b>Email:</b> ${userEmail}
        `);
    } catch (error) {
        console.error('Error deleting user:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error deleting user");
    }
}

// List pending payments
async function listPendingPayments(chatId) {
    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            await sendTelegramNotification("✅ No pending payments");
            return;
        }

        let message = `📋 <b>Pending Payments (${snapshot.size})</b>\n\n`;
        const buttons = [];

        snapshot.forEach((doc, index) => {
            const data = doc.data();
            const paymentId = doc.id;
            const date = new Date(data.createdAt).toLocaleDateString();
            
            message += `${index + 1}. <b>$${data.amount}</b> - ${data.email}\n`;
            message += `   TXID: <code>${data.txid}</code>\n`;
            message += `   Date: ${date}\n`;
            message += `   ID: <code>${paymentId}</code>\n\n`;

            buttons.push([
                {
                    text: `✅ Approve ${index + 1}`,
                    callback_data: `approve_${paymentId}`
                },
                {
                    text: `❌ Reject ${index + 1}`,
                    callback_data: `reject_${paymentId}`
                },
                {
                    text: `🗑️ Delete ${index + 1}`,
                    callback_data: `delete_payment_${paymentId}`
                }
            ]);
        });

        await sendTelegramNotification(message, { inlineKeyboard: buttons });
    } catch (error) {
        console.error('Error listing pending payments:', error);
        await sendTelegramNotification("❌ Error fetching pending payments");
    }
}

// Send pending payment alert
async function sendPendingPaymentAlert(chatId) {
    try {
        const snapshot = await db.collection('payments')
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            await sendTelegramNotification("✅ No pending payments - all clear!");
            return;
        }

        const payments = [];
        snapshot.forEach(doc => {
            payments.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort by creation date (oldest first)
        payments.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateA - dateB;
        });

        await sendPendingPaymentReminder(payments.length, payments);
    } catch (error) {
        console.error('Error sending pending payment alert:', error);
        await sendTelegramNotification("❌ Error fetching pending payments");
    }
}

// List users from Telegram
async function listUsersFromTelegram(chatId, callbackQueryId = null) {
    try {
        const snapshot = await db.collection('users').limit(50).get();

        if (snapshot.empty) {
            await answerCallbackQuery(callbackQueryId, "No users found");
            await sendTelegramNotification("📭 No users found");
            return;
        }

        let message = `👥 <b>Users (${snapshot.size})</b>\n\n`;
        const buttons = [];

        snapshot.forEach((doc, index) => {
            const data = doc.data();
            const email = doc.id;
            const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'N/A';
            const credits = data.smsCredits || 0;
            const date = data.createdAt || data.updatedAt || 'N/A';
            
            message += `${index + 1}. <b>${name}</b>\n`;
            message += `   Email: ${email}\n`;
            message += `   Credits: ${credits} SMS\n`;
            message += `   Date: ${date}\n\n`;

            buttons.push([
                {
                    text: `🗑️ Delete ${name || email.split('@')[0]}`,
                    callback_data: `delete_user_${encodeURIComponent(email)}`
                }
            ]);
        });

        await answerCallbackQuery(callbackQueryId, "Users listed");
        await sendTelegramNotification(message, { inlineKeyboard: buttons });
    } catch (error) {
        console.error('Error listing users:', error);
        await answerCallbackQuery(callbackQueryId, "❌ Error fetching users");
        await sendTelegramNotification("❌ Error fetching users");
    }
}

// Send stats
async function sendStats(chatId) {
    try {
        const usersSnapshot = await db.collection('users').get();
        const paymentsSnapshot = await db.collection('payments').get();
        
        let totalRevenue = 0;
        let pendingPayments = 0;
        let approvedPayments = 0;
        let totalCredits = 0;

        paymentsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'approved') {
                totalRevenue += data.amount;
                approvedPayments++;
            } else if (data.status === 'pending') {
                pendingPayments++;
            }
        });

        usersSnapshot.forEach(doc => {
            const data = doc.data();
            totalCredits += data.smsCredits || 0;
        });

        const message = `
📊 <b>System Statistics</b>

👥 <b>Users:</b> ${usersSnapshot.size}
💰 <b>Total Revenue:</b> $${totalRevenue.toFixed(2)}
✅ <b>Approved Payments:</b> ${approvedPayments}
⏳ <b>Pending Payments:</b> ${pendingPayments}
💳 <b>Total Credits Issued:</b> ${totalCredits} SMS
        `;

        await sendTelegramNotification(message);
    } catch (error) {
        console.error('Error sending stats:', error);
        await sendTelegramNotification("❌ Error fetching statistics");
    }
}

// Send monthly growth report
async function sendMonthlyReport(chatId) {
    try {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        // Get all users
        const allUsersSnapshot = await db.collection('users').get();
        const totalUsers = allUsersSnapshot.size;

        // Get users created this month
        const newUsersThisMonth = [];
        allUsersSnapshot.forEach(doc => {
            const data = doc.data();
            const createdAt = data.createdAt ? new Date(data.createdAt) : null;
            if (createdAt && createdAt >= firstDayOfMonth && createdAt <= lastDayOfMonth) {
                newUsersThisMonth.push({ email: doc.id, ...data });
            }
        });

        // Get all payments
        const allPaymentsSnapshot = await db.collection('payments').get();
        
        let monthlyRevenue = 0;
        let monthlyPayments = 0;
        let monthlyCredits = 0;
        let pendingPayments = 0;

        allPaymentsSnapshot.forEach(doc => {
            const data = doc.data();
            const createdAt = data.createdAt ? new Date(data.createdAt) : null;
            
            if (createdAt && createdAt >= firstDayOfMonth && createdAt <= lastDayOfMonth) {
                if (data.status === 'approved') {
                    monthlyRevenue += data.amount;
                    monthlyCredits += Math.floor(data.amount);
                    monthlyPayments++;
                } else if (data.status === 'pending') {
                    pendingPayments++;
                }
            }
        });

        // Calculate growth (compare with previous month)
        const previousMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        
        let previousMonthRevenue = 0;
        let previousMonthUsers = 0;

        allPaymentsSnapshot.forEach(doc => {
            const data = doc.data();
            const createdAt = data.createdAt ? new Date(data.createdAt) : null;
            if (createdAt && createdAt >= previousMonthFirst && createdAt <= previousMonthLast && data.status === 'approved') {
                previousMonthRevenue += data.amount;
            }
        });

        allUsersSnapshot.forEach(doc => {
            const data = doc.data();
            const createdAt = data.createdAt ? new Date(data.createdAt) : null;
            if (createdAt && createdAt >= previousMonthFirst && createdAt <= previousMonthLast) {
                previousMonthUsers++;
            }
        });

        const revenueGrowth = previousMonthRevenue > 0 
            ? ((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue * 100).toFixed(1)
            : 'N/A';
        const userGrowth = previousMonthUsers > 0
            ? ((newUsersThisMonth.length - previousMonthUsers) / previousMonthUsers * 100).toFixed(1)
            : 'N/A';

        const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

        const message = `
📈 <b>Monthly Growth Report - ${monthName}</b>

👥 <b>Users:</b>
   • New this month: ${newUsersThisMonth.length}
   • Total users: ${totalUsers}
   • Growth: ${userGrowth !== 'N/A' ? (userGrowth > 0 ? '+' : '') + userGrowth + '%' : 'N/A'}

💰 <b>Revenue:</b>
   • This month: $${monthlyRevenue.toFixed(2)}
   • Last month: $${previousMonthRevenue.toFixed(2)}
   • Growth: ${revenueGrowth !== 'N/A' ? (revenueGrowth > 0 ? '+' : '') + revenueGrowth + '%' : 'N/A'}

💳 <b>Payments:</b>
   • Approved: ${monthlyPayments}
   • Pending: ${pendingPayments}
   • Credits issued: ${monthlyCredits} SMS

${pendingPayments > 0 ? '⚠️ <b>Action Required:</b> ' + pendingPayments + ' payment(s) need approval' : '✅ All payments processed'}
        `;

        await sendTelegramNotification(message);
    } catch (error) {
        console.error('Error sending monthly report:', error);
        await sendTelegramNotification("❌ Error generating monthly report");
    }
}

// Send help message
async function sendHelpMessage(chatId) {
    console.log('Sending help message to chatId:', chatId);
    const message = `
🤖 <b>Welcome to SMS Subscription Bot!</b>

Use the buttons below to quickly access features, or type commands manually.

<b>Quick Actions:</b>
• Tap buttons below for instant access
• Payment notifications include action buttons
• User lists include delete buttons

<b>Available Commands:</b>
/pending - List pending payments
/users - List all users
/stats - Current statistics
/monthly - Monthly growth report
/help - Show this message
    `;
    
    const inlineKeyboard = [
        [
            {
                text: '📋 Pending Payments',
                callback_data: 'list_pending'
            },
            {
                text: '👥 View Users',
                callback_data: 'list_users'
            }
        ],
        [
            {
                text: '📊 Statistics',
                callback_data: 'show_stats'
            },
            {
                text: '📈 Monthly Report',
                callback_data: 'show_monthly'
            }
        ],
        [
            {
                text: '🔗 Open Admin Panel',
                url: process.env.ADMIN_PANEL_URL || 'https://smssub-website.vercel.app/admin-panel.html'
            }
        ]
    ];
    
    await sendTelegramNotification(message, { chatId, inlineKeyboard });
}

// Answer callback query
async function answerCallbackQuery(callbackQueryId, text) {
    if (!callbackQueryId) return;
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    
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
        console.error('Error answering callback query:', error);
    }
}

