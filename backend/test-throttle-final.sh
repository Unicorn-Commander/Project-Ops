#!/bin/bash

echo "=== Testing Login Rate Limiting (5 attempts/minute) ==="
echo ""

for i in {1..8}; do
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "http://localhost:3101/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrongpassword"}')

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

  if [ "$HTTP_CODE" = "429" ]; then
    echo "✓ Attempt $i: HTTP $HTTP_CODE - RATE LIMITED!"
    MSG=$(echo "$BODY" | jq -r '.message' 2>/dev/null || echo "ThrottlerException")
    echo "  Message: $MSG"
  elif [ "$HTTP_CODE" = "401" ]; then
    echo "  Attempt $i: HTTP $HTTP_CODE - Allowed (invalid credentials)"
  else
    echo "  Attempt $i: HTTP $HTTP_CODE"
  fi

  sleep 0.3
done

echo ""
echo "If attempts 6-8 show 'RATE LIMITED' above, rate limiting is working!"
