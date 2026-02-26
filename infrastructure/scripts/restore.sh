#!/bin/bash

# NorthbridgeTax CPA Portal - Restore Script
# Restores PostgreSQL database from backup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../database/backups"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "[INFO] $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# Check if backup file is provided
if [ -z "$1" ]; then
    log_error "Usage: $0 <backup_file.sql.gz>"
    log_info "Available backups:"
    ls -lh "$BACKUP_DIR"/postgres_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Load environment variables
if [ -f "$SCRIPT_DIR/../docker/.env" ]; then
    source "$SCRIPT_DIR/../docker/.env"
else
    log_error ".env file not found"
    exit 1
fi

# Confirmation
log_warning "This will restore the database from: $BACKUP_FILE"
log_warning "All current data will be REPLACED!"
read -p "Are you sure you want to continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    log_info "Restore cancelled"
    exit 0
fi

# Stop backend to prevent connections
log_info "Stopping backend service..."
docker-compose -f "$SCRIPT_DIR/../docker/docker-compose.yml" stop backend

# Restore database
log_info "Restoring PostgreSQL database..."
gunzip -c "$BACKUP_FILE" | docker exec -i northbridgetax-postgres psql -U "${POSTGRES_USER:-northbridgetax_admin}" -d "${POSTGRES_DB:-northbridgetax}"

log_success "Database restored successfully"

# Start backend
log_info "Starting backend service..."
docker-compose -f "$SCRIPT_DIR/../docker/docker-compose.yml" start backend

log_success "Restore completed successfully"