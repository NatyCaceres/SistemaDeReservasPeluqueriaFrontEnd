// ====== Config ======
const API = "http://localhost:8080";

// Headers con JWT
const authHeaders = () => {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// ====== Estado en memoria ======
let servicios = [];
let trabajadores = [];
let reservasTrabajador = [];          // reservas del trabajador seleccionado (para pintar ocupado)
let disponibilidadesTrabajador = [];  // bloques disponibles (desde tabla horarios_disponibles)
let servicioSeleccionado = null;      // objeto servicio
let idTrabajadorSeleccionado = null;
let fechaSeleccionada = null;         // YYYY-MM-DD
let horarioSeleccionado = null;       // "HH:MM"

// ====== Helpers ======
function parseTimeToMinutes(t) {
  // t = "HH:MM:SS" o "HH:MM"
  const [hh, mm] = t.split(":").map(Number);
  return hh * 60 + mm;
}
function toHHMM(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
function addMinutes(hhmm, delta) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + delta;
  return toHHMM(total);
}
const pad2 = (n) => n.toString().padStart(2, "0");
const formatDateToHM = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

// Devuelve true si [inicioA, finA) se solapa con [inicioB, finB)
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// ====== Fetch API ======
async function getServiciosActivos() {
  const res = await fetch(`${API}/servicios/activos`, { headers: authHeaders() });
  if (!res.ok) throw new Error("No se pudo cargar servicios");
  return res.json();
}

async function getTrabajadoresPorServicio(idServicio) {
  const res = await fetch(`${API}/trabajadores-servicios/por-servicio/${idServicio}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("No se pudo cargar trabajadores");
  return res.json();
}

async function getReservasTrabajador(idTrabajador) {
  const res = await fetch(`${API}/reservas/trabajador/${idTrabajador}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("No se pudo cargar reservas del trabajador");
  return res.json();
}

async function getDisponibilidadesTrabajador(idTrabajador) {
  const res = await fetch(`${API}/horarios-disponibles/trabajador/${idTrabajador}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("No se pudo cargar disponibilidades");
  return res.json();
}

async function postCrearReserva(payload) {
  const res = await fetch(`${API}/reservas/crear`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Error HTTP ${res.status}`);
  }
  return res.json();
}

// ====== Render UI ======
const selServicio = document.getElementById("select-servicio");
const selTrabajador = document.getElementById("select-trabajador");
const btnRefrescar = document.getElementById("btn-refrescar");
const lblFecha = document.getElementById("fecha-seleccionada");
const contHorarios = document.getElementById("horarios");
const btnConfirmar = document.getElementById("btn-confirmar");

let calendar;

// Inicializa calendario
function initCalendar() {
  const calendarEl = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    height: "auto",
    selectable: true,
    locale: "es",

    // Formato por si el bundle global decide mostrar la hora
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },

    // 👇 Aquí personalizamos cómo se dibuja cada evento
    eventContent: (arg) => {
      const ev = arg.event;
      const tipo = ev.extendedProps?.tipo;

      if (tipo === 'reserva') {
        // Mostramos HH:MM Ocupado
        const hm = ev.start ? formatDateToHM(ev.start) : ' ';
        return { html: `<b>${hm}</b> <span>&nbsp;Ocupado</span>` };
      }

      if (tipo === 'disponible') {
        // Evento de día completo "Disponible"
        return { html: `<span>Disponible</span>` };
      }

      // Por defecto
      return { html: ev.title || '' };
    },

    // Con los bundles globales, NO declares plugins aquí
    dateClick: (info) => {
      if (!idTrabajadorSeleccionado || !servicioSeleccionado) {
        alert("Primero elige servicio y trabajador.");
        return;
      }
      fechaSeleccionada = info.dateStr;       // YYYY-MM-DD
      lblFecha.textContent = fechaSeleccionada;
      renderHorariosDeFecha(fechaSeleccionada);
    },
    events: [] // se llenará dinámicamente
  });
  calendar.render();
}

// Pinta eventos de ocupado/disponible en el calendario
function pintarEventosCalendario() {
  if (!calendar) return;
  calendar.removeAllEvents();

  // Ocupadas: reservas del trabajador
  reservasTrabajador.forEach(r => {
    // r.fecha: "YYYY-MM-DD", r.horaInicio: "HH:MM:SS"
    const start = `${r.fecha}T${r.horaInicio?.substring(0,5) || "00:00"}`;
    calendar.addEvent({
      title: "Ocupado",
      start,
      color: "#dc3545", // rojo
      extendedProps: { tipo: 'reserva' }
    });
  });

  // Disponibles (marcamos el día como disponible de forma informativa)
  const diasDisponibles = new Set(disponibilidadesTrabajador.map(d => d.fecha));
  diasDisponibles.forEach(f => {
    calendar.addEvent({
      title: "Disponible",
      start: f,
      allDay: true,
      color: "#198754", // verde
      extendedProps: { tipo: 'disponible' }
    });
  });
}

// Construye la grilla de horarios disponibles para la fecha seleccionada
function renderHorariosDeFecha(yyyy_mm_dd) {
  contHorarios.innerHTML = "";
  horarioSeleccionado = null;
  btnConfirmar.disabled = true;

  const durMin = servicioSeleccionado?.duracionEstimadaMinutos || 60;

  // 1) Tomar disponibilidades de ese día para el trabajador
  const bloquesDia = disponibilidadesTrabajador.filter(d => d.fecha === yyyy_mm_dd);
  if (bloquesDia.length === 0) {
    contHorarios.innerHTML = `<div class="text-muted">No hay disponibilidad para este día.</div>`;
    return;
  }

  // 2) Tomar reservas existentes del día seleccionado (para bloquear solapes)
  const reservasDia = reservasTrabajador.filter(r => r.fecha === yyyy_mm_dd).map(r => ({
    ini: parseTimeToMinutes(r.horaInicio),
    fin: parseTimeToMinutes(r.horaFin)
  }));

  // 3) Para cada bloque disponible, generar slots de duración "durMin" sin solaparse
  const botones = [];
  bloquesDia.forEach(b => {
    const inicio = parseTimeToMinutes(b.horaInicio);
    const fin = parseTimeToMinutes(b.horaFin);

    for (let t = inicio; t + durMin <= fin; t += 15) { // paso de 15 min
      const tFin = t + durMin;

      // ¿Se solapa con alguna reserva existente?
      const chocan = reservasDia.some(rr => overlaps(t, tFin, rr.ini, rr.fin));
      if (chocan) continue;

      const hhmm = toHHMM(t);
      const btn = document.createElement("button");
      btn.className = "btn btn-outline-success horario-btn";
      btn.textContent = `${hhmm}`;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".horario-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        horarioSeleccionado = hhmm;
        btnConfirmar.disabled = false;
      });
      botones.push(btn);
    }
  });

  if (botones.length === 0) {
    contHorarios.innerHTML = `<div class="text-muted">No hay horarios disponibles para la duración de este servicio.</div>`;
    return;
  }

  botones.forEach(b => contHorarios.appendChild(b));
}

// ====== Eventos de UI ======
selServicio.addEventListener("change", async () => {
  try {
    const idServicio = Number(selServicio.value);
    servicioSeleccionado = servicios.find(s => s.idServicio === idServicio) || null;

    selTrabajador.innerHTML = `<option value="" disabled selected>Cargando...</option>`;
    selTrabajador.disabled = true;

    trabajadores = await getTrabajadoresPorServicio(idServicio);

    selTrabajador.innerHTML = `<option value="" disabled selected>Elige un trabajador</option>`;
    trabajadores.forEach(t => {
      const opt = document.createElement("option");
      const id = t.idUsuario || t.id || t.id_trabajador;
      opt.value = id;
      opt.textContent = `${t.nombre} ${t.apellido}`;
      selTrabajador.appendChild(opt);
    });

    selTrabajador.disabled = false;

  } catch (e) {
    console.error(e);
    alert("No se pudieron cargar los trabajadores de este servicio.");
  }
});

selTrabajador.addEventListener("change", async () => {
  try {
    idTrabajadorSeleccionado = Number(selTrabajador.value);
    fechaSeleccionada = null;
    horarioSeleccionado = null;
    document.getElementById("fecha-seleccionada").textContent = "—";
    contHorarios.innerHTML = "";
    btnConfirmar.disabled = true;

    // Cargar reservas y disponibilidades
    [reservasTrabajador, disponibilidadesTrabajador] = await Promise.all([
      getReservasTrabajador(idTrabajadorSeleccionado),
      getDisponibilidadesTrabajador(idTrabajadorSeleccionado)
    ]);

    pintarEventosCalendario();
  } catch (e) {
    console.error(e);
    alert("No se pudieron cargar datos del trabajador.");
  }
});

btnRefrescar.addEventListener("click", async () => {
  if (!servicioSeleccionado || !idTrabajadorSeleccionado) return;
  selTrabajador.dispatchEvent(new Event("change"));
});

btnConfirmar.addEventListener("click", async () => {
  try {
    if (!servicioSeleccionado || !idTrabajadorSeleccionado || !fechaSeleccionada || !horarioSeleccionado) {
      alert("Selecciona servicio, trabajador, fecha y horario.");
      return;
    }

    const [hh, mm] = horarioSeleccionado.split(":").map(Number);
    const dur = servicioSeleccionado.duracionEstimadaMinutos || 60;

    // HH:mm de fin
    const horaFinHHMM = addMinutes(horarioSeleccionado, dur);
    const [hhf, mmf] = horaFinHHMM.split(":").map(Number);

    // Enviar strings "HH:mm:ss"
    const horaInicioStr = `${pad2(hh)}:${pad2(mm)}:00`;
    const horaFinStr    = `${pad2(hhf)}:${pad2(mmf)}:00`;

    const payload = {
      idTrabajador: idTrabajadorSeleccionado,
      idServicio: servicioSeleccionado.idServicio,
      fecha: fechaSeleccionada,     // "YYYY-MM-DD"
      horaInicio: horaInicioStr,    // "HH:mm:ss"
      horaFin: horaFinStr           // "HH:mm:ss"
    };

    await postCrearReserva(payload);
    alert("✅ Reserva creada con éxito.");
    // Recargar datos del trabajador para reflejar ocupado
    selTrabajador.dispatchEvent(new Event("change"));

  } catch (e) {
    console.error(e);
    alert("❌ Error al crear reserva: " + e.message);
  }
});

// ====== Init ======
window.addEventListener("DOMContentLoaded", async () => {
  // Comprobar token
  if (!localStorage.getItem("token")) {
    alert("Debes iniciar sesión para reservar.");
    // window.location.href = "index.html";
    // return;
  }

  try {
    servicios = await getServiciosActivos();
    selServicio.innerHTML = `<option value="" disabled selected>Elige un servicio</option>`;
    servicios.forEach(s => {
      // Campos esperados: idServicio, nombreServicio, duracionEstimadaMinutos...
      const opt = document.createElement("option");
      opt.value = s.idServicio;
      opt.textContent = `${s.nombreServicio} (${s.duracionEstimadaMinutos} min)`;
      selServicio.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
    alert("No se pudieron cargar los servicios.");
  }

  initCalendar();
});
