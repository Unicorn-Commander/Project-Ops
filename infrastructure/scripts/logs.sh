#!/bin/bash

# NorthbridgeTax CPA Portal - Logs Viewer
# View logs for all services or specific service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../docker/docker-compose.yml"

# Colors
BLUE='\033[0;34m'
NC='\033[0m'

show_help() {
    echo "Usage: $0 [service_name] [options]"
    echo ""
    echo "Services:"
    echo "  postgres, redis, minio, keycloak, temporal"
    echo "  backend, frontend, prometheus, grafana"
    echo ""
    echo "Options:"
    echo "  -f, --follow    Follow log output"
    echo "  -n, --tail N    Number of lines to show (default: 100)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Show all logs"
    echo "  $0 backend -f         # Follow backend logs"
    echo "  $0 postgres -n 50     # Show last 50 lines of postgres logs"
}

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

echo -e "${BLUE}NorthbridgeTax CPA Portal - Service Logs${NC}"
echo -e "${BLUE}===================================${NC}"
echo ""

if [ -z "$1" ]; then
    # Show all logs
    docker-compose -f "$COMPOSE_FILE" logs --tail=100
else
    # Show specific service logs
    SERVICE=$1
    shift
    docker-compose -f "$COMPOSE_FILE" logs "$@" "$SERVICE"
fi