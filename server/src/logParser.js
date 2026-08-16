import crypto from "crypto";

const ERROR_LEVELS = ["ERROR", "CRITICAL"];

function normalizeLevel(level) {
    const value = String(level || "INFO").toUpperCase();

    if (value === "WARNING") return "WARN";
    if (value === "FATAL") return "CRITICAL";

    return value;
}

function makeFingerprint(message) {
    const normalized = String(message || "")
        .toLowerCase()
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
        .replace(/\b\d+\b/g, "<number>")
        .replace(/(['"])[^'"]+\1/g, "<value>")
        .replace(/\s+/g, " ")
        .trim();

    return crypto
        .createHash("sha256")
        .update(normalized)
        .digest("hex")
        .slice(0, 16);
}

export function parseLogs(raw) {
    const lines = String(raw || "").split(/\r?\n/);
    const entries = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) continue;

        let timestamp = "";
        let level = "INFO";
        let service = "";
        let endpoint = "";
        let statusCode = null;
        let requestId = "";
        let message = line;

        const timestampMatch = line.match(
            /^\[?(\d{4}-\d{2}-\d{2}[T\s][0-9:.+\-TZ]+)\]?/
        );

        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        const levelMatch = line.match(
            /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/i
        );

        if (levelMatch) {
            level = normalizeLevel(levelMatch[1]);
        }

        const serviceMatch = line.match(
            /\[([A-Za-z0-9_.:-]{2,100})\]/
        );

        if (serviceMatch) {
            service = serviceMatch[1];
        }

        const methodMatch = line.match(
            /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[^\s?]*)/
        );

        if (methodMatch) {
            endpoint = methodMatch[2];
        }

        const statusMatch = line.match(
            /\b(?:status|statusCode|HTTP)[=: ]+(\d{3})\b/i
        );

        if (statusMatch) {
            statusCode = Number(statusMatch[1]);
        }

        const requestMatch = line.match(
            /(?:request[-_ ]?id|trace[-_ ]?id)[=: ]+([A-Za-z0-9_.:-]+)/i
        );

        if (requestMatch) {
            requestId = requestMatch[1];
        }

        message = line
            .replace(
                /^\[?\d{4}-\d{2}-\d{2}[T\s][0-9:.+\-TZ]+\]?\s*/,
                ""
            )
            .trim();

        entries.push({
            lineNo: i + 1,
            timestamp,
            level,
            service,
            endpoint,
            statusCode,
            requestId,
            message,
            fingerprint: makeFingerprint(message)
        });
    }

    return entries;
}

export function summarizeEntries(entries) {
    const counts = {
        total: entries.length,
        ERROR: 0,
        CRITICAL: 0,
        WARN: 0,
        INFO: 0,
        DEBUG: 0,
        TRACE: 0
    };

    const groups = new Map();
    const services = new Map();
    const statusCodes = new Map();
    const endpoints = new Map();

    for (const entry of entries) {
        counts[entry.level] =
            (counts[entry.level] || 0) + 1;

        if (entry.service) {
            services.set(
                entry.service,
                (services.get(entry.service) || 0) + 1
            );
        }

        if (entry.statusCode) {
            const code = String(entry.statusCode);

            statusCodes.set(
                code,
                (statusCodes.get(code) || 0) + 1
            );
        }

        if (entry.endpoint) {
            endpoints.set(
                entry.endpoint,
                (endpoints.get(entry.endpoint) || 0) + 1
            );
        }

        const old = groups.get(entry.fingerprint) || {
            fingerprint: entry.fingerprint,
            message: entry.message,
            level: entry.level,
            service: entry.service,
            count: 0,
            firstSeen: entry.timestamp,
            lastSeen: entry.timestamp
        };

        old.count++;

        if (entry.timestamp) {
            old.lastSeen = entry.timestamp;
        }

        groups.set(entry.fingerprint, old);
    }

    const topErrors = [...groups.values()]
        .filter(x => ERROR_LEVELS.includes(x.level))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);

    const errorCount =
        counts.ERROR + counts.CRITICAL;

    const errorRate =
        entries.length === 0
            ? 0
            : (errorCount / entries.length) * 100;

    let healthScore = 100;

    healthScore -= Math.min(
        60,
        errorRate * 5
    );

    healthScore -= Math.min(
        30,
        counts.CRITICAL * 5
    );

    healthScore = Math.max(
        0,
        Math.round(healthScore)
    );

    return {
        counts,

        errorRate: Number(
            errorRate.toFixed(2)
        ),

        healthScore,

        incidentRisk:
            healthScore >= 85
                ? "LOW"
                : healthScore >= 65
                    ? "MEDIUM"
                    : healthScore >= 40
                        ? "HIGH"
                        : "CRITICAL",

        topErrors,

        topServices: [...services.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([name, count]) => ({
                name,
                count
            })),

        statusCodes: [...statusCodes.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => ({
                code,
                count
            })),

        topEndpoints: [...endpoints.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([name, count]) => ({
                name,
                count
            })),

        uniqueErrorGroups: topErrors.length
    };
}

export function detectAnomalies(entries) {
    const buckets = new Map();

    for (const entry of entries) {
        if (!entry.timestamp) continue;

        const date = new Date(entry.timestamp);

        if (Number.isNaN(date.getTime())) continue;

        const minute = new Date(
            Math.floor(date.getTime() / 60000) * 60000
        ).toISOString();

        if (!buckets.has(minute)) {
            buckets.set(minute, {
                total: 0,
                errors: 0,
                critical: 0,
                warnings: 0
            });
        }

        const bucket = buckets.get(minute);

        bucket.total++;

        if (ERROR_LEVELS.includes(entry.level)) {
            bucket.errors++;
        }

        if (entry.level === "CRITICAL") {
            bucket.critical++;
        }

        if (entry.level === "WARN") {
            bucket.warnings++;
        }
    }

    const points = [...buckets.entries()]
        .sort(
            (a, b) =>
                new Date(a[0]) - new Date(b[0])
        )
        .map(([time, value]) => ({
            time,
            ...value
        }));

    if (points.length < 3) {
        return {
            anomalous: false,
            baseline: 0,
            current: 0,
            multiplier: 1,
            points,
            anomalies: []
        };
    }

    const baseline =
        points.reduce(
            (sum, point) => sum + point.errors,
            0
        ) / points.length;

    const recent = points.slice(-3);

    const current =
        recent.reduce(
            (sum, point) => sum + point.errors,
            0
        ) / recent.length;

    const multiplier =
        baseline === 0
            ? current > 0
                ? current
                : 1
            : current / baseline;

    const anomalies = points.filter(
        point =>
            point.errors >
            Math.max(3, baseline * 2.5)
    );

    return {
        anomalous: anomalies.length > 0,

        baseline: Number(
            baseline.toFixed(2)
        ),

        current: Number(
            current.toFixed(2)
        ),

        multiplier: Number(
            multiplier.toFixed(2)
        ),

        points,

        anomalies
    };
}

export function fingerprintClusters(entries) {
    const map = new Map();

    for (const entry of entries) {
        if (!map.has(entry.fingerprint)) {
            map.set(entry.fingerprint, {
                fingerprint: entry.fingerprint,
                message: entry.message,
                count: 0,
                levels: new Set(),
                services: new Set(),
                lines: []
            });
        }

        const cluster =
            map.get(entry.fingerprint);

        cluster.count++;

        cluster.levels.add(entry.level);

        if (entry.service) {
            cluster.services.add(entry.service);
        }

        if (cluster.lines.length < 10) {
            cluster.lines.push(entry.lineNo);
        }
    }

    return [...map.values()]
        .map(x => ({
            fingerprint: x.fingerprint,
            message: x.message,
            count: x.count,
            levels: [...x.levels],
            services: [...x.services],
            lines: x.lines
        }))
        .sort((a, b) => b.count - a.count);
}

export function buildServiceGraph(entries) {
    const nodes = new Map();
    const edges = new Map();

    for (const entry of entries) {
        if (!entry.service) continue;

        if (!nodes.has(entry.service)) {
            nodes.set(entry.service, {
                id: entry.service,
                events: 0,
                errors: 0
            });
        }

        const node =
            nodes.get(entry.service);

        node.events++;

        if (ERROR_LEVELS.includes(entry.level)) {
            node.errors++;
        }

        const dependencyMatch =
            entry.message.match(
                /(?:calling|requesting|connecting to|dependency|upstream|downstream)\s+([A-Za-z0-9_.:-]+)/i
            );

        if (
            dependencyMatch &&
            dependencyMatch[1] !== entry.service
        ) {
            const target = dependencyMatch[1];

            const key =
                `${entry.service}->${target}`;

            if (!edges.has(key)) {
                edges.set(key, {
                    source: entry.service,
                    target,
                    count: 0
                });
            }

            edges.get(key).count++;
        }
    }

    return {
        nodes: [...nodes.values()],
        edges: [...edges.values()]
    };
}

export function calculateBlastRadius(entries) {
    const services = new Map();
    const endpoints = new Map();

    let serverErrors = 0;

    for (const entry of entries) {
        if (entry.service) {
            services.set(
                entry.service,
                (services.get(entry.service) || 0) + 1
            );
        }

        if (entry.endpoint) {
            endpoints.set(
                entry.endpoint,
                (endpoints.get(entry.endpoint) || 0) + 1
            );
        }

        if (entry.statusCode >= 500) {
            serverErrors++;
        }
    }

    const affectedServices =
        [...services.entries()]
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .map(([name, events]) => ({
                name,
                events
            }));

    const affectedEndpoints =
        [...endpoints.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30)
            .map(([name, events]) => ({
                name,
                events
            }));

    const score = Math.min(
        100,
        affectedServices.length * 15 +
        affectedEndpoints.length * 3 +
        serverErrors * 2
    );

    return {
        score,

        severity:
            score >= 80
                ? "CRITICAL"
                : score >= 55
                    ? "HIGH"
                    : score >= 25
                        ? "MEDIUM"
                        : "LOW",

        affectedServices,
        affectedEndpoints,
        serverErrors
    };
}

export function detectSecuritySignals(entries) {
    const rules = [
        {
            type: "AUTH_FAILURE_SPIKE",
            regex:
                /unauthorized|authentication failed|invalid password|invalid token|login failed/i
        },
        {
            type: "ACCESS_DENIED",
            regex:
                /forbidden|access denied|permission denied/i
        },
        {
            type: "INJECTION_SIGNAL",
            regex:
                /union\s+select|drop\s+table|<script|javascript:|'\s*or\s+1\s*=/i
        },
        {
            type: "PATH_TRAVERSAL",
            regex:
                /\.\.\/|\.\.\\/
        },
        {
            type: "SECRET_EXPOSURE",
            regex:
                /api[_-]?key|password|secret|authorization:\s*bearer/i
        }
    ];

    const signals = [];

    for (const rule of rules) {
        const matches = entries.filter(
            entry =>
                rule.regex.test(entry.message)
        );

        if (!matches.length) continue;

        signals.push({
            type: rule.type,
            count: matches.length,

            services: [
                ...new Set(
                    matches
                        .map(x => x.service)
                        .filter(Boolean)
                )
            ],

            evidence: matches
                .slice(0, 10)
                .map(x => ({
                    lineNo: x.lineNo,
                    message: x.message
                }))
        });
    }

    return signals;
}

export function predictFailure(
    summary,
    anomalies,
    security
) {
    let risk = 0;

    const reasons = [];

    if (summary.errorRate > 10) {
        risk += 30;
        reasons.push("High error rate");
    }

    if (anomalies.anomalous) {
        risk += 30;
        reasons.push(
            `Error rate is ${anomalies.multiplier}x baseline`
        );
    }

    if (summary.counts.CRITICAL > 0) {
        risk += 25;
        reasons.push(
            "Critical events detected"
        );
    }

    if (
        summary.counts.WARN >
        summary.counts.INFO
    ) {
        risk += 10;
        reasons.push(
            "Warnings exceed informational events"
        );
    }

    if (security.length > 0) {
        risk += 10;
        reasons.push(
            "Security signals detected"
        );
    }

    risk = Math.min(100, risk);

    return {
        score: risk,

        level:
            risk >= 80
                ? "CRITICAL"
                : risk >= 60
                    ? "HIGH"
                    : risk >= 35
                        ? "MEDIUM"
                        : "LOW",

        reasons
    };
}

export function buildIncidentTimeline(entries) {
    return entries
        .filter(
            x =>
                x.level !== "INFO" ||
                /failed|failure|timeout|started|stopped|restart|recovered|connected/i.test(
                    x.message
                )
        )
        .slice(0, 500)
        .map(x => ({
            timestamp: x.timestamp,
            type: x.level,
            service: x.service,
            lineNo: x.lineNo,
            message: x.message
        }));
}

export function buildRootCauseChain(entries) {
    const rules = [
        {
            category: "DATABASE",
            regex:
                /postgres|mysql|mongodb|database|connection pool|connection refused|redis/i
        },
        {
            category: "NETWORK",
            regex:
                /network|socket|dns|connection reset|connection timed out/i
        },
        {
            category: "LATENCY",
            regex:
                /timeout|timed out|deadline exceeded|slow request/i
        },
        {
            category: "AUTHENTICATION",
            regex:
                /unauthorized|authentication failed|token expired|forbidden/i
        },
        {
            category: "MEMORY",
            regex:
                /out of memory|heap|memory limit|heap space/i
        },
        {
            category: "RATE_LIMIT",
            regex:
                /rate limit|too many requests|429/i
        },
        {
            category: "DEPENDENCY",
            regex:
                /upstream|downstream|dependency|third.?party|external service/i
        }
    ];

    const result = [];

    for (const rule of rules) {
        const matches = entries.filter(
            x => rule.regex.test(x.message)
        );

        if (!matches.length) continue;

        result.push({
            category: rule.category,
            occurrences: matches.length,

            services: [
                ...new Set(
                    matches
                        .map(x => x.service)
                        .filter(Boolean)
                )
            ],

            evidence: matches
                .slice(0, 5)
                .map(x => ({
                    lineNo: x.lineNo,
                    timestamp: x.timestamp,
                    message: x.message
                }))
        });
    }

    return result.sort(
        (a, b) =>
            b.occurrences -
            a.occurrences
    );
}

export function prioritizeFixes(
    summary,
    anomalies,
    rootCauseChain
) {
    const fixes = [];

    if (
        rootCauseChain.some(
            x => x.category === "DATABASE"
        )
    ) {
        fixes.push({
            priority: "P0",
            impact: 98,
            title:
                "Investigate database failure",
            action:
                "Check database availability, connection pools, query failures and recent dependency changes."
        });
    }

    if (
        rootCauseChain.some(
            x => x.category === "MEMORY"
        )
    ) {
        fixes.push({
            priority: "P0",
            impact: 97,
            title:
                "Investigate memory exhaustion",
            action:
                "Inspect heap usage, memory limits, leaks and recent workload changes."
        });
    }

    if (summary.counts.CRITICAL > 0) {
        fixes.push({
            priority: "P0",
            impact: 95,
            title:
                "Investigate critical failures",
            action:
                "Start from the earliest critical event and trace dependent services."
        });
    }

    if (anomalies.anomalous) {
        fixes.push({
            priority: "P1",
            impact: 90,
            title:
                "Investigate error-rate anomaly",
            action:
                "Compare the anomaly window against deployments, traffic and dependency health."
        });
    }

    if (summary.counts.ERROR > 0) {
        fixes.push({
            priority: "P1",
            impact: 80,
            title:
                "Resolve dominant error fingerprint",
            action:
                "Start with the highest-frequency recurring error."
        });
    }

    return fixes.sort(
        (a, b) => b.impact - a.impact
    );
}

export function compareLogs(before, after) {
    const beforeSummary =
        summarizeEntries(before);

    const afterSummary =
        summarizeEntries(after);

    const beforeErrors =
        beforeSummary.counts.ERROR +
        beforeSummary.counts.CRITICAL;

    const afterErrors =
        afterSummary.counts.ERROR +
        afterSummary.counts.CRITICAL;

    const errorDelta =
        afterErrors - beforeErrors;

    const newErrors =
        afterSummary.topErrors.filter(
            error =>
                !beforeSummary.topErrors.some(
                    old =>
                        old.fingerprint ===
                        error.fingerprint
                )
        );

    return {
        before: beforeSummary,
        after: afterSummary,

        errorDelta,

        warningDelta:
            afterSummary.counts.WARN -
            beforeSummary.counts.WARN,

        healthDelta:
            afterSummary.healthScore -
            beforeSummary.healthScore,

        newErrors,

        regression:
            errorDelta > 0 ||
            afterSummary.healthScore <
                beforeSummary.healthScore
    };
}

export function retrieveRelevant(
    entries,
    query,
    limit = 35
) {
    const terms = String(query || "")
        .toLowerCase()
        .split(/[^a-z0-9_./:-]+/)
        .filter(x => x.length > 2);

    return entries
        .map(entry => {
            const text =
                `${entry.level} ${entry.service} ${entry.endpoint} ${entry.statusCode || ""} ${entry.message}`
                    .toLowerCase();

            let score = 0;

            for (const term of terms) {
                if (text.includes(term)) {
                    score += 2;
                }
            }

            if (
                ERROR_LEVELS.includes(
                    entry.level
                )
            ) {
                score += 0.5;
            }

            return {
                entry,
                score
            };
        })
        .filter(
            x =>
                x.score > 0 ||
                terms.length === 0
        )
        .sort(
            (a, b) =>
                b.score - a.score
        )
        .slice(0, limit)
        .map(x => x.entry);
}