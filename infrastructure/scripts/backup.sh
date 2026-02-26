#!/bin/bash

# NorthbridgeTax CPA Portal - Backup Script
# Backs up PostgreSQL database and MinIO files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../database/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "[INFO] $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Load environment variables
if [ -f "$SCRIPT_DIR/../docker/.env" ]; then
    source "$SCRIPT_DIR/../docker/.env"
else
    log_error ".env file not found"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
log_info "Backing up PostgreSQL database..."
docker exec northbridgetax-postgres pg_dump -U "${POSTGRES_USER:-northbridgetax_admin}" -d "${POSTGRES_DB:-northbridgetax}" \
    | gzip > "$BACKUP_DIR/postgres_${TIMESTAMP}.sql.gz"
log_success "PostgreSQL backup completed: postgres_${TIMESTAMP}.sql.gz"

# Backup MinIO (using mc client)
log_info "Backing up MinIO data..."
docker exec northbridgetax-minio-init mc mirror --preserve northbridgetax/documents /backups/minio_${TIMESTAMP}/documents
docker exec northbridgetax-minio-init mc mirror --preserve northbridgetax/avatars /backups/minio_${TIMESTAMP}/avatars
log_success "MinIO backup completed: minio_${TIMESTAMP}/"

# Cleanup old backups (keep last 30 days)
log_info "Cleaning up old backups..."
find "$BACKUP_DIR" -name "postgres_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "minio_*" -mtime +30 -type d -exec rm -rf {} +
log_success "Old backups cleaned up"

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log_success "Backup completed successfully. Total size: $BACKUP_SIZE"