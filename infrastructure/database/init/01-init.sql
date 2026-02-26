-- NorthbridgeTax CPA Portal - Database Initialization Script
-- PostgreSQL 17

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For full-text search
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Create custom types
DO $$ BEGIN
    CREATE TYPE audit_severity AS ENUM ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create function for case number generation
CREATE OR REPLACE FUNCTION generate_case_number() RETURNS TEXT AS $$
DECLARE
    new_sequence INT;
    date_part TEXT;
    sequence_name TEXT := 'case_number';
BEGIN
    -- Get current date in YYYYMMDD format
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');

    -- Update or insert sequence
    INSERT INTO sequence_generators (id, name, prefix, current_value, date_format, last_reset_at, updated_at)
    VALUES (
        uuid_generate_v4(),
        sequence_name,
        'CS',
        1,
        'YYYYMMDD',
        NOW(),
        NOW()
    )
    ON CONFLICT (name) DO UPDATE
    SET current_value = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.current_value + 1
            ELSE 1
        END,
        last_reset_at = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.last_reset_at
            ELSE NOW()
        END,
        updated_at = NOW()
    RETURNING current_value INTO new_sequence;

    -- Return formatted case number
    RETURN 'CS-' || date_part || '-' || LPAD(new_sequence::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Create function for client number generation
CREATE OR REPLACE FUNCTION generate_client_number() RETURNS TEXT AS $$
DECLARE
    new_sequence INT;
    date_part TEXT;
    sequence_name TEXT := 'client_number';
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');

    INSERT INTO sequence_generators (id, name, prefix, current_value, date_format, last_reset_at, updated_at)
    VALUES (
        uuid_generate_v4(),
        sequence_name,
        'CL',
        1,
        'YYYYMMDD',
        NOW(),
        NOW()
    )
    ON CONFLICT (name) DO UPDATE
    SET current_value = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.current_value + 1
            ELSE 1
        END,
        last_reset_at = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.last_reset_at
            ELSE NOW()
        END,
        updated_at = NOW()
    RETURNING current_value INTO new_sequence;

    RETURN 'CL-' || date_part || '-' || LPAD(new_sequence::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Create function for invoice number generation
CREATE OR REPLACE FUNCTION generate_invoice_number() RETURNS TEXT AS $$
DECLARE
    new_sequence INT;
    date_part TEXT;
    sequence_name TEXT := 'invoice_number';
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');

    INSERT INTO sequence_generators (id, name, prefix, current_value, date_format, last_reset_at, updated_at)
    VALUES (
        uuid_generate_v4(),
        sequence_name,
        'INV',
        1,
        'YYYYMMDD',
        NOW(),
        NOW()
    )
    ON CONFLICT (name) DO UPDATE
    SET current_value = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.current_value + 1
            ELSE 1
        END,
        last_reset_at = CASE
            WHEN TO_CHAR(sequence_generators.last_reset_at, 'YYYYMMDD') = date_part
            THEN sequence_generators.last_reset_at
            ELSE NOW()
        END,
        updated_at = NOW()
    RETURNING current_value INTO new_sequence;

    RETURN 'INV-' || date_part || '-' || LPAD(new_sequence::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create audit log trigger function
CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource,
            resource_id,
            description,
            changes,
            ip_address,
            user_agent,
            severity,
            created_at
        ) VALUES (
            uuid_generate_v4(),
            current_setting('app.current_user_id', TRUE)::uuid,
            'DELETE',
            TG_TABLE_NAME,
            OLD.id,
            'Record deleted from ' || TG_TABLE_NAME,
            row_to_json(OLD),
            current_setting('app.client_ip', TRUE),
            current_setting('app.user_agent', TRUE),
            'INFO',
            NOW()
        );
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource,
            resource_id,
            description,
            changes,
            ip_address,
            user_agent,
            severity,
            created_at
        ) VALUES (
            uuid_generate_v4(),
            current_setting('app.current_user_id', TRUE)::uuid,
            'UPDATE',
            TG_TABLE_NAME,
            NEW.id,
            'Record updated in ' || TG_TABLE_NAME,
            json_build_object('before', row_to_json(OLD), 'after', row_to_json(NEW)),
            current_setting('app.client_ip', TRUE),
            current_setting('app.user_agent', TRUE),
            'INFO',
            NOW()
        );
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource,
            resource_id,
            description,
            changes,
            ip_address,
            user_agent,
            severity,
            created_at
        ) VALUES (
            uuid_generate_v4(),
            current_setting('app.current_user_id', TRUE)::uuid,
            'CREATE',
            TG_TABLE_NAME,
            NEW.id,
            'Record created in ' || TG_TABLE_NAME,
            row_to_json(NEW),
            current_setting('app.client_ip', TRUE),
            current_setting('app.user_agent', TRUE),
            'INFO',
            NOW()
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create search index update function
CREATE OR REPLACE FUNCTION update_case_search_index()
RETURNS TRIGGER AS $$
BEGIN
    -- This would be enhanced with proper full-text search vectors in production
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE northbridgetax TO northbridgetax_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO northbridgetax_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO northbridgetax_admin;

-- Create indexes for performance (will be created by Prisma, but included for reference)
-- Additional custom indexes can be added here

COMMENT ON DATABASE northbridgetax IS 'NorthbridgeTax CPA Portal - Production Database';