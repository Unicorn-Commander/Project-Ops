#!/bin/bash

# NorthbridgeTax CPA Portal - Setup Script
# This script initializes the entire infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infrastructure"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    log_info "Checking Docker installation..."
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    log_success "Docker and Docker Compose are installed"
}

# Create necessary directories
create_directories() {
    log_info "Creating necessary directories..."

    mkdir -p "$PROJECT_ROOT/backend/logs"
    mkdir -p "$PROJECT_ROOT/backend/uploads"
    mkdir -p "$INFRA_DIR/database/backups"
    mkdir -p "$INFRA_DIR/config/redis"
    mkdir -p "$INFRA_DIR/config/temporal"
    mkdir -p "$INFRA_DIR/config/minio/policies"
    mkdir -p "$INFRA_DIR/config/keycloak/themes"
    mkdir -p "$INFRA_DIR/monitoring/grafana/provisioning/datasources"
    mkdir -p "$INFRA_DIR/monitoring/grafana/provisioning/dashboards"
    mkdir -p "$INFRA_DIR/monitoring/grafana/dashboards"

    log_success "Directories created"
}

# Generate secrets
generate_secrets() {
    log_info "Generating secure secrets..."

    if [ ! -f "$INFRA_DIR/docker/.env" ]; then
        cp "$INFRA_DIR/docker/.env.example" "$INFRA_DIR/docker/.env"

        # Generate random passwords
        POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        KEYCLOAK_DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        MINIO_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        MINIO_APP_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        TEMPORAL_DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
        BACKEND_CLIENT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
        GRAFANA_CLIENT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

        # Update .env file
        sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/KEYCLOAK_ADMIN_PASSWORD=.*/KEYCLOAK_ADMIN_PASSWORD=$KEYCLOAK_ADMIN_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/KEYCLOAK_DB_PASSWORD=.*/KEYCLOAK_DB_PASSWORD=$KEYCLOAK_DB_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/MINIO_ROOT_PASSWORD=.*/MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/MINIO_APP_PASSWORD=.*/MINIO_APP_PASSWORD=$MINIO_APP_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDIS_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/TEMPORAL_DB_PASSWORD=.*/TEMPORAL_DB_PASSWORD=$TEMPORAL_DB_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/GRAFANA_ADMIN_PASSWORD=.*/GRAFANA_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD/" "$INFRA_DIR/docker/.env"
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$INFRA_DIR/docker/.env"
        sed -i "s/BACKEND_KEYCLOAK_CLIENT_SECRET=.*/BACKEND_KEYCLOAK_CLIENT_SECRET=$BACKEND_CLIENT_SECRET/" "$INFRA_DIR/docker/.env"
        sed -i "s/GRAFANA_OAUTH_CLIENT_SECRET=.*/GRAFANA_OAUTH_CLIENT_SECRET=$GRAFANA_CLIENT_SECRET/" "$INFRA_DIR/docker/.env"

        log_success "Secrets generated and saved to .env file"
    else
        log_warning ".env file already exists. Skipping secret generation."
    fi
}

# Create web network if it doesn't exist
create_network() {
    log_info "Creating Docker network..."

    if ! docker network ls | grep -q "web"; then
        docker network create web
        log_success "Docker network 'web' created"
    else
        log_info "Docker network 'web' already exists"
    fi
}

# Initialize database
init_database() {
    log_info "Initializing database..."

    # Wait for PostgreSQL to be ready
    sleep 10

    cd "$PROJECT_ROOT/prisma"

    if [ -f "package.json" ]; then
        npm install
        npx prisma generate
        npx prisma migrate deploy
        log_success "Database initialized with Prisma migrations"
    else
        log_warning "Prisma not configured yet. Skipping database initialization."
    fi
}

# Start services
start_services() {
    log_info "Starting services..."

    cd "$INFRA_DIR/docker"

    # Start infrastructure services first
    docker-compose up -d postgres redis minio keycloak-postgres keycloak temporal-postgres temporal

    log_info "Waiting for services to be healthy..."
    sleep 30

    # Start monitoring
    docker-compose up -d prometheus grafana

    # Start applications
    docker-compose up -d backend frontend

    log_success "All services started"
}

# Display service URLs
show_urls() {
    echo ""
    log_success "NorthbridgeTax CPA Portal is now running!"
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
    echo ""
    echo -e "${YELLOW}Default Credentials:${NC}"
    echo "  Keycloak Admin:"
    echo "    Username: admin"
    echo "    Password: (check .env file)"
    echo ""
    echo "  Grafana:"
    echo "    Username: admin"
    echo "    Password: (check .env file)"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "  1. Access Keycloak and configure realm"
    echo "  2. Create initial users in Keycloak"
    echo "  3. Run database migrations: cd prisma && npx prisma migrate deploy"
    echo "  4. Access frontend and log in"
    echo ""
    echo -e "${GREEN}For logs, run:${NC} docker-compose -f $INFRA_DIR/docker/docker-compose.yml logs -f"
    echo ""
}

# Main execution
main() {
    log_info "NorthbridgeTax CPA Portal - Infrastructure Setup"
    log_info "==========================================="
    echo ""

    check_docker
    create_directories
    generate_secrets
    create_network
    start_services
    # init_database  # Uncomment when Prisma is configured
    show_urls
}

# Run main function
main