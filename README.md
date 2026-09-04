# Remote Desk

Control remoto sencillo y de baja latencia para un PC Windows. Incluye:

- **Agente Windows (Electron):** captura pantalla y audio del sistema, recibe el micrófono remoto e inyecta mouse/teclado.
- **Web (React):** muestra el escritorio, envía controles y el micrófono del navegador.
- **API (Node):** login por variables de entorno y señalización WebRTC. El video/audio viajan directamente entre navegador y PC; no pasan por la API.

## Puesta en marcha local

Requiere Node.js 20 o posterior.

```bash
cp .env.example .env
npm install
npm run dev:server
```

Edita `.env` antes de usarlo. Como mínimo cambia `WEB_PASSWORD`, `JWT_SECRET` y `AGENT_TOKEN`. Abre `http://localhost:5173` para la web.

En el PC Windows, copia el proyecto y el mismo `.env`, cambia `API_URL` por la URL de la API y ejecuta:

```powershell
npm install
npm run dev -w @remote-desk/agent
```

El indicador de la web cambiará a **PC conectado**. Inicia sesión y pulsa **Conectar**.

## Audio para contestar Teams

Windows necesita un cable de audio virtual; esta primera versión usa cualquier dispositivo de este tipo y funciona bien con **VB-CABLE**:

1. Instala VB-CABLE en el PC controlado y reinicia Windows si el instalador lo solicita.
2. Abre Remote Desk Agent y elige **CABLE Input** en “Salida para el micrófono remoto”.
3. En Teams, selecciona **CABLE Output** como micrófono.
4. En la web deja marcada la opción **Enviar micrófono** y acepta el permiso del navegador.

Así, la voz capturada en el navegador llega por WebRTC, se reproduce en `CABLE Input` y Teams la recibe desde `CABLE Output`. Usa audífonos en ambos extremos para evitar eco.

## Uso por Internet

La web debe publicarse con **HTTPS** para que el navegador permita usar el micrófono. La API sirve también el build de la web, así que en producción se despliega un solo servicio.

### Despliegue en Coolify con Dockerfiles separados

Crea dos recursos **Dockerfile** desde el mismo repositorio y la rama `main`. Mantén `/` como directorio base/contexto de build.

**API**

- Dockerfile: `/apps/api/Dockerfile`
- Puerto: `8787`
- Dominio sugerido: `https://api-remote.tudominio.com`
- Health check: `/api/health`
- Variables obligatorias: `WEB_USERNAME`, `WEB_PASSWORD`, `JWT_SECRET`, `AGENT_TOKEN` y `RTC_ICE_SERVERS`

**Web**

- Dockerfile: `/apps/web/Dockerfile`
- Puerto: `80`
- Dominio sugerido: `https://remote.tudominio.com`
- Health check: `/healthz`
- Variable obligatoria: `API_URL=https://api-remote.tudominio.com` (sin `/` al final)

La web obtiene `API_URL` al arrancar el contenedor, por lo que cambiar el dominio en Coolify no requiere reconstruir el frontend. Coolify debe generar certificados HTTPS para ambos dominios. Socket.IO se conecta directamente al dominio de la API y ya admite WebSocket con fallback a polling.

En el agente Windows configura exactamente el mismo dominio y secretos:

```env
API_URL=https://api-remote.tudominio.com
AGENT_TOKEN=el-mismo-token-de-la-api
RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

Para redes donde STUN no sea suficiente, agrega TURN al `RTC_ICE_SERVERS` tanto de la API como del agente.

### Despliegue sin Docker

También puedes ejecutar Node directamente:

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Pon la API detrás de Caddy, Nginx o tu proxy HTTPS habitual. Socket.IO usa el mismo dominio y puerto.

Para conexiones confiables entre redes distintas configura un servidor TURN (por ejemplo coturn) y coloca STUN + TURN en `RTC_ICE_SERVERS`, tanto en el servidor como en el agente Windows:

```env
RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.tudominio.com:3478","username":"remote","credential":"una-clave-larga"}]
```

Sin TURN funcionará en muchas redes, pero no en todas. Si necesitas ponerlo operativo de inmediato sin abrir la API a Internet, una VPN privada como Tailscale entre el servidor y el PC reduce bastante la configuración.

## Crear el instalador de Windows

Ejecuta esto **desde Windows**:

```powershell
npm run package:windows
```

El instalador queda en `apps/agent/release/`. Antes de abrir el agente instalado, define `API_URL`, `AGENT_TOKEN` y `RTC_ICE_SERVERS` como variables de entorno de Windows. Cierra y vuelve a abrir sesión si Windows aún no las refleja.

## Rendimiento esperado

- Objetivo: 1920×1080, 30 fps, máximo aproximado de 8 Mbps.
- WebRTC prioriza mantener los FPS y adapta resolución/bitrate cuando baja la red; 720p a 20–30 fps es el modo degradado esperado.
- La web muestra resolución y FPS recibidos durante una sesión.
- Para buena respuesta usa Ethernet o Wi‑Fi 5/6 y un TURN geográficamente cercano cuando haga falta.

## Límites conscientes de esta versión rápida

- Controla una sola pantalla (la principal) y permite un solo controlador simultáneo.
- `Ctrl+Alt+Supr`, pantallas UAC seguras y la pantalla de login de Windows no pueden controlarse desde una app de usuario normal.
- El agente debe estar ejecutándose dentro de la sesión de Windows que se desea controlar.
- El audio virtual requiere VB-CABLE o un equivalente; Windows no ofrece un micrófono virtual genérico desde Electron.
- No hay transferencia de archivos ni portapapeles, porque no forman parte del alcance inicial.

## Seguridad mínima incluida

- Usuario/contraseña solo en la web, definidos por `WEB_USERNAME` y `WEB_PASSWORD`.
- Token separado para el agente (`AGENT_TOKEN`).
- Sesión web JWT de 8 horas, comparación de credenciales en tiempo constante y límite de intentos de login.
- Un segundo navegador no puede tomar el control mientras hay una sesión activa.

No publiques el puerto sin HTTPS, usa secretos largos y restringe el acceso por firewall o VPN siempre que sea posible.
