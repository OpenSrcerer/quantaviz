# Quanta Lab: static files served by unprivileged nginx on port 8080.
# Put it behind Caddy (or anything that terminates TLS): the browser only allows
# microphone and screen-audio capture over HTTPS.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html favicon.svg logo.svg /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
