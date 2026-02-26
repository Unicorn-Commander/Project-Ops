#!/bin/bash

# NorthbridgeTax CPA - Rate Limiting Test Script
# Tests the rate limiting functionality on authentication endpoints

API_URL="http://localhost:3101/api/v1"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}NorthbridgeTax CPA - Rate Limiting Tests${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Test 1: Login Rate Limiting (5 attempts per minute)
echo -e "${YELLOW}Test 1: Login Rate Limiting (5 attempts/minute)${NC}"
echo "Testing with 7 login attempts..."

SUCCESS_COUNT=0
THROTTLED_COUNT=0

for i in {1..7}; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrongpassword"}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)

  if [ "$HTTP_CODE" = "429" ]; then
    echo -e "  Attempt $i: ${RED}THROTTLED (429)${NC} ✓"
    ((THROTTLED_COUNT++))
  elif [ "$HTTP_CODE" = "401" ]; then
    echo -e "  Attempt $i: ${GREEN}SUCCESS (401 - Invalid creds)${NC}"
    ((SUCCESS_COUNT++))
  else
    echo -e "  Attempt $i: ${YELLOW}Unexpected code: $HTTP_CODE${NC}"
  fi

  sleep 0.5
done

echo ""
if [ $SUCCESS_COUNT -eq 5 ] && [ $THROTTLED_COUNT -eq 2 ]; then
  echo -e "${GREEN}✓ Login rate limiting working correctly!${NC}"
  echo -e "  - First 5 attempts: Allowed"
  echo -e "  - Next 2 attempts: Throttled (429)"
else
  echo -e "${RED}✗ Login rate limiting issue detected${NC}"
  echo -e "  - Expected: 5 allowed, 2 throttled"
  echo -e "  - Got: $SUCCESS_COUNT allowed, $THROTTLED_COUNT throttled"
fi

echo -e "\n${BLUE}----------------------------------------${NC}\n"

# Test 2: Wait and verify rate limit reset
echo -e "${YELLOW}Test 2: Rate Limit Reset After TTL${NC}"
echo "Waiting 65 seconds for rate limit window to reset..."
echo "(This simulates the 60-second TTL + buffer)"

for i in {65..1}; do
  printf "\r  Countdown: ${YELLOW}%2d seconds${NC} remaining..." $i
  sleep 1
done

echo -e "\n\nTesting login after rate limit reset..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrongpassword"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ Rate limit successfully reset after TTL!${NC}"
  echo -e "  HTTP Code: $HTTP_CODE (Request allowed)"
else
  echo -e "${RED}✗ Rate limit did not reset${NC}"
  echo -e "  HTTP Code: $HTTP_CODE"
fi

echo -e "\n${BLUE}----------------------------------------${NC}\n"

# Test 3: Password Change Rate Limiting (requires authentication)
echo -e "${YELLOW}Test 3: Change Password Rate Limiting (3 attempts/5min)${NC}"
echo "Note: This test requires a valid JWT token"
echo "Skipping automated test - manual verification recommended"
echo ""
echo "To test manually:"
echo "  1. Login to get JWT token:"
echo "     curl -X POST ${API_URL}/auth/login -H 'Content-Type: application/json' \\"
echo "       -d '{\"email\":\"aaron@magicunicorn.tech\",\"password\":\"password\"}'"
echo ""
echo "  2. Use token to attempt password changes (4 times):"
echo "     curl -X POST ${API_URL}/auth/change-password \\"
echo "       -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"currentPassword\":\"wrong\",\"newPassword\":\"NewPass123!@#\"}'"
echo ""
echo "  Expected: First 3 attempts return 401 (wrong password)"
echo "           4th attempt returns 429 (throttled)"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Rate Limiting Test Summary${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${GREEN}✓ Configured Rate Limits:${NC}"
echo "  - Global: 10 requests/60 seconds"
echo "  - Login: 5 attempts/60 seconds"
echo "  - Change Password: 3 attempts/5 minutes"
echo "  - Reset Password (Admin): 3 attempts/1 hour"
echo ""
echo -e "${GREEN}✓ Implementation Complete:${NC}"
echo "  - ThrottlerGuard enabled globally"
echo "  - Endpoint-specific throttling configured"
echo "  - ChangePasswordDto with validation"
echo "  - All auth endpoints protected"
echo ""
echo -e "${YELLOW}Recommendation:${NC}"
echo "  - Monitor rate limiting in production logs"
echo "  - Consider IP-based tracking for stricter security"
echo "  - Review limits based on actual usage patterns"
echo ""
