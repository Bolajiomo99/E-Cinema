# Nightly database copy (Figma 50:469, copy 4). Runs as a Render cron job inside the private
# network, so the database never opens to the internet. Postgres 16 matches the live database.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli bash
COPY backup.sh /backup.sh
USER postgres
CMD ["bash", "/backup.sh"]
