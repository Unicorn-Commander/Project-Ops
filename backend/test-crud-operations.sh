#!/bin/bash

###############################################################################
# NorthbridgeTax CPA - CRUD Operations Integration Test Runner
#
# This script runs comprehensive integration tests for all entities
# and generates coverage reports.
#
# Usage:
#   ./test-crud-operations.sh                # Run all tests
#   ./test-crud-operations.sh --coverage     # Run with coverage report
#   ./test-crud-operations.sh --entity cases # Run specific entity tests
#   ./test-crud-operations.sh --watch        # Run in watch mode
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Print banner
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       NorthbridgeTax CPA - Integration Test Suite              ║${NC}"
echo -e "${BLUE}║       CRUD Operations & DTO Validation Testing             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse command line arguments
COVERAGE=false
ENTITY=""
WATCH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --coverage)
      COVERAGE=true
      shift
      ;;
    --entity)
      ENTITY="$2"
      shift 2
      ;;
    --watch)
      WATCH=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --coverage           Generate coverage report"
      echo "  --entity <name>      Run tests for specific entity (cases, users, contacts, tasks)"
      echo "  --watch              Run tests in watch mode"
      echo "  --help               Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                   # Run all integration tests"
      echo "  $0 --coverage        # Run all tests with coverage"
      echo "  $0 --entity cases    # Run only cases tests"
      echo "  $0 --watch           # Run in watch mode"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Check if .env.test exists
if [ ! -f .env.test ]; then
  echo -e "${YELLOW}⚠️  Warning: .env.test not found${NC}"
  echo "Creating .env.test from .env template..."

  if [ -f .env ]; then
    cp .env .env.test
    echo -e "${GREEN}✓ Created .env.test${NC}"
  else
    echo -e "${RED}✗ Error: No .env file found${NC}"
    echo "Please create .env.test with your test database configuration"
    exit 1
  fi
fi

# Ensure test database is ready
echo -e "${BLUE}🔧 Preparing test environment...${NC}"

# Run Prisma migrations on test database
echo "Running Prisma migrations..."
export DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d '=' -f2-)
npx prisma migrate deploy || {
  echo -e "${RED}✗ Failed to run migrations${NC}"
  exit 1
}

echo -e "${GREEN}✓ Test environment ready${NC}"
echo ""

# Build test command
TEST_CMD="jest --config ./tests/jest-integration.json"

if [ "$WATCH" = true ]; then
  TEST_CMD="$TEST_CMD --watch"
fi

if [ "$COVERAGE" = true ]; then
  TEST_CMD="$TEST_CMD --coverage"
fi

if [ -n "$ENTITY" ]; then
  echo -e "${BLUE}🧪 Running tests for entity: ${YELLOW}${ENTITY}${NC}"
  TEST_CMD="$TEST_CMD tests/integration/${ENTITY}.integration.test.ts"
else
  echo -e "${BLUE}🧪 Running all integration tests...${NC}"
  TEST_CMD="$TEST_CMD tests/integration/"
fi

echo ""
echo -e "${BLUE}Command: ${TEST_CMD}${NC}"
echo ""

# Run tests
$TEST_CMD

TEST_EXIT_CODE=$?

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                 ✓ ALL TESTS PASSED                         ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"

  if [ "$COVERAGE" = true ]; then
    echo ""
    echo -e "${BLUE}📊 Coverage report generated at:${NC}"
    echo -e "${YELLOW}   coverage/integration/lcov-report/index.html${NC}"
    echo ""
    echo "To view coverage report:"
    echo "  open coverage/integration/lcov-report/index.html"
  fi
else
  echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                 ✗ TESTS FAILED                             ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
fi

echo ""
exit $TEST_EXIT_CODE
