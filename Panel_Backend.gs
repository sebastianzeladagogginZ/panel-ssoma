// ============================================================
//  PANEL DE LEVANTAMIENTO — BACKEND  ·  ON Infraestructura
//  Google Apps Script · complemento del proyecto SEG-F-010
//
//  Este archivo SE AGREGA al mismo proyecto Apps Script que ya
//  recibe las inspecciones (doPost). Aporta 3 capacidades nuevas:
//
//    1) doGet   → entrega al panel las observaciones "requiere
//                 cambio" / "no tiene" como JSON (filtrables por área).
//    2) Drive   → guarda las evidencias de levantamiento en carpetas
//                 fechadas:  Evidencias Levantamiento / AAAA-MM-DD / Área
//    3) Gmail   → trigger que detecta rechazos de SOMA por correo y
//                 ELIMINA automáticamente la evidencia de Drive.
//
//  Hojas usadas (ya existen, creadas por la herramienta de inspección):
//    "Detalle"    → 1 fila por ítem  [id,area,fecha,cuadrilla,seccion,recurso,item,estado]
//    "Respuestas" → 1 fila por inspección (resumen)
//  Hoja nueva que crea este backend:
//    "Seguimiento" → estado de levantamiento por observación
//                    [obs_id, id_inspeccion, area, fecha, estado_levantamiento,
//                     evidencia_url, drive_file_id, actualizado]
//
//  ⚠ NO borres ni modifiques el doPost que recibe inspecciones.
//     Si ya tienes un doPost, fusiona el bloque marcado más abajo.
// ============================================================


// ──────────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ──────────────────────────────────────────────────────────────
var CFG_PANEL = {
  HOJA_DETALLE:     "Detalle",
  HOJA_RESPUESTAS:  "Respuestas",
  HOJA_SEGUIMIENTO: "Seguimiento",

  // Índices de columna en "Detalle" (base 0)
  D_ID:0, D_AREA:1, D_FECHA:2, D_CUADRILLA:3, D_SECCION:4, D_RECURSO:5, D_ITEM:6, D_ESTADO:7,

  // Estados que el panel debe mostrar
  ESTADOS_ALERTA: ["requiere cambio", "no tiene"],

  // Carpeta raíz de evidencias de levantamiento en Drive.
  // Déjala vacía y se creará/encontrará por nombre en "Mi unidad".
  CARPETA_RAIZ_NOMBRE: "Evidencias Levantamiento",
  CARPETA_RAIZ_ID:     "",   // opcional: pega aquí el ID de una carpeta existente

  // ── Detección de rechazos SOMA por Gmail ──────────────────────
  // El trigger busca correos que cumplan ESTE query de Gmail.
  // Ajusta el remitente/asunto a cómo SOMA comunica los rechazos.
  GMAIL_QUERY_RECHAZO: 'from:(soma) subject:(rechazo OR rechazada OR observada) newer_than:30d',
  // Etiqueta que se aplica a los hilos ya procesados (para no repetir).
  GMAIL_LABEL_PROCESADO: "SOMA/Evidencia eliminada"
};


// ============================================================
//  1) doGet — API de lectura para el panel
//     GET ?action=observaciones[&area=NORMALIZACIÓN DE RED]
//     GET ?action=jefes        (opcional, si llevas el roster en una hoja "Jefes")
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "observaciones";
  try {
    if (action === "observaciones") return _json(_obtenerObservaciones(e.parameter.area));
    if (action === "jefes")         return _json(_obtenerJefes());
    return _json({ error: "Acción no reconocida: " + action });
  } catch (err) {
    return _json({ error: String(err) });
  }
}

function _obtenerObservaciones(areaFiltro) {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var det  = ss.getSheetByName(CFG_PANEL.HOJA_DETALLE);
  if (!det) return { observaciones: [], error: "Hoja 'Detalle' no encontrada" };

  var datos = det.getDataRange().getValues();
  var seg   = _mapaSeguimiento();           // obs_id → {levantamiento, evidencia_url}
  var out   = [];

  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    var estado = _norm(f[CFG_PANEL.D_ESTADO]);
    var esAlerta = CFG_PANEL.ESTADOS_ALERTA.some(function (x) { return estado === _norm(x); });
    if (!esAlerta) continue;

    var area = String(f[CFG_PANEL.D_AREA] || "");
    if (areaFiltro && areaFiltro !== "__ALL__" && _norm(area) !== _norm(areaFiltro)) continue;

    var insp  = String(f[CFG_PANEL.D_ID] || "");
    var item  = String(f[CFG_PANEL.D_ITEM] || "");
    var obsId = insp + "::" + i;             // id estable por fila
    var s     = seg[obsId] || {};

    out.push({
      id:            obsId,
      insp:          insp,
      area:          area,
      fecha:         _fechaISO(f[CFG_PANEL.D_FECHA]),
      cuadrilla:     String(f[CFG_PANEL.D_CUADRILLA] || ""),
      seccion:       String(f[CFG_PANEL.D_SECCION] || ""),
      recurso:       String(f[CFG_PANEL.D_RECURSO] || ""),
      item:          item,
      estado:        String(f[CFG_PANEL.D_ESTADO] || ""),
      levantamiento: s.levantamiento || "pendiente",
      evidencia_lev: !!s.evidencia_url,
      evidencia_url: s.evidencia_url || "",
      mensaje_jefe:  s.mensaje_jefe || "",
      mensaje_ssoma: s.mensaje_ssoma || "",
      soma_rechazo:  s.levantamiento === "rechazado",
      folder:        CFG_PANEL.CARPETA_RAIZ_NOMBRE + "/" + _fechaISO(f[CFG_PANEL.D_FECHA]) + "/" + area
    });
  }
  return { observaciones: out, total: out.length, generado: new Date().toISOString() };
}

// Roster de jefes desde la hoja "Jefes":  area | nombre | dni | correo | rol(opcional)
//   · area = "*"  → usuario que ve TODAS las áreas (SSOMA).
//   · Formatea la columna DNI como TEXTO en el Sheet para no perder ceros iniciales
//     (p. ej. 09112233). Aun así, aquí se rellena a 8 dígitos por si quedó como número.
function _obtenerJefes() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Jefes");
  if (!sh) return { jefes: [] };
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][1]) continue;                 // sin nombre → fila vacía
    var dni = String(d[i][2] || "").trim();
    if (/^\d{1,8}$/.test(dni)) dni = ("00000000" + dni).slice(-8);   // restaura ceros si vino como número
    out.push({
      area:   String(d[i][0] || "").trim(),
      nombre: String(d[i][1] || "").trim(),
      dni:    dni,
      correo: String(d[i][3] || "").trim(),
      rol:    String(d[i][4] || "").trim()
    });
  }
  return { jefes: out };
}


// ============================================================
//  2) _panelPost — actualizar levantamiento + guardar evidencia
//
//  Tu proyecto YA tiene un doPost (el de inspecciones), así que
//  esta función NO se llama doPost (no se puede duplicar nombre).
//  Se invoca DESDE tu doPost: justo después de la línea
//    var data = JSON.parse(e.postData.contents);
//  agrega esta línea:
//    if (data.action) return _panelPost(e);
//  Los POST del panel llevan "action" y se desvían aquí; las
//  inspecciones (sin "action") siguen su curso normal.
// ============================================================
function _panelPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  var action = body.action || "";

  if (action === "actualizar_levantamiento") {
    _actualizarSeguimiento(body);            // body: {id, levantamiento, evidencia_lev}
    return _json({ ok: true });
  }
  if (action === "subir_evidencia_levantamiento") {
    _guardarEvidenciaDrive(body);            // guarda archivo + url + drive_file_id + estado "en_proceso"
    if (body.mensaje_jefe !== undefined) _actualizarSeguimiento({ id: body.id, mensaje_jefe: body.mensaje_jefe });
    return _json({ ok: true });
  }
  if (action === "aprobar_levantamiento") {   // SSOMA valida el levantamiento
    _actualizarSeguimiento({ id: body.id, levantamiento: "levantado" });
    return _json({ ok: true });
  }
  if (action === "rechazar_levantamiento") {  // SSOMA rechaza → borra evidencia de Drive
    _rechazarManual(body.id);
    if (body.texto !== undefined) _actualizarSeguimiento({ id: body.id, mensaje_ssoma: body.texto });
    return _json({ ok: true });
  }
  if (action === "guardar_mensaje") {         // mensaje jefe↔SSOMA (body: {id, rol, texto})
    _actualizarSeguimiento(body.rol === "ssoma" ? { id: body.id, mensaje_ssoma: body.texto || "" }
                                               : { id: body.id, mensaje_jefe:  body.texto || "" });
    return _json({ ok: true });
  }
  return _json({ ok: true, nota: "panelPost sin acción reconocida (" + action + ")" });
}

// Rechazo manual desde el panel (SSOMA): elimina la evidencia de Drive y marca "rechazado".
function _rechazarManual(id) {
  var mapa = _mapaSeguimiento();
  if (mapa[id] && mapa[id].driveId) _borrarDrive(mapa[id].driveId);
  _marcarRechazada(id);
}


// ============================================================
//  Hoja "Seguimiento": estado de levantamiento por observación
// ============================================================
function _hojaSeguimiento() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG_PANEL.HOJA_SEGUIMIENTO);
  if (!sh) {
    sh = ss.insertSheet(CFG_PANEL.HOJA_SEGUIMIENTO);
    sh.appendRow(["obs_id","id_inspeccion","area","fecha","estado_levantamiento","evidencia_url","drive_file_id","actualizado","mensaje_jefe","mensaje_ssoma"]);
  }
  return sh;
}
function _mapaSeguimiento() {
  var sh = _hojaSeguimiento(), d = sh.getDataRange().getValues(), m = {};
  for (var i = 1; i < d.length; i++) {
    m[String(d[i][0])] = {
      levantamiento: String(d[i][4] || "pendiente"),
      evidencia_url: String(d[i][5] || ""),
      driveId:       String(d[i][6] || ""),
      mensaje_jefe:  String(d[i][8] || ""),
      mensaje_ssoma: String(d[i][9] || ""),
      fila: i + 1
    };
  }
  return m;
}
function _actualizarSeguimiento(body) {
  var sh = _hojaSeguimiento(), mapa = _mapaSeguimiento(), id = String(body.id);
  var nivel = body.levantamiento || (mapa[id] ? mapa[id].levantamiento : "pendiente");
  var url   = body.evidencia_url !== undefined ? body.evidencia_url : (mapa[id] ? mapa[id].evidencia_url : "");
  if (mapa[id]) {
    var r = mapa[id].fila;
    sh.getRange(r, 5).setValue(nivel);
    sh.getRange(r, 6).setValue(url);
    if (body.drive_file_id) sh.getRange(r, 7).setValue(body.drive_file_id);   // actualiza/preserva id de Drive
    sh.getRange(r, 8).setValue(new Date());
    if (body.mensaje_jefe  !== undefined) sh.getRange(r, 9).setValue(body.mensaje_jefe);
    if (body.mensaje_ssoma !== undefined) sh.getRange(r, 10).setValue(body.mensaje_ssoma);
  } else {
    var p = id.split("::");
    sh.appendRow([id, p[0] || id, body.area || "", body.fecha || "", nivel, url || "", body.drive_file_id || "", new Date(),
                  body.mensaje_jefe || "", body.mensaje_ssoma || ""]);
  }
}


// ============================================================
//  3) Drive — evidencias en carpetas fechadas
//     Estructura: <RAIZ> / AAAA-MM-DD / Área / archivo
// ============================================================
function _carpetaRaiz() {
  if (CFG_PANEL.CARPETA_RAIZ_ID) return DriveApp.getFolderById(CFG_PANEL.CARPETA_RAIZ_ID);
  var it = DriveApp.getFoldersByName(CFG_PANEL.CARPETA_RAIZ_NOMBRE);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CFG_PANEL.CARPETA_RAIZ_NOMBRE);
}
function _subcarpeta(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}
function _carpetaFechada(fecha, area) {
  var raiz = _carpetaRaiz();
  var porFecha = _subcarpeta(raiz, fecha || _fechaISO(new Date()));
  return _subcarpeta(porFecha, area || "General");
}
function _guardarEvidenciaDrive(body) {
  var carpeta = _carpetaFechada(body.fecha, body.area);
  var bytes = Utilities.base64Decode(body.contenido || "");
  var mime  = body.mime || "image/jpeg";
  var nombre = String(body.nombre || ("evidencia_" + Date.now()));
  if (nombre.indexOf(".") < 0) nombre += (mime.indexOf("pdf") >= 0 ? ".pdf" : ".jpg");  // asegura extensión
  var blob  = Utilities.newBlob(bytes, mime, nombre);
  var file  = carpeta.createFile(blob);
  file.setDescription("obs_id=" + body.id);    // ← clave para que Gmail pueda ubicarla al rechazar
  // guardamos el file id en seguimiento
  _actualizarSeguimiento({ id: body.id, levantamiento: "en_proceso", evidencia_url: file.getUrl(), drive_file_id: file.getId(), area: body.area, fecha: body.fecha });
  return file.getUrl();
}


// ============================================================
//  4) Gmail — eliminación automática al rechazo de SOMA
//
//  Lógica: SOMA envía un correo de rechazo que menciona el ID de
//  la observación o de la inspección (p. ej. en el asunto/cuerpo:
//  "INS-1023" u "obs_id=INS-1023::42"). El trigger busca esos
//  correos, ubica la evidencia en Drive por su descripción
//  (obs_id=...) y la ELIMINA, marcando la observación como
//  "rechazado" para que vuelva a gestionarse.
// ============================================================
function procesarRechazosSOMA() {
  var label = _labelProcesado();
  var hilos = GmailApp.search(CFG_PANEL.GMAIL_QUERY_RECHAZO);
  var seg = _mapaSeguimiento();
  var eliminadas = 0;

  hilos.forEach(function (hilo) {
    // saltar si ya fue procesado
    if (hilo.getLabels().some(function (l) { return l.getName() === CFG_PANEL.GMAIL_LABEL_PROCESADO; })) return;

    var texto = "";
    hilo.getMessages().forEach(function (m) { texto += " " + m.getSubject() + " " + m.getPlainBody(); });

    // Buscar ids de observación (obs_id=...) o de inspección (INS-####)
    var ids = _extraerIds(texto);
    ids.forEach(function (id) {
      // 1) por obs_id exacto en Seguimiento
      Object.keys(seg).forEach(function (obsId) {
        if (obsId === id || obsId.indexOf(id) === 0 || obsId.split("::")[0] === id) {
          if (seg[obsId].driveId) { _borrarDrive(seg[obsId].driveId); eliminadas++; }
          _marcarRechazada(obsId);
        }
      });
    });

    // 2) respaldo: borrar archivos de Drive cuya descripción contenga el id
    ids.forEach(function (id) { eliminadas += _borrarEvidenciasPorDescripcion(id); });

    hilo.addLabel(label);
  });

  Logger.log("🚫 Rechazos SOMA procesados. Evidencias eliminadas: " + eliminadas);
  return eliminadas;
}

function _extraerIds(texto) {
  var ids = {}, m;
  var re1 = /obs_id\s*=\s*([A-Za-z0-9:\-]+)/g;
  while ((m = re1.exec(texto))) ids[m[1]] = 1;
  var re2 = /\bINS-\d+(::\d+)?/g;
  while ((m = re2.exec(texto))) ids[m[0]] = 1;
  return Object.keys(ids);
}
function _borrarDrive(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { Logger.log("No se pudo borrar " + fileId + ": " + err); }
}
function _borrarEvidenciasPorDescripcion(id) {
  var n = 0, files = DriveApp.searchFiles('fullText contains "' + id + '" and trashed = false');
  while (files.hasNext()) {
    var f = files.next();
    if (String(f.getDescription() || "").indexOf(id) >= 0) { f.setTrashed(true); n++; }
  }
  return n;
}
function _marcarRechazada(obsId) {
  var sh = _hojaSeguimiento(), mapa = _mapaSeguimiento();
  if (mapa[obsId]) {
    sh.getRange(mapa[obsId].fila, 5).setValue("rechazado");
    sh.getRange(mapa[obsId].fila, 6).setValue("");           // evidencia eliminada
    sh.getRange(mapa[obsId].fila, 8).setValue(new Date());
  } else {
    sh.appendRow([obsId, obsId.split("::")[0], "", "", "rechazado", "", "", new Date()]);
  }
}
function _labelProcesado() {
  var l = GmailApp.getUserLabelByName(CFG_PANEL.GMAIL_LABEL_PROCESADO);
  return l || GmailApp.createLabel(CFG_PANEL.GMAIL_LABEL_PROCESADO);
}

// Crear el trigger (ejecutar UNA vez desde el editor): revisa Gmail cada hora
function crearTriggerRechazosSOMA() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "procesarRechazosSOMA"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("procesarRechazosSOMA").timeBased().everyHours(1).create();
  Logger.log("✅ Trigger 'procesarRechazosSOMA' creado: cada 1 hora.");
}


// ============================================================
//  UTILIDADES
// ============================================================
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _norm(s) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function _fechaISO(raw) {
  if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var s = String(raw || "").trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            if (m) return m[1] + "-" + m[2] + "-" + m[3];
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);     if (m2) return m2[3] + "-" + ("0"+m2[2]).slice(-2) + "-" + ("0"+m2[1]).slice(-2);
  return s;
}

// Prueba rápida desde el editor (sin "_" inicial para que aparezca en el menú Ejecutar)
function test_observaciones() {
  Logger.log(JSON.stringify(_obtenerObservaciones("__ALL__"), null, 2));
}
