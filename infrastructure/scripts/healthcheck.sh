#!/bin/bash

# NorthbridgeTax CPA Portal - Health Check Script
# Checks the health status of all services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

check_service() {
    local service_name=$1
    local url=$2
    local expected_status=${3:-200}

    printf "%-25s" "$service_name: "

    if curl -sf -o /dev/null -w "%{http_code}" "$url" | grep -q "$expected_status"; then
        echo -e "${GREEN}✓ Healthy${NC}"
        return 0
    else
        echo -e "${RED}✗ Unhealthy${NC}"
        return 1
    fi
}

check_docker_service() {
    local container_name=$1
    printf "%-25s" "$container_name: "

    if docker ps --filter "name=$container_name" --filter "status=running" | grep -q "$container_name"; then
        health=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "no-healthcheck")
        if [ "$health" = "healthy" ] || [ "$health" = "no-healthcheck" ]; then
            echo -e "${GREEN}✓ Running${NC}"
            return 0
        else
            echo -e "${YELLOW}⚠ Running (unhealthy)${NC}"
            return 1
        fi
    else
        echo -e "${RED}✗ Not Running${NC}"
        return 1
    fi
}

echo -e "${BLUE}NorthbridgeTax CPA Portal - Health Check${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

echo -e "${BLUE}Infrastructure Services:${NC}"
check_docker_service "northbridgetax-postgres"
check_docker_service "northbridgetax-redis"
check_docker_service "northbridgetax-minio"
check_docker_service "northbridgetax-keycloak"
check_docker_service "northbridgetax-temporal"

echo ""
echo -e "${BLUE}Application Services:${NC}"
check_service "Frontend" "http://localhost:3100" "200|301|302"
check_service "Backend API" "http://localhost:3101/health" "200"
check_service "Backend Swagger" "http://localhost:3101/api" "200"

echo ""
echo -e "${BLUE}Monitoring Services:${NC}"
check_service "Prometheus" "http://localhost:9091/-/healthy" "200"
check_service "Grafana" "http://localhost:3102/api/health" "200"
check_service "Temporal UI" "http://localhost:8089" "200"

echo ""
echo -e "${BLUE}Storage & Auth:${NC}"
check_service "MinIO Console" "http://localhost:9201/minio/health/live" "200"
check_service "Keycloak" "http://localhost:9100/health/ready" "200"

echo ""
echo -e "${BLUE}Service URLs:${NC}"
echo "  Frontend:        http://localhost:3100"
echo "  Backend API:     http://localhost:3101"
echo "  API Docs:        http://localhost:3101/api"
echo "  Keycloak:        http://localhost:9100"
echo "  MinIO Console:   http://localhost:9201"
echo "  Temporal UI:     http://localhost:8089"
echo "  Grafana:         http://localhost:3102"
echo "  Prometheus:      http://localhost:9091"