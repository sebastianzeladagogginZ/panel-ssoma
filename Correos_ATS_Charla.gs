// ============================================================
//  CORREOS DIARIOS — ATS y CHARLA DE 5 MINUTOS PENDIENTES DE APROBAR
//  Google Apps Script · complemento del Panel SSOMA (ON Infraestructura)
//
//  Réplica del esquema de correos que ya se envían a las áreas sobre sus
//  OBSERVACIONES, pero enfocado EXCLUSIVAMENTE en el estado
//  «Pendiente (de aprobar)» de los llenados de ATS y Charla de 5 minutos.
//
//  Se envía TODOS LOS DÍAS a las 9:00 a. m. (trigger horario):
//    · A cada ÁREA  → sólo sus registros de ATS/Charla pendientes de aprobar.
//    · Al EQUIPO SSOMA → un resumen consolidado con TODAS las áreas.
//
//  De dónde salen los datos y los destinatarios (nada que duplicar):
//    · PENDIENTES → hoja "Registros" de la app ATS (LOG_SHEET_ID), columna
//                   "Estado" == "Pendiente".  (Misma hoja que alimenta el
//                   Panel SSOMA → pestaña «ATS · Charla 5 min».)
//    · DESTINATARIOS → hoja "Jefes" del panel (area | nombre | dni | correo | rol),
//                   la MISMA que usa el login. area="*" o rol con "SSOMA" = equipo SSOMA.
//
//  Este archivo SE AGREGA al mismo proyecto Apps Script del Panel_Backend.gs.
//  Reutiliza sus utilidades (_norm, _fechaISO, _obtenerJefes) — por eso NO
//  vuelve a definirlas (en Apps Script todos los .gs comparten el espacio global).
//
//  PUESTA EN MARCHA (una sola vez, desde el editor de Apps Script):
//    1) Revisa el bloque CFG_CORREO_ATS de abajo (sobre todo LOG_SHEET_ID y,
//       si hace falta, EXTRA_SSOMA / OVERRIDE_AREA / ROSTER_FALLBACK).
//    2) Ejecuta  previewCorreosPendientesATS()  → NO envía nada; escribe en el
//       Registro de ejecución a quién le llegaría y con qué contenido. Autoriza
//       los permisos de Gmail/Drive/Hojas cuando lo pida.
//    3) (Opcional) Ejecuta  enviarCorreosPendientesATSAhora()  para mandarte una
//       prueba real de inmediato.
//    4) Ejecuta  crearTriggerCorreosPendientesATS()  → programa el envío diario 9:00.
//       ⚠ El «9:00» usa la zona horaria del PROYECTO. Ponla en Configuración del
//          proyecto → «Zona horaria» = (GMT-05:00) America/Lima.
// ============================================================


// ──────────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ──────────────────────────────────────────────────────────────
var CFG_CORREO_ATS = {
  // Hoja "Registros" de la app ATS/Charla (la que alimenta el panel).
  // Es el MISMO ID que LOG_SHEET_ID del backend de la app ATS (Codigo.gs).
  LOG_SHEET_ID:   "1ptmnCGfCHZX5RvWSg0cOczbKzYxNgsDooF_BbVg04fc",
  LOG_SHEET_NAME: "Registros",

  // Hoja con la pestaña "Jefes" (roster de destinatarios). Es el libro
  // "SEG-F-010 Respuestas 2026". Se lee POR ID para no depender de que el
  // proyecto Apps Script esté enlazado a esa hoja (si el proyecto es standalone
  // o está enlazado a otra hoja, getActiveSpreadsheet() no la encuentra).
  //   → Pega aquí el ID que aparece en la URL de esa hoja, entre /d/ y /edit:
  //     docs.google.com/spreadsheets/d/«ESTE_ES_EL_ID»/edit
  //   Déjalo vacío para usar la hoja activa (solo si el proyecto está enlazado a ella).
  JEFES_SHEET_ID: "",
  HOJA_JEFES:     "Jefes",

  // Si JEFES_SHEET_ID queda vacío, el script BUSCA la hoja por NOMBRE en el Drive
  // de la cuenta que lo ejecuta (ssomaoni posee "SEG-F-010 Respuestas 2026").
  // Así NO hay que pegar ningún ID: cero configuración. Cambia el nombre aquí si
  // tu libro se llama distinto.
  JEFES_SHEET_FILENAME: "SEG-F-010 Respuestas 2026",

  // Estado que se considera «pendiente de aprobar» en la columna "Estado".
  ESTADO_PENDIENTE: "Pendiente",

  // Hora del envío diario (0-23), en la zona horaria del PROYECTO.
  HORA_ENVIO: 9,

  // ¿Enviar aunque no haya pendientes?  false = no molestar cuando todo está al día.
  //   · Áreas: sólo reciben correo si tienen pendientes (independiente de este flag).
  //   · SSOMA: recibe el resumen SIEMPRE que este flag sea true (aunque sea "0 pendientes").
  ENVIAR_SSOMA_SI_VACIO: false,

  // Correos SSOMA adicionales (además de los que ya estén en la hoja "Jefes"
  // con area="*" o rol que contenga "SSOMA"). Déjalo vacío si con la hoja basta.
  EXTRA_SSOMA: [
    // "ssoma@optical-infra.pe",
  ],

  // Excepciones de ruteo Área→destinatario. Clave = "ÁREA ▸ División" (como la
  // arma la app de campo); valor = nombre EXACTO del "area" en la hoja "Jefes".
  // Normalmente NO hace falta: el ruteo ya empareja por área amplia y por división
  // (p. ej. la división "Normalización de Red" calza con el jefe "NORMALIZACIÓN DE RED").
  OVERRIDE_AREA: {
    // "PLANTA EXTERNA ▸ ON Negocios": "ON NEGOCIOS INSTALACIONES",
  },

  // Roster de respaldo SOLO si la hoja "Jefes" está vacía o no se pudo leer.
  // La fuente de verdad es la hoja "Jefes" (se lee en vivo): su columna `area` usa
  // el formato "ÁREA ▸ División", que calza 1:1 con el catálogo de la app ATS, así
  // que el ruteo funciona sin tocar esto. Se deja VACÍO a propósito: si algún día la
  // hoja no carga, es preferible NO enviar (y avisar en el log) que mandar correos a
  // direcciones obsoletas. Para un modo demo, agrega aquí filas {area,nombre,correo,rol}.
  ROSTER_FALLBACK: [],

  // (Opcional) URL pública del Panel SSOMA para el botón «Abrir el panel» del correo.
  // Vacío = sin botón.
  PANEL_URL: "",

  // Nombre remitente visible en el correo.
  REMITENTE: "SSOMA · ON Infraestructura",

  // A partir de cuántos días pendiente se resalta la fila en rojo (nudge de antigüedad).
  DIAS_ALERTA: 3,

  // Tope de filas por correo (evita correos gigantes si un área acumula mucho).
  // Si se supera, la tabla muestra las más antiguas y agrega «… y N más».
  MAX_FILAS: 80,

  // Auditoría: registra cada corrida en una pestaña del MISMO libro de "Registros"
  // (fecha, pendientes, correos enviados, errores). Ponlo en false para no escribir nada.
  REGISTRAR_ENVIOS: true,
  HOJA_LOG_ENVIOS: "Correos enviados",

  // Paleta (igual que el panel / SEG-F-010).
  COLOR_NAVY: "#0c4a6e", COLOR_CELESTE: "#0284c7", COLOR_SLATE: "#f1f5f9"
};


// ============================================================
//  FUNCIÓN PRINCIPAL — la ejecuta el trigger diario (9:00)
// ============================================================
function enviarCorreosPendientesATS() { return _correosPendientesATS(false); }

// Igual, pero forzando el envío ahora (para probar a mano desde el editor).
function enviarCorreosPendientesATSAhora() { return _correosPendientesATS(false); }

// Vista previa: NO envía; escribe en el Registro de ejecución qué se mandaría.
function previewCorreosPendientesATS() { return _correosPendientesATS(true); }


function _correosPendientesATS(dryRun) {
  var pendientes = _leerPendientesATS();                 // registros con Estado == Pendiente
  var grupos     = _agruparPorArea(pendientes);          // { areaKey: [registros...] }
  var roster     = _rosterDestinatarios();               // [{area,nombre,correo,rol}]
  var ssoma      = _destinatariosSSOMA(roster);          // [correos]
  var hoyTxt     = _fechaLarga(new Date());
  var resumen    = { fecha: hoyTxt, totalPendientes: pendientes.length, areasEnviadas: 0,
                     correosEnviados: 0, sinDestinatario: [], errores: [], dryRun: !!dryRun };

  // Fail-safe: hay pendientes pero el roster (hoja "Jefes") vino vacío → no se enviará
  // nada. Se avisa en vez de fallar en silencio (evita creer que "todo está al día").
  if (pendientes.length && !roster.length) {
    var av = "Hay " + pendientes.length + " pendientes pero la hoja «Jefes» no devolvió destinatarios; " +
             "no se enviarán correos. Revisa que la hoja tenga filas con correo (o ROSTER_FALLBACK).";
    resumen.errores.push(av);
    Logger.log("⚠ " + av);
  }

  // Cuántos correos vamos a mandar (para avisar si la cuota de Gmail no alcanza).
  var porEnviar = 0;
  Object.keys(grupos).forEach(function (a) { if (grupos[a].length && _correosDeArea(roster, a).length) porEnviar++; });
  if (ssoma.length && (pendientes.length > 0 || CFG_CORREO_ATS.ENVIAR_SSOMA_SI_VACIO)) porEnviar++;
  if (!dryRun) _verificarCuota(porEnviar, resumen);

  // ── 1) Un correo por ÁREA con sus pendientes ──────────────────
  Object.keys(grupos).sort().forEach(function (areaKey) {
    var regs = grupos[areaKey];
    if (!regs.length) return;
    var destinos = _correosDeArea(roster, areaKey);
    if (!destinos.length) {                               // nadie a quién enviar: lo verá SSOMA en el resumen
      resumen.sinDestinatario.push(areaKey + " (" + regs.length + ")");
      return;
    }
    var asunto = "[SSOMA] ATS y Charlas pendientes de aprobar — " + areaKey + " (" + regs.length + ") · " + hoyTxt;
    if (dryRun) {
      Logger.log("→ ÁREA «" + areaKey + "» a [" + destinos.join(", ") + "] · " + regs.length + " pendientes");
    } else if (_enviar(destinos, asunto, _htmlCorreoArea(areaKey, regs, hoyTxt), resumen)) {
      resumen.correosEnviados++;
    }
    resumen.areasEnviadas++;
  });

  // ── 2) Resumen consolidado al EQUIPO SSOMA ───────────────────
  if (ssoma.length && (pendientes.length > 0 || CFG_CORREO_ATS.ENVIAR_SSOMA_SI_VACIO)) {
    var asuntoS = "[SSOMA] Resumen diario — ATS y Charlas pendientes de aprobar (" + pendientes.length + ") · " + hoyTxt;
    if (dryRun) {
      Logger.log("→ SSOMA a [" + ssoma.join(", ") + "] · total " + pendientes.length + " pendientes");
    } else if (_enviar(ssoma, asuntoS, _htmlCorreoSSOMA(grupos, roster, hoyTxt, resumen.sinDestinatario), resumen)) {
      resumen.correosEnviados++;
    }
  }

  if (!dryRun) _registrarEnvio(resumen);
  Logger.log((dryRun ? "[PREVIEW] " : "[ENVIADO] ") + JSON.stringify(resumen));
  return resumen;
}

// Envío con captura de error por-correo: un destinatario inválido NO frena el resto
// (p. ej. el resumen a SSOMA sale aunque falle el correo de un área).
function _enviar(destinos, asunto, html, resumen) {
  try {
    MailApp.sendEmail({ to: destinos.join(","), subject: asunto, htmlBody: html, name: CFG_CORREO_ATS.REMITENTE });
    return true;
  } catch (err) {
    var msg = "Fallo al enviar «" + asunto + "» a [" + destinos.join(", ") + "]: " + (err && err.message || err);
    resumen.errores.push(msg);
    Logger.log("⚠ " + msg);
    return false;
  }
}

// Avisa (no bloquea) si la cuota diaria de Gmail no cubre los correos a enviar.
function _verificarCuota(porEnviar, resumen) {
  try {
    var quedan = MailApp.getRemainingDailyQuota();
    if (porEnviar > quedan) {
      var msg = "Cuota de correo insuficiente: se necesitan " + porEnviar + " y quedan " + quedan +
                " hoy. Algunos correos podrían no enviarse.";
      resumen.errores.push(msg);
      Logger.log("⚠ " + msg);
    }
  } catch (e) { /* getRemainingDailyQuota no disponible: seguir igual */ }
}


// ============================================================
//  LECTURA DE PENDIENTES — hoja "Registros" (Estado == Pendiente)
// ============================================================
function _leerPendientesATS() {
  var id = CFG_CORREO_ATS.LOG_SHEET_ID;
  if (!id) { Logger.log("⚠ LOG_SHEET_ID vacío: configura la hoja 'Registros'."); return []; }
  var sh;
  try {
    sh = SpreadsheetApp.openById(id).getSheetByName(CFG_CORREO_ATS.LOG_SHEET_NAME);
  } catch (err) {
    Logger.log("⚠ No se pudo abrir la hoja Registros (" + id + "): " + err +
               "\n  Asegúrate de que este proyecto corre con la cuenta que posee/comparte esa hoja.");
    return [];
  }
  if (!sh || sh.getLastRow() < 2) return [];

  // Cols (1-based): 1 Recibido · 2 Tipo · 3 Cliente · 4 Circuito · 5 Fecha ·
  //   6 Cuadrilla · 7 Área · 8 División · 9 N°archivos · 10 Carpeta · 11 Archivos · 12 Estado ...
  var lastCol = Math.max(12, sh.getLastColumn());
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
  var out = [];
  var pend = _norm(CFG_CORREO_ATS.ESTADO_PENDIENTE);
  for (var i = 0; i < d.length; i++) {
    var r = d[i];
    var estado = _norm(r[11] || "Pendiente");            // col 12; si falta, se asume Pendiente
    if (estado !== pend) continue;
    var area = String(r[6] || "").trim();
    var division = String(r[7] || "").trim();
    out.push({
      recibido:  r[0],
      tipo:      _tipoCorto(r[1]),
      cliente:   String(r[2] || "").trim(),
      circuito:  String(r[3] || "").trim(),
      fecha:     _fechaISO(r[4]),
      cuadrilla: String(r[5] || "").trim(),
      area:      area,
      division:  division,
      archivos:  (+(r[8] || 0)) || 0,
      carpeta:   String(r[9] || "").trim(),
      areaKey:   _areaKey(area, division),
      dias:      _diasDesde(r[0])
    });
  }
  // Más antiguos primero (los que llevan más días pendientes arriba).
  out.sort(function (a, b) { return (b.dias - a.dias) || (a.areaKey < b.areaKey ? -1 : 1); });
  return out;
}

function _agruparPorArea(pendientes) {
  var g = {};
  pendientes.forEach(function (p) { (g[p.areaKey] = g[p.areaKey] || []).push(p); });
  return g;
}

// (área, división) → clave de área del panel. Mismo criterio que mapArea() de index.html:
// "ÁREA ▸ División" (o sólo el área si no hay división).
function _areaKey(area, division) {
  area = String(area || "").trim(); division = String(division || "").trim();
  if (!area && !division) return "Sin área";
  return division ? (area + " ▸ " + division) : area;
}

function _tipoCorto(t) {
  return /charla|5\s*min/i.test(String(t || "")) ? "Charla 5 min" : "ATS";
}


// ============================================================
//  DESTINATARIOS — hoja "Jefes" (con respaldo a CFG.ROSTER_FALLBACK)
// ============================================================
function _rosterDestinatarios() {
  var jefes = _leerJefes();
  // Normaliza a {area,nombre,correo,rol} y descarta filas sin correo válido.
  return jefes.map(function (j) {
    return { area: String(j.area || "").trim(), nombre: String(j.nombre || "").trim(),
             correo: String(j.correo || "").trim(), rol: String(j.rol || "").trim() };
  }).filter(function (j) { return _emailValido(j.correo); });
}

// Lee el roster "Jefes" de forma robusta, en este orden:
//   1) Por ID explícito (CFG.JEFES_SHEET_ID) → no depende del enlace del proyecto.
//   2) Hoja ACTIVA (si el proyecto está enlazado a la hoja que tiene la pestaña Jefes).
//   3) CFG.ROSTER_FALLBACK.
function _leerJefes() {
  if (CFG_CORREO_ATS.JEFES_SHEET_ID) {
    try {
      var sh = SpreadsheetApp.openById(CFG_CORREO_ATS.JEFES_SHEET_ID)
                             .getSheetByName(CFG_CORREO_ATS.HOJA_JEFES);
      var r = _parseJefes(sh);
      if (r.length) return r;
      Logger.log("⚠ La pestaña «" + CFG_CORREO_ATS.HOJA_JEFES + "» (por ID) está vacía o no existe.");
    } catch (e) {
      Logger.log("⚠ No se pudo leer Jefes por ID (" + CFG_CORREO_ATS.JEFES_SHEET_ID + "): " + e);
    }
  }

  // 1b) Sin ID → BUSCA la hoja por NOMBRE en el Drive de la cuenta que ejecuta el
  //     script (ssomaoni posee "SEG-F-010 Respuestas 2026"). Cero configuración.
  if (CFG_CORREO_ATS.JEFES_SHEET_FILENAME) {
    try {
      var it = DriveApp.getFilesByName(CFG_CORREO_ATS.JEFES_SHEET_FILENAME);
      while (it.hasNext()) {
        var f = it.next();
        if (f.isTrashed && f.isTrashed()) continue;               // ignora papelera
        try {
          var shN = SpreadsheetApp.openById(f.getId()).getSheetByName(CFG_CORREO_ATS.HOJA_JEFES);
          var rN = _parseJefes(shN);
          if (rN.length) {
            Logger.log("✔ Roster «Jefes» hallado por nombre en «" + CFG_CORREO_ATS.JEFES_SHEET_FILENAME +
                       "» (id " + f.getId() + "): " + rN.length + " filas.");
            return rN;
          }
        } catch (eOpen) { /* archivo con ese nombre que no es la hoja correcta: seguir */ }
      }
      Logger.log("⚠ No se encontró una hoja «" + CFG_CORREO_ATS.JEFES_SHEET_FILENAME +
                 "» con pestaña «" + CFG_CORREO_ATS.HOJA_JEFES + "» y filas.");
    } catch (eDrive) {
      Logger.log("⚠ Búsqueda de Jefes por nombre falló (¿permiso de Drive?): " + eDrive);
    }
  }

  // 2) Reutiliza el roster del backend del panel SI existe, sea cual sea su nombre
  //    (_rosterJefes en unas versiones, _obtenerJefes en otras). Guardado con typeof
  //    para no romper si la función no está definida en este proyecto. Best-effort:
  //    si el backend también lee la hoja activa y el proyecto es standalone, vendrá
  //    vacío → por eso el camino confiable es (1) por ID.
  try {
    var crudo = null;
    if (typeof _rosterJefes === "function")       crudo = _rosterJefes();
    else if (typeof _obtenerJefes === "function") crudo = _obtenerJefes();
    var jefes = _comoListaJefes(crudo);
    if (jefes.length) return jefes;
  } catch (e2) { Logger.log("⚠ Roster del backend no utilizable: " + e2); }

  // 3) Respaldo configurado (normalmente vacío).
  return CFG_CORREO_ATS.ROSTER_FALLBACK || [];
}

// Acepta lo que devuelva el backend: {jefes:[...]} o directamente [...] de objetos
// {area,nombre,dni,correo,rol}. Devuelve siempre una lista normalizada.
function _comoListaJefes(x) {
  var arr = !x ? [] : (Array.isArray(x) ? x : (Array.isArray(x.jefes) ? x.jefes : []));
  return arr.map(function (j) {
    return { area:   String(j.area   || "").trim(), nombre: String(j.nombre || "").trim(),
             dni:    String(j.dni    || "").trim(), correo: String(j.correo || "").trim(),
             rol:    String(j.rol    || "").trim() };
  });
}

// Convierte la pestaña "Jefes" (area | nombre | dni | correo | rol) en objetos.
function _parseJefes(sh) {
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][1]) continue;                              // sin nombre → fila vacía
    out.push({
      area:   String(d[i][0] || "").trim(),
      nombre: String(d[i][1] || "").trim(),
      dni:    String(d[i][2] || "").trim(),
      correo: String(d[i][3] || "").trim(),
      rol:    String(d[i][4] || "").trim()
    });
  }
  return out;
}

// Equipo SSOMA = jefes con area "*" o rol que contenga "ssoma", + EXTRA_SSOMA.
function _destinatariosSSOMA(roster) {
  var set = {};
  roster.forEach(function (j) {
    if (j.area === "*" || _norm(j.rol).indexOf("ssoma") >= 0) set[j.correo.toLowerCase()] = j.correo;
  });
  (CFG_CORREO_ATS.EXTRA_SSOMA || []).forEach(function (c) {
    c = String(c || "").trim(); if (_emailValido(c)) set[c.toLowerCase()] = c;
  });
  return Object.keys(set).map(function (k) { return set[k]; });
}

// Correos de los jefes de un área concreta (areaKey = "ÁREA ▸ División").
// Empareja por: override manual, clave completa, área amplia sola o división sola
// (así el jefe "NORMALIZACIÓN DE RED" calza con la división "Normalización de Red").
// Nunca incluye a los usuarios SSOMA (area "*"): esos reciben el resumen aparte.
function _correosDeArea(roster, areaKey) {
  var partes   = String(areaKey).split(" ▸ ");
  var amplia   = _norm(partes[0] || "");
  var division = _norm(partes.length > 1 ? partes[1] : "");
  var override = _norm(CFG_CORREO_ATS.OVERRIDE_AREA[areaKey] || "");
  var claves   = {}; [_norm(areaKey), amplia, division, override].forEach(function (k) { if (k) claves[k] = 1; });

  var set = {};
  roster.forEach(function (j) {
    if (j.area === "*") return;                            // SSOMA no cuenta como "jefe de área"
    if (claves[_norm(j.area)]) set[j.correo.toLowerCase()] = j.correo;
  });
  return Object.keys(set).map(function (k) { return set[k]; });
}

function _emailValido(c) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || "").trim()); }


// ============================================================
//  PLANTILLAS HTML DE CORREO
// ============================================================
function _htmlCorreoArea(areaKey, regs, hoyTxt) {
  var nAts    = regs.filter(function (r) { return r.tipo === "ATS"; }).length;
  var nCharla = regs.length - nAts;
  var intro = "Estos son los registros de <b>ATS</b> y <b>Charla de 5 minutos</b> de su área que están " +
              "<b>pendientes de aprobar</b>. Por favor revíselos y apruébelos (o anúlelos) desde el panel.";
  return _envolturaCorreo(
    "ATS y Charlas pendientes de aprobar",
    areaKey,
    hoyTxt,
    intro,
    _chips([["Pendientes", regs.length], ["ATS", nAts], ["Charlas", nCharla]]),
    _tablaRegistros(regs)
  );
}

function _htmlCorreoSSOMA(grupos, roster, hoyTxt, sinDestinatario) {
  var c = CFG_CORREO_ATS;
  var areas = Object.keys(grupos).sort();
  var total = 0; areas.forEach(function (a) { total += grupos[a].length; });
  var nAts = 0; areas.forEach(function (a) { grupos[a].forEach(function (r) { if (r.tipo === "ATS") nAts++; }); });
  var nCharla = total - nAts;

  var cuerpo = "";
  if (!total) {
    cuerpo = '<p style="margin:16px 0;padding:14px 16px;background:#ecfdf5;border:1px solid #a7f3d0;' +
             'border-radius:10px;color:#065f46;font-size:14px;">✅ No hay ATS ni Charlas pendientes de aprobar. ¡Todo al día!</p>';
  } else {
    areas.forEach(function (areaKey) {
      var regs = grupos[areaKey];
      var destinos = _correosDeArea(roster, areaKey);
      var aviso = destinos.length ? "" :
        ' <span style="color:#b45309;font-weight:600;">(sin jefe con correo en la hoja «Jefes»)</span>';
      cuerpo += '<h3 style="margin:22px 0 8px;font-size:15px;color:' + c.COLOR_NAVY + ';">' +
                _esc(areaKey) + ' <span style="color:#64748b;font-weight:500;">· ' + regs.length + ' pendiente' +
                (regs.length === 1 ? '' : 's') + '</span>' + aviso + '</h3>' +
                _tablaRegistros(regs);
    });
  }

  var intro = "Resumen consolidado de <b>ATS</b> y <b>Charlas de 5 minutos</b> " +
              "<b>pendientes de aprobar</b> en todas las áreas. Cada jefe de área recibió por separado el detalle de la suya.";
  return _envolturaCorreo(
    "Resumen diario · ATS y Charlas pendientes de aprobar",
    "Equipo SSOMA · Todas las áreas",
    hoyTxt,
    intro,
    _chips([["Total pendientes", total], ["ATS", nAts], ["Charlas", nCharla], ["Áreas", areas.length]]),
    cuerpo
  );
}

// Envoltura común (cabecera navy, chips, cuerpo, pie).
function _envolturaCorreo(titulo, subtitulo, hoyTxt, introHtml, chipsHtml, cuerpoHtml) {
  var c = CFG_CORREO_ATS;
  var boton = c.PANEL_URL
    ? '<a href="' + _esc(c.PANEL_URL) + '" style="display:inline-block;margin-top:6px;background:' + c.COLOR_CELESTE +
      ';color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Abrir el panel</a>'
    : '';
  return '' +
  '<div style="background:' + c.COLOR_SLATE + ';padding:24px 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.12);">' +
      '<div style="background:linear-gradient(90deg,' + c.COLOR_NAVY + ',' + c.COLOR_CELESTE + ');padding:22px 26px;color:#fff;">' +
        '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">SSOMA · ON Infraestructura</div>' +
        '<div style="font-size:20px;font-weight:700;margin-top:4px;">' + _esc(titulo) + '</div>' +
        '<div style="font-size:14px;margin-top:2px;opacity:.92;">' + _esc(subtitulo) + ' · ' + _esc(hoyTxt) + '</div>' +
      '</div>' +
      '<div style="padding:22px 26px;color:#0f172a;">' +
        '<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#334155;">' + introHtml + '</p>' +
        chipsHtml +
        cuerpoHtml +
        boton +
        '<p style="margin:22px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:14px;">' +
          'Correo automático del Panel SSOMA. Se envía todos los días a las ' + c.HORA_ENVIO + ':00 con los ATS y ' +
          'Charlas de 5 minutos que siguen en estado <b>Pendiente</b>. No respondas a este mensaje.' +
        '</p>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Fila de "chips" con contadores.
function _chips(pares) {
  var c = CFG_CORREO_ATS;
  var s = '<div style="margin:0 0 6px;">';
  pares.forEach(function (p) {
    s += '<span style="display:inline-block;margin:0 8px 8px 0;background:' + c.COLOR_SLATE + ';border:1px solid #e2e8f0;' +
         'border-radius:999px;padding:6px 14px;font-size:13px;color:' + c.COLOR_NAVY + ';">' +
         '<b style="font-size:15px;">' + p[1] + '</b> &nbsp;' + _esc(p[0]) + '</span>';
  });
  return s + '</div>';
}

// Tabla de registros pendientes. Respeta MAX_FILAS (con nota de desborde) y DIAS_ALERTA.
function _tablaRegistros(regs) {
  var c = CFG_CORREO_ATS;
  var tope = Math.max(1, c.MAX_FILAS || 80);
  var ocultas = Math.max(0, regs.length - tope);
  var visibles = ocultas ? regs.slice(0, tope) : regs;
  var th = 'padding:9px 10px;text-align:left;font-size:12px;color:#fff;font-weight:600;white-space:nowrap;';
  var td = 'padding:9px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #eef2f7;vertical-align:top;';
  var head =
    '<th style="' + th + '">Fecha</th>' +
    '<th style="' + th + '">Tipo</th>' +
    '<th style="' + th + '">Cliente</th>' +
    '<th style="' + th + '">Circuito</th>' +
    '<th style="' + th + '">Cuadrilla</th>' +
    '<th style="' + th + '">División</th>' +
    '<th style="' + th + '">Arch.</th>' +
    '<th style="' + th + '">Días</th>' +
    '<th style="' + th + '">Evidencia</th>';
  var rows = visibles.map(function (r) {
    var tipoColor = r.tipo === "ATS" ? c.COLOR_NAVY : c.COLOR_CELESTE;
    var link = r.carpeta
      ? '<a href="' + _esc(r.carpeta) + '" style="color:' + c.COLOR_CELESTE + ';text-decoration:none;font-weight:600;">Abrir ▸</a>'
      : '<span style="color:#94a3b8;">—</span>';
    var diasBadge = r.dias >= (c.DIAS_ALERTA || 3)
      ? '<span style="background:#fef2f2;color:#b91c1c;border-radius:6px;padding:2px 8px;font-weight:600;">' + r.dias + '</span>'
      : String(r.dias);
    return '<tr>' +
      '<td style="' + td + 'white-space:nowrap;">' + _esc(r.fecha) + '</td>' +
      '<td style="' + td + '"><span style="color:' + tipoColor + ';font-weight:600;">' + _esc(r.tipo) + '</span></td>' +
      '<td style="' + td + '">' + _esc(r.cliente || "—") + '</td>' +
      '<td style="' + td + '">' + _esc(r.circuito || "—") + '</td>' +
      '<td style="' + td + '">' + _esc(r.cuadrilla || "—") + '</td>' +
      '<td style="' + td + '">' + _esc(r.division || "—") + '</td>' +
      '<td style="' + td + 'text-align:center;">' + (r.archivos || 0) + '</td>' +
      '<td style="' + td + 'text-align:center;">' + diasBadge + '</td>' +
      '<td style="' + td + '">' + link + '</td>' +
    '</tr>';
  }).join("");
  var masNota = ocultas
    ? '<p style="margin:6px 0 0;font-size:12px;color:#64748b;">… y ' + ocultas +
      ' registro' + (ocultas === 1 ? '' : 's') + ' más pendiente' + (ocultas === 1 ? '' : 's') +
      ' (se muestran los ' + tope + ' más antiguos). Revisa el resto en el panel.</p>'
    : '';
  return '<div style="overflow-x:auto;margin:8px 0 4px;">' +
    '<table style="border-collapse:collapse;width:100%;min-width:560px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">' +
      '<thead><tr style="background:' + c.COLOR_NAVY + ';">' + head + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' + masNota;
}


// ============================================================
//  TRIGGER — envío diario a las 9:00 (zona horaria del PROYECTO)
// ============================================================
function crearTriggerCorreosPendientesATS() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "enviarCorreosPendientesATS"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("enviarCorreosPendientesATS")
    .timeBased().everyDays(1).atHour(CFG_CORREO_ATS.HORA_ENVIO).create();
  Logger.log("✅ Trigger 'enviarCorreosPendientesATS' creado: cada día a las " + CFG_CORREO_ATS.HORA_ENVIO +
             ":00 (zona horaria del proyecto: " + Session.getScriptTimeZone() + ").");
}

// Elimina el trigger diario (por si quieres pausar los envíos).
function borrarTriggerCorreosPendientesATS() {
  var n = 0;
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "enviarCorreosPendientesATS"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  Logger.log("🗑 Triggers eliminados: " + n);
  return n;
}


// ============================================================
//  UTILIDADES locales (las genéricas _norm/_fechaISO/_obtenerJefes
//  viven en Panel_Backend.gs y se reutilizan desde aquí).
// ============================================================
function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _diasDesde(raw) {
  var d = (raw instanceof Date) ? raw : new Date(raw);
  if (isNaN(d.getTime())) return 0;
  var ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
function _fechaLarga(d) {
  try {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "EEEE d 'de' MMMM 'de' yyyy");
  } catch (e) { return _fechaISO(d); }
}

// Auditoría: agrega una fila por corrida en la pestaña HOJA_LOG_ENVIOS del mismo
// libro de "Registros" (no toca los datos de ATS/Charla). Best-effort: si falla,
// no interrumpe el envío. Se desactiva con CFG_CORREO_ATS.REGISTRAR_ENVIOS = false.
function _registrarEnvio(resumen) {
  if (!CFG_CORREO_ATS.REGISTRAR_ENVIOS || !CFG_CORREO_ATS.LOG_SHEET_ID) return;
  try {
    var ss = SpreadsheetApp.openById(CFG_CORREO_ATS.LOG_SHEET_ID);
    var sh = ss.getSheetByName(CFG_CORREO_ATS.HOJA_LOG_ENVIOS);
    if (!sh) {
      sh = ss.insertSheet(CFG_CORREO_ATS.HOJA_LOG_ENVIOS);
      sh.appendRow(["Ejecutado", "Total pendientes", "Áreas notificadas", "Correos enviados",
                    "Áreas sin destinatario", "Errores"]);
    }
    sh.appendRow([
      new Date(),
      resumen.totalPendientes,
      resumen.areasEnviadas,
      resumen.correosEnviados,
      (resumen.sinDestinatario || []).join(" · "),
      (resumen.errores || []).join(" · ")
    ]);
  } catch (e) {
    Logger.log("⚠ No se pudo registrar el envío en la hoja de auditoría: " + e);
  }
}
