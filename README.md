# Panel de Levantamiento de Inspecciones · ON Infraestructura

Panel web para el **seguimiento del levantamiento de observaciones** detectadas por la herramienta de
auto-inspección **SEG-F-010**. Cada jefe **selecciona su área** de una lista e ingresa el **DNI del
encargado** como contraseña; ve solo las observaciones de su área (`requiere cambio` / `no tiene`),
gestiona evidencias en carpetas fechadas de Drive y consulta análisis de datos en tiempo real.

```
Técnico (SEG-F-010) ──POST──▶ Apps Script ──▶ Google Sheet (Detalle / Respuestas)
                                   │                       ▲
                                   │ doGet (JSON)          │ Seguimiento
                                   ▼                       │
                          ESTE PANEL (index.html) ◀────────┘
                                   │
                          ┌────────┴─────────┐
                          ▼                  ▼
                Drive: Evidencias/      Gmail: rechazos SOMA
                AAAA-MM-DD/Área         → borra evidencia sola
```

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | El panel completo (autocontenido, sin dependencias). Se abre en navegador o se sube a Netlify. |
| `Panel_Backend.gs` | Backend de Google Apps Script: `doGet` (JSON), carpetas fechadas en Drive y trigger de Gmail. Se **agrega** al proyecto Apps Script que ya recibe las inspecciones. |
| `Formato_Entrega_EPP.html` | Placeholder imprimible del formato de entrega de EPP. **Reemplázalo por tu PDF oficial.** |

## Uso inmediato (modo demostración)

Abre `index.html` en el navegador. Sin configurar nada, funciona con datos de ejemplo. El login pide
**Área** (lista desplegable) + **DNI del encargado**. Usuarios de prueba (clic en un área dentro de
"Ver usuarios de prueba" para autocompletar):

| Área (usuario) | Encargado | DNI (contraseña) |
|---|---|---|
| NORMALIZACIÓN DE RED | Julio Chávez Bravo | `41552093` |
| ON NEGOCIOS INSTALACIONES | Jorge Rondón Díaz | `40288115` |
| INSTALACIÓN DE PLANTA EXTERNA | Jesús Huasacca Roca | `45903388` |
| **SSOMA · todas las áreas** | **Gabriela Abad Torres** | `09112233` |

> El usuario SSOMA ve todas las áreas y un comparativo entre ellas. La lista completa está en `index.html` → `var USUARIOS`.

## Puesta en producción

### 1. Backend (Google Apps Script)
1. Abre el proyecto Apps Script que ya tiene el `doPost` de inspecciones (el mismo del `ENDPOINT_URL` del SEG-F-010).
2. Crea un archivo nuevo y pega `Panel_Backend.gs`.
   - Tu proyecto ya tiene un `doPost` (inspecciones). La función de este archivo se llama `_panelPost`
     (no `doPost`) para no duplicar el nombre. **Conéctala** así: en tu `doPost`, justo después de
     `var data = JSON.parse(e.postData.contents);`, agrega la línea `if (data.action) return _panelPost(e);`.
3. **Implementar → Nueva implementación → Aplicación web**, acceso "Cualquiera". Copia la URL `/exec`.
4. Ejecuta una vez `crearTriggerRechazosSOMA()` (autoriza permisos de Drive y Gmail).

### 2. Conectar el panel
En `index.html`, edita el bloque `CONFIG` (arriba del `<script>`):
```js
var CONFIG = {
  ENDPOINT_URL:         "https://script.google.com/macros/s/XXXX/exec", // URL del paso 1.3
  FORMATO_EPP_URL:      "./Formato_Entrega_EPP.pdf",   // tu PDF oficial (o URL de Drive)
  DRIVE_EVIDENCIAS_URL: "https://drive.google.com/drive/folders/XXXX",  // carpeta raíz de evidencias
  ATS_ENDPOINT_URL:     ""   // app de campo ATS/Charla (ver "Pestaña ATS · Charla 5 min"); vacío = demo
};
```

### 3. Usuarios reales (jefes) — pestaña `Jefes` en el Sheet
**Sin tocar código.** Crea en el Google Sheet una pestaña llamada **`Jefes`** con esta cabecera:

| area | nombre | dni | correo | rol *(opcional)* |
|---|---|---|---|---|
| NORMALIZACIÓN DE RED | Julio Chávez Bravo | 41552093 | jchavez@optical-infra.pe | |
| `*` | Gabriela Abad Torres | 09112233 | gabad@optical-infra.pe | SSOMA |

En cuanto `CONFIG.ENDPOINT_URL` esté configurado, **el login carga esta pestaña automáticamente**
(`doGet?action=jefes`) y autentica contra ella; la pista de usuarios demo desaparece sola.
Si no hay endpoint o la pestaña está vacía, el panel vuelve a los usuarios demo del array `USUARIOS`.

- El login se hace **eligiendo el `area`** (lista desplegable) + el `dni`; el `nombre` solo se usa para
  mostrar quién inició sesión. Si un área tiene varios jefes, cada uno entra con el mismo área y su propio DNI.
- El `area` de cada jefe alimenta el desplegable y debe coincidir con el área de la hoja `Detalle`
  (no distingue tildes ni mayúsculas).
- Pon `area = *` para un usuario **SSOMA** que vea todas las áreas y el comparativo entre ellas
  (en el desplegable aparece como "SSOMA · Todas las áreas").
- ⚠ **Formatea la columna `dni` como _Texto_** en el Sheet para no perder ceros iniciales (ej. `09112233`).

### 4. Formato de entrega de EPP
Coloca tu PDF oficial junto a `index.html` y apunta `CONFIG.FORMATO_EPP_URL` a él (o a una URL de Drive).
El botón verde **"Formato EPP"** —visible en la barra superior y en el menú lateral— lo descarga.

### 5. Pestaña "ATS · Charla 5 min" (llenado de campo)

Pestaña visible para **todos los jefes y para SSOMA** que visualiza el llenado de **ATS** y
**Charlas de 5 minutos** que las cuadrillas suben desde la [app de campo](../5.%20APP%20WEB%20ATS%20%20Y%20CHARLA%20DE%20MIN)
(KPIs, tendencia, ATS vs Charla, registros por cuadrilla, cumplimiento por cuadrilla, comparativo por
área para SSOMA y tabla con enlace a la carpeta de Drive). Funciona en **modo demo** sin configurar nada.

Para conectarla con los datos reales:

1. **Backend de la app ATS** (`5. APP WEB ATS…/apps-script/Codigo.gs`): define `LOG_SHEET_ID` con el ID de
   una Google Sheet (hoja `Registros`) y **re-despliega** manteniendo la misma URL. El `doGet?action=registros`
   ya está incluido y devuelve los últimos registros de la hoja.
2. **Panel:** pega esa URL `/exec` en `CONFIG.ATS_ENDPOINT_URL`. El panel la lee con `?action=registros`.
3. **Mapeo de áreas:** la app ATS guarda un ÁREA amplia (INSPECCIÓN Y DISEÑO / MANTENIMIENTO / NETWORKING /
   PLANTA EXTERNA) + una DIVISIÓN aparte, mientras que el panel usa 5 "áreas" que son combinaciones de ambas.
   Ajusta la función **`mapArea(area, division)`** en `index.html` para traducir cada combinación al área del
   panel (trae ejemplos comentados). Sin mapeo, cada jefe solo verá registros cuya área coincida exactamente
   con la suya; SSOMA siempre ve todo.

> Si no hay `ATS_ENDPOINT_URL` o el endpoint falla, la pestaña usa datos de ejemplo automáticamente.

### 6. Desplegar (Netlify)
Igual que el SEG-F-010: arrastra esta carpeta a Netlify (o `netlify deploy`). Es estático, no requiere build.

> ⚠️ La subcarpeta **`netlify_deploy/`** es una copia de `index.html` (+ el PDF) que se despliega. Si editas
> el `index.html` de la raíz, **vuelve a copiarlo** a `netlify_deploy/` antes de desplegar
> (`cp index.html netlify_deploy/index.html`) para que los cambios lleguen a producción.

### 7. Correo diario de ATS y Charlas **pendientes de aprobar** (09:00)

Réplica del esquema de correos que ya se envían a las áreas sobre sus observaciones, pero **exclusivo
para el estado _Pendiente (de aprobar)_ de los llenados de ATS y Charla de 5 minutos**. Se manda
**todos los días a las 9:00 a. m.**:

- **A cada área** → sólo sus registros de ATS/Charla pendientes de aprobar.
- **Al equipo SSOMA** → un resumen consolidado con todas las áreas.

Vive en [`Correos_ATS_Charla.gs`](Correos_ATS_Charla.gs) (se agrega al mismo proyecto Apps Script del
`Panel_Backend.gs`; reutiliza sus utilidades). No añade endpoints: lo dispara un **trigger horario**.

**De dónde salen los datos (nada que duplicar):**

| Qué | De dónde |
|---|---|
| Pendientes (ATS/Charla) | Hoja **`Registros`** de la app ATS (`LOG_SHEET_ID`), columna **`Estado` = `Pendiente`** — la misma que alimenta la pestaña *ATS · Charla 5 min* del panel |
| Destinatarios por área | Hoja **`Jefes`** (`area \| nombre \| dni \| correo \| rol`), la misma del login |
| Equipo SSOMA | Los `Jefes` con `area = *` o `rol` que contenga **SSOMA**, más los de `EXTRA_SSOMA` |

**Ruteo por área.** La app de campo guarda un *ÁREA amplia* + una *División*; el correo agrupa por
`ÁREA ▸ División` (igual que `mapArea()` del panel) y empareja cada grupo con los jefes cuya `area`
coincida con la clave completa, con el área amplia **o con la división**. Para casos que no calcen, usa
el mapa `OVERRIDE_AREA`. Un área sin jefe con correo no se pierde: aparece igual en el resumen de SSOMA.

> ✅ **Verificado contra la hoja `Jefes` real:** su columna `area` ya usa el formato `ÁREA ▸ División`,
> que calza **1:1** con el catálogo de la app ATS. Las **11 combinaciones** de área/división rutean a un
> jefe real (**0 huérfanas**) y el equipo SSOMA resuelve a las filas con `area = *`. **No se necesita
> ningún `OVERRIDE_AREA`.** Las áreas con Jefe de Área *y* Jefe de División reciben a ambos.

**Puesta en marcha (una sola vez, desde el editor de Apps Script):**

1. Revisa el bloque **`CFG_CORREO_ATS`** (sobre todo `LOG_SHEET_ID`; y si hace falta `EXTRA_SSOMA`,
   `OVERRIDE_AREA`, `PANEL_URL`).
2. Ejecuta **`previewCorreosPendientesATS()`** → **no envía**; escribe en el *Registro de ejecución* a
   quién le llegaría cada correo. Autoriza los permisos de Gmail/Hojas cuando lo pida.
3. *(Opcional)* **`enviarCorreosPendientesATSAhora()`** para una prueba real inmediata.
4. **`crearTriggerCorreosPendientesATS()`** → programa el envío diario a las 09:00.

> ⏰ El «09:00» usa la **zona horaria del proyecto**. Ponla en *Configuración del proyecto → Zona
> horaria* = **(GMT-05:00) America/Lima**. Para pausar los envíos: `borrarTriggerCorreosPendientesATS()`.
> Por defecto, un área sin pendientes **no** recibe correo (sin ruido); el resumen a SSOMA sólo se
> manda cuando hay pendientes, salvo que pongas `ENVIAR_SSOMA_SI_VACIO: true`.

**Robustez (ya incluida):**

- **A prueba de fallos por-correo.** Si un destinatario es inválido o Gmail rechaza un envío, ese
  correo se salta y **el resto igual sale** (p. ej. el resumen de SSOMA no depende de que ninguna área
  falle). Los fallos quedan en `resumen.errores` y en el *Registro de ejecución*.
- **Control de cuota.** Antes de enviar avisa si la cuota diaria de Gmail no cubre los correos del día
  (consumidor ≈ 100/día; suficiente para las áreas + SSOMA).
- **Correos acotados.** `MAX_FILAS` (80) evita correos gigantes: muestra los pendientes **más antiguos**
  y añade «… y N más». `DIAS_ALERTA` (3) resalta en rojo los que llevan demasiados días sin aprobar.
- **Auditoría.** Con `REGISTRAR_ENVIOS: true` (por defecto) cada corrida agrega una fila a la pestaña
  **`Correos enviados`** del mismo libro de `Registros`: fecha, total pendientes, áreas notificadas,
  correos enviados, áreas sin destinatario y errores. No toca los datos de ATS/Charla; ponlo en `false`
  para desactivarlo.

## Cómo funcionan las integraciones

- **Drive (carpetas fechadas):** al subir evidencia de un levantamiento, el backend la guarda en
  `Evidencias Levantamiento / AAAA-MM-DD / Área` y registra el `file id` en la hoja `Seguimiento`.
  En la descripción del archivo se graba `obs_id=...` para poder ubicarlo después.
- **Gmail (rechazo SOMA):** `procesarRechazosSOMA()` corre cada hora, busca correos según
  `GMAIL_QUERY_RECHAZO`, extrae el ID de observación/inspección del asunto o cuerpo, **manda la evidencia
  a la papelera de Drive** y marca la observación como `rechazado` (vuelve a quedar pendiente).
  Ajusta `GMAIL_QUERY_RECHAZO` al remitente/asunto real con que SOMA notifica los rechazos.
- **Gmail (correo diario ATS/Charla):** `enviarCorreosPendientesATS()` corre cada día a las 09:00
  (trigger de `Correos_ATS_Charla.gs`), lee la hoja `Registros` (Estado = `Pendiente`) y envía a cada
  área sus ATS/Charlas pendientes de aprobar y un resumen consolidado al equipo SSOMA. Ver
  «7. Correo diario de ATS y Charlas pendientes de aprobar».

## Nota de seguridad
El login (área + DNI) es el solicitado para uso **interno**. Como el área se elige de una lista, el DNI del
encargado es el **único secreto**; es dato personal y funciona como identificador, no como contraseña
fuerte. Si más adelante se requiere mayor protección, conviene migrar a contraseñas propias o a la
autenticación con la cuenta corporativa de Google.
