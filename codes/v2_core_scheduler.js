"use strict";

module.exports = function createScheduler(options) {
    const logger = options.logger;
    const defaultIntervalMs = options.defaultIntervalMs;
    const jobs = new Map();
    let started = false;

    function register(definition) {
        if (!definition || !definition.name || typeof definition.task !== "function") {
            throw new TypeError("Scheduler jobs require a name and task function");
        }
        if (jobs.has(definition.name)) return false;

        const intervalMs = definition.interval || defaultIntervalMs;
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new RangeError("Scheduler interval must be a positive number");
        }

        const job = {
            name: definition.name,
            intervalMs: intervalMs,
            task: definition.task,
            allowOverlap: definition.allowOverlap === true,
            running: false,
            timer: null
        };
        jobs.set(job.name, job);
        if (started) startJob(job);
        return true;
    }

    function runJob(job) {
        if (job.running && !job.allowOverlap) return;
        job.running = true;

        Promise.resolve()
            .then(job.task)
            .catch(function (error) {
                logger.error("Scheduled job failed: " + job.name, error);
            })
            .finally(function () {
                job.running = false;
            });
    }

    function startJob(job) {
        if (job.timer !== null) return;
        job.timer = setInterval(function () { runJob(job); }, job.intervalMs);
    }

    function start() {
        if (started) return false;
        started = true;
        jobs.forEach(startJob);
        logger.info("Scheduler started");
        return true;
    }

    function stop() {
        jobs.forEach(function (job) {
            if (job.timer !== null) clearInterval(job.timer);
            job.timer = null;
        });
        const wasStarted = started;
        started = false;
        return wasStarted;
    }

    return Object.freeze({
        register: register,
        unregister: function (name) {
            const job = jobs.get(name);
            if (!job) return false;
            if (job.timer !== null) clearInterval(job.timer);
            return jobs.delete(name);
        },
        start: start,
        stop: stop,
        isStarted: function () { return started; },
        has: function (name) { return jobs.has(name); }
    });
};
