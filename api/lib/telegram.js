
export async function sendTelegramNotification(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    // We will need the Admin's Chat ID. 
    // Since we don't have it yet, we'll try to read it from env, or log a warning.
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!botToken || !chatId) {
        console.warn('Telegram Bot Token or Admin Chat ID missing. Skipping notification.');
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
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
