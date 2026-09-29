# THE MAFIA WAR — ONLINE

Servidor web para THE MAFIA WAR.

## Desarrollo local
npm install
ADMIN_PASSWORD="(configúrala localmente)" npm start

## Producción
El servicio escucha en PORT y expone /healthz para health checks.

IMPORTANTE: ADMIN_PASSWORD debe configurarse como secreto en el hosting y nunca debe guardarse en el repositorio.

El plan gratuito puede tener almacenamiento efímero; para conservar cuentas y progreso entre reinicios se necesita una base de datos externa o almacenamiento persistente.
