import "dotenv/config";

import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import multer from "multer";
import rateLimit from "express-rate-limit";

import { pool, initDb } from "./db.js";
import {
    authRequired,
    signToken
} from "./auth.js";

import {
    parseLogs,
    summarizeEntries,
    retrieveRelevant,
    detectAnomalies,
    buildIncidentTimeline,
    buildRootCauseChain,
    prioritizeFixes,
    fingerprintClusters,
    buildServiceGraph,
    calculateBlastRadius,
    detectSecuritySignals,
    predictFailure,
    compareLogs
} from "./logParser.js";

import {
    analyzeWithAI,
    chatWithAI,
    investigateIncident,
    generateRegressionTests,
    generatePostmortem
} from "./ai.js";

const app = express();

const port =
    Number(process.env.PORT || 10000);

const maxMb =
    Number(
        process.env.MAX_UPLOAD_MB || 10
    );

app.use(
    cors({
        origin:
            process.env.CLIENT_URL
                ? process.env.CLIENT_URL
                    .split(",")
                    .map(x => x.trim())
                : true
    })
);

app.use(
    express.json({
        limit: "2mb"
    })
);

const aiLimiter =
    rateLimit({
        windowMs: 60_000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false
    });

const upload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                maxMb * 1024 * 1024
        },

        fileFilter:
            (_req, file, cb) => {

                const allowed =
                    /\.(log|txt|json|csv)$/i
                        .test(
                            file.originalname
                        );

                cb(
                    allowed
                        ? null
                        : new Error(
                            "Only .log, .txt, .json and .csv files are allowed"
                        ),
                    allowed
                );
            }
    });

function publicUser(user) {
    return {
        id: user.id,
        email: user.email
    };
}

async function ownedLog(
    logId,
    userId
) {
    const { rows } =
        await pool.query(
            `
            SELECT *
            FROM log_files
            WHERE id=$1
            AND user_id=$2
            `,
            [
                logId,
                userId
            ]
        );

    return rows[0];
}

async function getLogEntries(
    logId
) {
    const { rows } =
        await pool.query(
            `
            SELECT
                line_no AS "lineNo",
                timestamp_text AS timestamp,
                level,
                service,
                endpoint,
                status_code AS "statusCode",
                request_id AS "requestId",
                message,
                fingerprint
            FROM log_entries
            WHERE log_file_id=$1
            ORDER BY line_no
            `,
            [logId]
        );

    return rows;
}

function intelligenceFor(
    entries
) {
    const summary =
        summarizeEntries(entries);

    const anomalies =
        detectAnomalies(entries);

    const fingerprints =
        fingerprintClusters(entries);

    const serviceGraph =
        buildServiceGraph(entries);

    const blastRadius =
        calculateBlastRadius(entries);

    const security =
        detectSecuritySignals(entries);

    const prediction =
        predictFailure(
            summary,
            anomalies,
            security
        );

    const rootCause =
        buildRootCauseChain(entries);

    const fixes =
        prioritizeFixes(
            summary,
            anomalies,
            rootCause
        );

    const timeline =
        buildIncidentTimeline(entries);

    return {
        summary,
        anomalies,
        fingerprints,
        serviceGraph,
        blastRadius,
        security,
        prediction,
        rootCause,
        fixes,
        timeline
    };
}

app.get(
    "/api/health",
    (_req, res) => {
        res.json({
            ok: true,
            service:
                "llm-log-analyzer",
            version:
                "2.0.0",
            features: [
                "AI investigation",
                "anomaly detection",
                "error clustering",
                "service graph",
                "blast radius",
                "security detection",
                "failure prediction",
                "log regression",
                "postmortem generation",
                "regression test generation"
            ]
        });
    }
);

app.post(
    "/api/auth/register",
    async (req, res, next) => {
        try {
            const email =
                String(
                    req.body.email || ""
                )
                    .trim()
                    .toLowerCase();

            const password =
                String(
                    req.body.password || ""
                );

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(email)
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Valid email required"
                    });
            }

            if (
                password.length < 8
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Password must be at least 8 characters"
                    });
            }

            const hash =
                await bcrypt.hash(
                    password,
                    12
                );

            const { rows } =
                await pool.query(
                    `
                    INSERT INTO users
                    (email,password_hash)
                    VALUES($1,$2)
                    RETURNING id,email
                    `,
                    [
                        email,
                        hash
                    ]
                );

            res
                .status(201)
                .json({
                    user:
                        publicUser(
                            rows[0]
                        ),
                    token:
                        signToken(
                            rows[0]
                        )
                });

        } catch (error) {

            if (
                error.code ===
                "23505"
            ) {
                return res
                    .status(409)
                    .json({
                        error:
                            "Email already registered"
                    });
            }

            next(error);
        }
    }
);

app.post(
    "/api/auth/login",
    async (req, res, next) => {
        try {
            const email =
                String(
                    req.body.email || ""
                )
                    .trim()
                    .toLowerCase();

            const password =
                String(
                    req.body.password || ""
                );

            const { rows } =
                await pool.query(
                    `
                    SELECT *
                    FROM users
                    WHERE email=$1
                    `,
                    [email]
                );

            if (
                !rows[0] ||
                !(await bcrypt.compare(
                    password,
                    rows[0].password_hash
                ))
            ) {
                return res
                    .status(401)
                    .json({
                        error:
                            "Invalid email or password"
                    });
            }

            res.json({
                user:
                    publicUser(
                        rows[0]
                    ),
                token:
                    signToken(
                        rows[0]
                    )
            });

        } catch (error) {
            next(error);
        }
    }
);

app.get(
    "/api/auth/me",
    authRequired,
    async (req, res, next) => {
        try {

            const { rows } =
                await pool.query(
                    `
                    SELECT id,email
                    FROM users
                    WHERE id=$1
                    `,
                    [req.user.id]
                );

            if (!rows[0]) {
                return res
                    .status(401)
                    .json({
                        error:
                            "User not found"
                    });
            }

            res.json({
                user: rows[0]
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/logs/upload",
    authRequired,
    upload.single("file"),
    async (req, res, next) => {

        try {

            const raw =
                req.file
                    ? req.file.buffer.toString(
                        "utf8"
                    )
                    : String(
                        req.body.text || ""
                    );

            if (!raw.trim()) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Upload a log file or paste log text"
                    });
            }

            if (
                Buffer.byteLength(
                    raw,
                    "utf8"
                ) >
                maxMb * 1024 * 1024
            ) {
                return res
                    .status(413)
                    .json({
                        error:
                            `Maximum upload size is ${maxMb} MB`
                    });
            }

            const entries =
                parseLogs(raw);

            if (!entries.length) {
                return res
                    .status(400)
                    .json({
                        error:
                            "No log entries could be parsed"
                    });
            }

            const summary =
                summarizeEntries(
                    entries
                );

            const filename =
                req.file?.originalname ||
                "pasted-log.txt";

            const client =
                await pool.connect();

            try {

                await client.query(
                    "BEGIN"
                );

                const result =
                    await client.query(
                        `
                        INSERT INTO log_files
                        (
                            user_id,
                            filename,
                            raw_text,
                            total_entries,
                            error_count,
                            warn_count,
                            info_count,
                            debug_count,
                            critical_count
                        )
                        VALUES
                        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                        RETURNING id
                        `,
                        [
                            req.user.id,
                            filename,
                            raw.slice(
                                0,
                                2000000
                            ),
                            summary.counts.total,
                            summary.counts.ERROR || 0,
                            summary.counts.WARN || 0,
                            summary.counts.INFO || 0,
                            summary.counts.DEBUG || 0,
                            summary.counts.CRITICAL || 0
                        ]
                    );

                const logId =
                    result.rows[0].id;

                for (
                    const entry of entries
                ) {

                    await client.query(
                        `
                        INSERT INTO log_entries
                        (
                            log_file_id,
                            line_no,
                            timestamp_text,
                            level,
                            service,
                            endpoint,
                            status_code,
                            request_id,
                            message,
                            fingerprint
                        )
                        VALUES
                        (
                            $1,$2,$3,$4,$5,
                            $6,$7,$8,$9,$10
                        )
                        `,
                        [
                            logId,
                            entry.lineNo,
                            entry.timestamp,
                            entry.level,
                            entry.service,
                            entry.endpoint,
                            entry.statusCode,
                            entry.requestId,
                            entry.message,
                            entry.fingerprint
                        ]
                    );
                }

                await client.query(
                    "COMMIT"
                );

                res
                    .status(201)
                    .json({
                        id: logId,
                        filename,
                        summary
                    });

            } catch (error) {

                await client.query(
                    "ROLLBACK"
                );

                throw error;

            } finally {

                client.release();
            }

        } catch (error) {
            next(error);
        }
    }
);

app.get(
    "/api/logs",
    authRequired,
    async (req, res, next) => {

        try {

            const { rows } =
                await pool.query(
                    `
                    SELECT
                        lf.id,
                        lf.filename,
                        lf.total_entries,
                        lf.error_count,
                        lf.warn_count,
                        lf.critical_count,
                        lf.status,
                        lf.created_at,
                        a.severity,
                        a.summary
                    FROM log_files lf
                    LEFT JOIN analyses a
                        ON a.log_file_id =
                           lf.id
                    WHERE lf.user_id=$1
                    ORDER BY
                        lf.created_at DESC
                    LIMIT 100
                    `,
                    [req.user.id]
                );

            res.json({
                logs: rows
            });

        } catch (error) {
            next(error);
        }
    }
);

app.get(
    "/api/logs/:id",
    authRequired,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const { rows: analyses } =
                await pool.query(
                    `
                    SELECT *
                    FROM analyses
                    WHERE log_file_id=$1
                    `,
                    [log.id]
                );

            res.json({
                log,
                entries,
                analysis:
                    analyses[0] || null,
                summary:
                    summarizeEntries(
                        entries
                    )
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/logs/:id/analyze",
    authRequired,
    aiLimiter,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const summary =
                summarizeEntries(
                    entries
                );

            const result =
                await analyzeWithAI(
                    summary
                );

            await pool.query(
                `
                INSERT INTO analyses
                (
                    log_file_id,
                    summary,
                    severity,
                    root_cause,
                    affected_services,
                    errors,
                    recommendations,
                    confidence,
                    raw_response
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,
                    $6,$7,$8,$9
                )
                ON CONFLICT(log_file_id)
                DO UPDATE SET
                    summary =
                        EXCLUDED.summary,
                    severity =
                        EXCLUDED.severity,
                    root_cause =
                        EXCLUDED.root_cause,
                    affected_services =
                        EXCLUDED.affected_services,
                    errors =
                        EXCLUDED.errors,
                    recommendations =
                        EXCLUDED.recommendations,
                    confidence =
                        EXCLUDED.confidence,
                    raw_response =
                        EXCLUDED.raw_response,
                    created_at =
                        NOW()
                `,
                [
                    log.id,
                    result.summary,
                    result.severity,
                    result.rootCause,
                    JSON.stringify(
                        result.affectedServices
                    ),
                    JSON.stringify(
                        result.errors
                    ),
                    JSON.stringify(
                        result.recommendations
                    ),
                    result.confidence,
                    JSON.stringify(
                        result
                    )
                ]
            );

            await pool.query(
                `
                UPDATE log_files
                SET status='analyzed'
                WHERE id=$1
                `,
                [log.id]
            );

            res.json({
                analysis: result
            });

        } catch (error) {
            next(error);
        }
    }
);

app.get(
    "/api/analytics/:id",
    authRequired,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const { rows: levels } =
                await pool.query(
                    `
                    SELECT
                        level,
                        COUNT(*)::int
                            AS count
                    FROM log_entries
                    WHERE log_file_id=$1
                    GROUP BY level
                    ORDER BY count DESC
                    `,
                    [log.id]
                );

            const { rows: timeline } =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUBSTRING(
                                timestamp_text,
                                1,
                                10
                            ),
                            'unknown'
                        ) AS day,
                        COUNT(*)::int
                            AS total,
                        COUNT(*)
                            FILTER(
                                WHERE level
                                IN
                                ('ERROR','CRITICAL')
                            )::int
                            AS errors
                    FROM log_entries
                    WHERE log_file_id=$1
                    GROUP BY 1
                    ORDER BY 1
                    LIMIT 60
                    `,
                    [log.id]
                );

            const { rows: services } =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            service,
                            'Unknown'
                        ) AS name,
                        COUNT(*)::int
                            AS count
                    FROM log_entries
                    WHERE log_file_id=$1
                    GROUP BY 1
                    ORDER BY count DESC
                    LIMIT 15
                    `,
                    [log.id]
                );

            res.json({
                levels,
                timeline,
                services,
                intelligence:
                    intelligenceFor(
                        entries
                    )
            });

        } catch (error) {
            next(error);
        }
    }
);

app.get(
    "/api/intelligence/:id",
    authRequired,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            res.json(
                intelligenceFor(
                    entries
                )
            );

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/intelligence/:id/investigate",
    authRequired,
    aiLimiter,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const intelligence =
                intelligenceFor(
                    entries
                );

            const investigation =
                await investigateIncident(
                    intelligence
                );

            res.json({
                investigation,
                intelligence
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/intelligence/:id/tests",
    authRequired,
    aiLimiter,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const intelligence =
                intelligenceFor(
                    entries
                );

            const tests =
                await generateRegressionTests(
                    intelligence
                );

            res.json({
                tests
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/intelligence/:id/postmortem",
    authRequired,
    aiLimiter,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const intelligence =
                intelligenceFor(
                    entries
                );

            const postmortem =
                await generatePostmortem(
                    intelligence
                );

            res.json({
                postmortem
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/logs/compare",
    authRequired,
    async (req, res, next) => {

        try {

            const beforeId =
                Number(
                    req.body.beforeId
                );

            const afterId =
                Number(
                    req.body.afterId
                );

            if (
                !beforeId ||
                !afterId
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "beforeId and afterId are required"
                    });
            }

            const beforeLog =
                await ownedLog(
                    beforeId,
                    req.user.id
                );

            const afterLog =
                await ownedLog(
                    afterId,
                    req.user.id
                );

            if (
                !beforeLog ||
                !afterLog
            ) {
                return res
                    .status(404)
                    .json({
                        error:
                            "One or both logs were not found"
                    });
            }

            const before =
                await getLogEntries(
                    beforeId
                );

            const after =
                await getLogEntries(
                    afterId
                );

            res.json({
                before: {
                    id: beforeId,
                    filename:
                        beforeLog.filename
                },

                after: {
                    id: afterId,
                    filename:
                        afterLog.filename
                },

                comparison:
                    compareLogs(
                        before,
                        after
                    )
            });

        } catch (error) {
            next(error);
        }
    }
);

app.post(
    "/api/chat/:id",
    authRequired,
    aiLimiter,
    async (req, res, next) => {

        try {

            const log =
                await ownedLog(
                    req.params.id,
                    req.user.id
                );

            if (!log) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            const question =
                String(
                    req.body.question || ""
                ).trim();

            if (!question) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Question required"
                    });
            }

            const entries =
                await getLogEntries(
                    log.id
                );

            const context =
                retrieveRelevant(
                    entries,
                    question,
                    35
                );

            const { rows: history } =
                await pool.query(
                    `
                    SELECT role,content
                    FROM chat_messages
                    WHERE log_file_id=$1
                    ORDER BY created_at DESC
                    LIMIT 10
                    `,
                    [log.id]
                );

            const answer =
                await chatWithAI(
                    question,
                    context,
                    history.reverse()
                );

            await pool.query(
                `
                INSERT INTO chat_messages
                (
                    log_file_id,
                    role,
                    content
                )
                VALUES
                ($1,'user',$2),
                ($1,'assistant',$3)
                `,
                [
                    log.id,
                    question,
                    answer
                ]
            );

            res.json({
                answer,
                evidence:
                    context.slice(0, 10)
            });

        } catch (error) {
            next(error);
        }
    }
);

app.delete(
    "/api/logs/:id",
    authRequired,
    async (req, res, next) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM log_files
                    WHERE id=$1
                    AND user_id=$2
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );

            if (!result.rowCount) {
                return res
                    .status(404)
                    .json({
                        error:
                            "Log not found"
                    });
            }

            res.json({
                ok: true
            });

        } catch (error) {
            next(error);
        }
    }
);

app.use(
    (err, _req, res, _next) => {

        console.error(err);

        const status =
            err.status ||
            (
                err.code ===
                "LIMIT_FILE_SIZE"
                    ? 413
                    : 500
            );

        res
            .status(status)
            .json({
                error:
                    err.message ||
                    "Internal server error"
            });
    }
);

initDb()
    .then(() => {

        app.listen(
            port,
            "0.0.0.0",
            () =>
                console.log(
                    `API listening on ${port}`
                )
        );

    })
    .catch(error => {

        console.error(
            "Database initialization failed:",
            error
        );

        process.exit(1);
    });