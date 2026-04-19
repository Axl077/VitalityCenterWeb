const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'vitality-center-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.static(path.join(__dirname, 'public')));

// ===============================
// HELPERS
// ===============================
function sendError(res, message, code = 500) {
  return res.status(code).json({
    ok: false,
    message
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      ok: false,
      message: 'No autorizado'
    });
  }
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      telefono VARCHAR(30) NOT NULL UNIQUE,
      email VARCHAR(120),
      fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suscripciones (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      tipo VARCHAR(30) NOT NULL,
      fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
      fecha_fin DATE NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      precio NUMERIC(10,2) DEFAULT 0,
      creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asistencias (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ===============================
// RUTAS BASE
// ===============================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'Servidor y base de datos funcionando' });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error verificando sistema');
  }
});

// ===============================
// AUTH ADMIN
// ===============================
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;

  if (user === 'admin' && pass === 'admin123') {
    req.session.admin = true;
    req.session.user = user;
    return res.json({
      ok: true,
      message: 'Login correcto'
    });
  }

  return sendError(res, 'Credenciales inválidas', 401);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true,
      message: 'Sesión cerrada'
    });
  });
});

app.get('/api/admin/session', (req, res) => {
  res.json({
    ok: true,
    admin: !!req.session.admin
  });
});

// ===============================
// CLIENTES
// ===============================
app.post('/api/clientes', async (req, res) => {
  const { nombre, telefono, email } = req.body;

  if (!nombre || !telefono) {
    return sendError(res, 'Nombre y teléfono son obligatorios', 400);
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO clientes(nombre, telefono, email)
      VALUES($1, $2, $3)
      RETURNING *
      `,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null]
    );

    res.json({
      ok: true,
      cliente: result.rows[0]
    });
  } catch (err) {
    console.error(err);

    if (err.code === '23505') {
      return sendError(res, 'Ya existe un cliente con ese teléfono', 400);
    }

    sendError(res, 'Error creando cliente');
  }
});

app.get('/api/clientes', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.nombre,
        c.telefono,
        c.email,
        c.fecha_registro,
        (
          SELECT COUNT(*)
          FROM asistencias a
          WHERE a.cliente_id = c.id
        ) AS total_asistencias
      FROM clientes c
      ORDER BY c.id DESC
    `);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error listando clientes');
  }
});

app.get('/api/clientes/:telefono', async (req, res) => {
  const { telefono } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.nombre,
        c.telefono,
        c.email,
        c.fecha_registro,
        s.id AS suscripcion_id,
        s.tipo,
        s.fecha_inicio,
        s.fecha_fin,
        s.activa,
        s.precio
      FROM clientes c
      LEFT JOIN LATERAL (
        SELECT *
        FROM suscripciones
        WHERE cliente_id = c.id
        ORDER BY id DESC
        LIMIT 1
      ) s ON true
      WHERE c.telefono = $1
      `,
      [telefono]
    );

    if (result.rows.length === 0) {
      return sendError(res, 'Cliente no encontrado', 404);
    }

    res.json({
      ok: true,
      cliente: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error buscando cliente');
  }
});

app.put('/api/clientes/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, email } = req.body;

  if (!nombre || !telefono) {
    return sendError(res, 'Nombre y teléfono son obligatorios', 400);
  }

  try {
    const result = await pool.query(
      `
      UPDATE clientes
      SET nombre = $1, telefono = $2, email = $3
      WHERE id = $4
      RETURNING *
      `,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null, id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 'Cliente no encontrado', 404);
    }

    res.json({
      ok: true,
      cliente: result.rows[0]
    });
  } catch (err) {
    console.error(err);

    if (err.code === '23505') {
      return sendError(res, 'Ya existe otro cliente con ese teléfono', 400);
    }

    sendError(res, 'Error actualizando cliente');
  }
});

app.delete('/api/clientes/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM clientes WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 'Cliente no encontrado', 404);
    }

    res.json({
      ok: true,
      message: 'Cliente eliminado'
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error eliminando cliente');
  }
});

// ===============================
// SUSCRIPCIONES
// ===============================
app.post('/api/suscripciones', async (req, res) => {
  const { cliente_id, tipo, fecha_fin, precio } = req.body;

  if (!cliente_id || !tipo || !fecha_fin) {
    return sendError(res, 'Faltan datos para registrar suscripción', 400);
  }

  try {
    await pool.query(
      `UPDATE suscripciones SET activa = false WHERE cliente_id = $1 AND activa = true`,
      [cliente_id]
    );

    const result = await pool.query(
      `
      INSERT INTO suscripciones(cliente_id, tipo, fecha_inicio, fecha_fin, activa, precio)
      VALUES($1, $2, CURRENT_DATE, $3, true, $4)
      RETURNING *
      `,
      [cliente_id, tipo, fecha_fin, precio || 0]
    );

    res.json({
      ok: true,
      suscripcion: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error registrando suscripción');
  }
});

app.post('/api/cancelar', async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return sendError(res, 'ID requerido', 400);
  }

  try {
    const result = await pool.query(
      `
      UPDATE suscripciones
      SET activa = false
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 'Suscripción no encontrada', 404);
    }

    res.json({
      ok: true,
      suscripcion: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error cancelando suscripción');
  }
});

app.get('/api/suscripciones', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.cliente_id,
        c.nombre,
        c.telefono,
        s.tipo,
        s.fecha_inicio,
        s.fecha_fin,
        s.activa,
        s.precio
      FROM suscripciones s
      INNER JOIN clientes c ON c.id = s.cliente_id
      ORDER BY s.id DESC
    `);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error listando suscripciones');
  }
});

// ===============================
// ASISTENCIAS
// ===============================
app.post('/api/asistencias', async (req, res) => {
  const { cliente_id } = req.body;

  if (!cliente_id) {
    return sendError(res, 'Cliente requerido', 400);
  }

  try {
    const suscripcion = await pool.query(
      `
      SELECT *
      FROM suscripciones
      WHERE cliente_id = $1
        AND activa = true
        AND fecha_fin >= CURRENT_DATE
      ORDER BY id DESC
      LIMIT 1
      `,
      [cliente_id]
    );

    if (suscripcion.rows.length === 0) {
      return sendError(res, 'El cliente no tiene suscripción activa', 400);
    }

    const result = await pool.query(
      `
      INSERT INTO asistencias(cliente_id)
      VALUES($1)
      RETURNING *
      `,
      [cliente_id]
    );

    res.json({
      ok: true,
      asistencia: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error registrando asistencia');
  }
});

app.get('/api/asistencias', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.fecha,
        c.id AS cliente_id,
        c.nombre,
        c.telefono
      FROM asistencias a
      INNER JOIN clientes c ON c.id = a.cliente_id
      ORDER BY a.fecha DESC
    `);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error listando asistencias');
  }
});

// ===============================
// DASHBOARD ADMIN
// ===============================
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const totalClientes = await pool.query(`SELECT COUNT(*)::int AS total FROM clientes`);
    const totalActivas = await pool.query(`SELECT COUNT(*)::int AS total FROM suscripciones WHERE activa = true`);
    const totalVencidas = await pool.query(`SELECT COUNT(*)::int AS total FROM suscripciones WHERE fecha_fin < CURRENT_DATE`);
    const totalAsistenciasHoy = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM asistencias
      WHERE DATE(fecha) = CURRENT_DATE
    `);

    const vencenPronto = await pool.query(`
      SELECT
        c.nombre,
        c.telefono,
        s.tipo,
        s.fecha_fin
      FROM suscripciones s
      INNER JOIN clientes c ON c.id = s.cliente_id
      WHERE s.activa = true
        AND s.fecha_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      ORDER BY s.fecha_fin ASC
    `);

    res.json({
      ok: true,
      dashboard: {
        total_clientes: totalClientes.rows[0].total,
        suscripciones_activas: totalActivas.rows[0].total,
        suscripciones_vencidas: totalVencidas.rows[0].total,
        asistencias_hoy: totalAsistenciasHoy.rows[0].total,
        vencen_pronto: vencenPronto.rows
      }
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error cargando dashboard');
  }
});

app.get('/api/admin/listado', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id AS cliente_id,
        c.nombre,
        c.telefono,
        c.email,
        s.id AS sub_id,
        s.tipo,
        s.fecha_inicio,
        s.fecha_fin,
        s.activa,
        s.precio
      FROM clientes c
      LEFT JOIN LATERAL (
        SELECT *
        FROM suscripciones
        WHERE cliente_id = c.id
        ORDER BY id DESC
        LIMIT 1
      ) s ON true
      ORDER BY c.id DESC
    `);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Error listando administración');
  }
});

// ===============================
// FRONT ROUTES
// ===============================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===============================
// START
// ===============================
const PORT = process.env.PORT || 8080;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error inicializando la base de datos:', err);
  });