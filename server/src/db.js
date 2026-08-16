import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the root .env BEFORE creating the PostgreSQL pool
dotenv.config({
    path: path.resolve(__dirname, "../../.env")
});

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
}

console.log("Database host:", new URL(process.env.DATABASE_URL).hostname);

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

export async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS log_files (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            raw_text TEXT,
            total_entries INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0,
            warn_count INTEGER DEFAULT 0,
            info_count INTEGER DEFAULT 0,
            debug_count INTEGER DEFAULT 0,
            critical_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'uploaded',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS log_entries (
            id SERIAL PRIMARY KEY,
            log_file_id INTEGER NOT NULL
                REFERENCES log_files(id) ON DELETE CASCADE,
            line_no INTEGER NOT NULL,
            timestamp_text TEXT,
            level TEXT NOT NULL DEFAULT 'INFO',
            service TEXT,
            endpoint TEXT,
            status_code INTEGER,
            request_id TEXT,
            message TEXT NOT NULL,
            fingerprint TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id SERIAL PRIMARY KEY,
            log_file_id INTEGER UNIQUE NOT NULL
                REFERENCES log_files(id) ON DELETE CASCADE,
            summary TEXT,
            severity TEXT,
            root_cause TEXT,
            affected_services JSONB DEFAULT '[]',
            errors JSONB DEFAULT '[]',
            recommendations JSONB DEFAULT '[]',
            confidence NUMERIC DEFAULT 0,
            raw_response JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            log_file_id INTEGER NOT NULL
                REFERENCES log_files(id) ON DELETE CASCADE,
            role TEXT NOT NULL
                CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    console.log("Database tables initialized successfully.");
}