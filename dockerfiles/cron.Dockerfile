# Minimal image for Railway cron services.
#
# The jcl-govcon cron services (weekly-crawl, check-batches) do nothing
# but fire an authenticated POST to the always-on jcl-govcon-web service
# and exit. They don't need Node or the Next.js build — just curl.
#
# Decoupling the cron services from the web build means:
#   - ~5s build instead of ~2min
#   - If the web build breaks, the crons still run and alert
#   - Cron service lifecycle is independent of web deployments
#
# Used by railway.weekly-crawl.json and railway.check-batches.json via
# build.dockerfilePath. Each cron service supplies its own startCommand.

FROM alpine:3.19

RUN apk add --no-cache curl ca-certificates

CMD ["sh", "-c", "echo 'No startCommand configured' && exit 1"]
