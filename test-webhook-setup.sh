#!/bin/bash

# Test Telegram Webhook Setup
# Replace YOUR_BOT_TOKEN with your actual bot token

BOT_TOKEN="${1:-YOUR_BOT_TOKEN}"

echo "=== Testing Telegram Webhook Setup ==="
echo ""

# 1. Get current webhook info
echo "1. Current Webhook Info:"
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | jq '.' || curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
echo ""
echo ""

# 2. Test webhook endpoint directly
echo "2. Testing Webhook Endpoint:"
echo "Sending test /start command..."
curl -X POST "https://smssub-website.vercel.app/api/telegram-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "message_id": 1,
      "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "Test"
      },
      "chat": {
        "id": 123456789,
        "first_name": "Test",
        "type": "private"
      },
      "date": 1733040000,
      "text": "/start"
    }
  }' -s | jq '.' || echo "Response received"
echo ""
echo ""

# 3. Instructions
echo "=== Instructions ==="
echo ""
echo "If webhook URL is not set or incorrect, set it with:"
echo ""
echo "curl -X POST \"https://api.telegram.org/bot${BOT_TOKEN}/setWebhook\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"url\": \"https://smssub-website.vercel.app/api/telegram-webhook\"}'"
echo ""
echo "Then check Vercel logs to see if webhook is receiving updates."

