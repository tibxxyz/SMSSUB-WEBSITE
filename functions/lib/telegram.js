/**
 * Telegram notification utilities for Cloudflare Workers
 */

/**
 * Send a Telegram notification
 * @param {string} message - The message to send (supports HTML)
 * @param {Object} env - Cloudflare environment bindings
 * @param {Object} options - Optional parameters
 */
export async function sendTelegramNotification(message, env, options = {}) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = options.chatId || env.TELEGRAM_ADMIN_CHAT_ID;

    if (!botToken || !chatId) {
        console.warn('Telegram Bot Token or Admin Chat ID missing. Skipping notification.');
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const payload = {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: options.disablePreview || false
        };

        if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
            payload.reply_markup = {
                inline_keyboard: options.inlineKeyboard
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('Telegram API Error:', data);
        } else {
            console.log('Telegram notification sent successfully.');
        }
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}

/**
 * Send a payment notification with approve/reject buttons
 * @param {string} email - User email
 * @param {number} amount - Payment amount
 * @param {string} txid - Transaction ID
 * @param {string} paymentId - Payment document ID
 * @param {Object} env - Cloudflare environment bindings
 */
export async function sendPaymentNotificationWithButtons(email, amount, txid, paymentId, env) {
    const message = `
💰 <b>New Payment Request - PENDING APPROVAL!</b>

⚠️ <b>Action Required:</b> This payment needs your approval

<b>User:</b> ${email}
<b>Amount:</b> $${amount}
<b>TXID:</b> <code>${txid}</code>
<b>Payment ID:</b> <code>${paymentId}</code>
<b>Status:</b> ⏳ <b>PENDING</b>

<i>Tap a button below to approve or reject immediately.</i>
    `;

    const inlineKeyboard = [
        [
            { text: '✅ Approve Payment', callback_data: `approve_${paymentId}` },
            { text: '❌ Reject Payment', callback_data: `reject_${paymentId}` }
        ],
        [
            { text: '🗑️ Delete Payment', callback_data: `delete_payment_${paymentId}` }
        ],
        [
            { text: '🔗 Open Admin Panel', url: env.ADMIN_PANEL_URL || 'https://smssub-website.pages.dev/admin-panel.html' }
        ]
    ];

    await sendTelegramNotification(message, env, { inlineKeyboard });
}

/**
 * Send a reminder notification for pending payments
 * @param {number} pendingCount - Number of pending payments
 * @param {Array} payments - Array of pending payment objects
 * @param {Object} env - Cloudflare environment bindings
 */
export async function sendPendingPaymentReminder(pendingCount, payments = [], env) {
    if (pendingCount === 0) return;

    let message = `
⚠️ <b>PENDING PAYMENT ALERT!</b>

<b>${pendingCount} payment(s) awaiting approval</b>

`;

    if (payments.length > 0) {
        message += `<b>Recent Pending Payments:</b>\n\n`;
        payments.slice(0, 5).forEach((payment, index) => {
            const date = payment.createdAt ? new Date(payment.createdAt).toLocaleDateString() : 'N/A';
            message += `${index + 1}. <b>$${payment.amount}</b> - ${payment.email}\n`;
            message += `   ID: <code>${payment.id}</code> | Date: ${date}\n\n`;
        });

        if (pendingCount > 5) {
            message += `... and ${pendingCount - 5} more\n\n`;
        }
    }

    message += `Use /pending to see all pending payments with action buttons.`;

    const inlineKeyboard = [
        [{ text: '📋 View Pending Payments', callback_data: 'list_pending' }],
        [{ text: '🔗 Open Admin Panel', url: env.ADMIN_PANEL_URL || 'https://smssub-website.pages.dev/admin-panel.html' }]
    ];

    await sendTelegramNotification(message, env, { inlineKeyboard });
}

/**
 * Send a daily summary notification
 * @param {Object} stats - Statistics object
 * @param {Object} env - Cloudflare environment bindings
 */
export async function sendDailySummary(stats, env) {
    const {
        newUsers = 0,
        newPayments = 0,
        totalRevenue = 0,
        pendingPayments = 0,
        totalUsers = 0,
        totalCredits = 0
    } = stats;

    const message = `
📊 <b>Daily Summary Report</b>

👥 <b>Users:</b>
   • New today: ${newUsers}
   • Total: ${totalUsers}

💰 <b>Payments:</b>
   • New today: ${newPayments}
   • Pending: ${pendingPayments}
   • Revenue today: $${totalRevenue.toFixed(2)}

💳 <b>Credits:</b>
   • Total credits issued: ${totalCredits}

${pendingPayments > 0 ? '⚠️ <b>Action Required:</b> ' + pendingPayments + ' payment(s) need approval' : '✅ All payments processed'}
    `;

    await sendTelegramNotification(message, env);
}
