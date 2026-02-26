#!/bin/bash

# Manual test to verify throttle with detailed output
API="http://localhost:3101/api/v1"

echo "=== Testing Login Rate Limiting ==="
echo "Making 7 rapid requests..."
echo ""

for i in {1..7}; do
  echo -n "Request $i: "
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}" \
    -X POST "${API}/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}')
  
  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
  TIME=$(echo "$RESPONSE" | grep "TIME:" | cut -d: -f2)
  
  if [ "$HTTP_CODE" = "429" ]; then
    echo "THROTTLED (429) in ${TIME}s"
    BODY=$(echo "$RESPONSE" | head -1)
    echo "  Response: $BODY"
  elif [ "$HTTP_CODE" = "401" ]; then
    echo "SUCCESS (401 - invalid creds) in ${TIME}s"
  else
    echo "HTTP $HTTP_CODE in ${TIME}s"
  fi
  
  sleep 0.2
done
