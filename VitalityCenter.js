const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: 'vitality-center-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// ===============================
// CONEXION POSTGRESQL
// ===============================
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: 'postgres',
      host: 'localhost',
      database: 'VitalityCenter',
      password: 'root',
      port: 5432
    });

pool.on('error', (err) => {
  console.error('Error inesperado en PostgreSQL:', err);
});

// ===============================
// AUTH SIMPLE
// ===============================
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'No autorizado' });
}

// ===============================
// PAGINAS
// ===============================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===============================
// LOGIN / LOGOUT
// ===============================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ message: 'Login correcto' });
  }

  return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!req.session.authenticated,
    username: req.session.username || null
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Sesión cerrada' });
  });
});

// ===============================
// HEALTH
// ===============================
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// ===============================
// MEMBRESIAS DISPONIBLES
// ===============================
app.get('/api/membresias', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id_membresia, nombre, duracion_dias, descuento_productos
      FROM membresia
      ORDER BY id_membresia
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener membresías' });
  }
});

// ===============================
// CLIENTES + SUSCRIPCION
// Registrar cliente con membresía
// ===============================
app.post('/api/clientes/registro-completo', requireAuth, async (req, res) => {
  const { nombre, telefono, correo, id_membresia, fecha_inicio } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const clienteInsert = await client.query(
      `INSERT INTO cliente (nombre, telefono, correo)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, telefono, correo]
    );

    const cliente = clienteInsert.rows[0];

    const membresiaInfo = await client.query(
      `SELECT id_membresia, duracion_dias
       FROM membresia
       WHERE id_membresia = $1`,
      [id_membresia]
    );

    if (membresiaInfo.rows.length === 0) {
      throw new Error('La membresía seleccionada no existe');
    }

    const duracion = membresiaInfo.rows[0].duracion_dias;

    const membresiaInsert = await client.query(
      `INSERT INTO cliente_membresia
       (id_cliente, id_membresia, fecha_inicio, fecha_fin, estado)
       VALUES (
         $1,
         $2,
         $3::date,
         ($3::date + ($4 || ' days')::interval)::date,
         'activa'
       )
       RETURNING *`,
      [cliente.id_cliente, id_membresia, fecha_inicio, duracion]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Cliente y suscripción registrados correctamente',
      cliente,
      suscripcion: membresiaInsert.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({
      error: 'Error al registrar cliente con suscripción',
      detalle: error.message
    });
  } finally {
    client.release();
  }
});

// ===============================
// LISTAR CLIENTES CON SUSCRIPCIONES
// ===============================
app.get('/api/clientes', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id_cliente,
        c.nombre,
        c.telefono,
        c.correo,
        cm.id_cliente_membresia,
        m.nombre AS membresia,
        cm.fecha_inicio,
        cm.fecha_fin,
        cm.estado
      FROM cliente c
      LEFT JOIN cliente_membresia cm ON c.id_cliente = cm.id_cliente
      LEFT JOIN membresia m ON cm.id_membresia = m.id_membresia
      ORDER BY c.id_cliente DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// ===============================
// BUSCAR CLIENTES
// ===============================
app.get('/api/clientes/buscar', requireAuth, async (req, res) => {
  const texto = req.query.texto || '';

  try {
    const result = await pool.query(
      `SELECT
         c.id_cliente,
         c.nombre,
         c.telefono,
         c.correo,
         cm.id_cliente_membresia,
         m.nombre AS membresia,
         cm.fecha_inicio,
         cm.fecha_fin,
         cm.estado
       FROM cliente c
       LEFT JOIN cliente_membresia cm ON c.id_cliente = cm.id_cliente
       LEFT JOIN membresia m ON cm.id_membresia = m.id_membresia
       WHERE c.nombre ILIKE $1 OR c.correo ILIKE $1
       ORDER BY c.id_cliente DESC`,
      [`%${texto}%`]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al buscar clientes' });
  }
});

// ===============================
// CANCELAR SUSCRIPCION
// ===============================
app.put('/api/suscripciones/:id/cancelar', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE cliente_membresia
       SET estado = 'cancelada'
       WHERE id_cliente_membresia = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }

    res.json({
      message: 'Suscripción cancelada correctamente',
      suscripcion: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al cancelar la suscripción' });
  }
});

// ===============================
// REACTIVAR SUSCRIPCION
// ===============================
app.put('/api/suscripciones/:id/reactivar', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE cliente_membresia
       SET estado = 'activa'
       WHERE id_cliente_membresia = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }

    res.json({
      message: 'Suscripción reactivada correctamente',
      suscripcion: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al reactivar la suscripción' });
  }
});

// ===============================
// AGREGAR NUEVA SUSCRIPCION A CLIENTE EXISTENTE
// ===============================
app.post('/api/suscripciones', requireAuth, async (req, res) => {
  const { id_cliente, id_membresia, fecha_inicio } = req.body;

  try {
    const membresiaInfo = await pool.query(
      `SELECT id_membresia, duracion_dias
       FROM membresia
       WHERE id_membresia = $1`,
      [id_membresia]
    );

    if (membresiaInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Membresía no encontrada' });
    }

    const duracion = membresiaInfo.rows[0].duracion_dias;

    const result = await pool.query(
      `INSERT INTO cliente_membresia
       (id_cliente, id_membresia, fecha_inicio, fecha_fin, estado)
       VALUES (
         $1,
         $2,
         $3::date,
         ($3::date + ($4 || ' days')::interval)::date,
         'activa'
       )
       RETURNING *`,
      [id_cliente, id_membresia, fecha_inicio, duracion]
    );

    res.json({
      message: 'Suscripción agregada correctamente',
      suscripcion: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al agregar la suscripción' });
  }
});

// ===============================
// CLIENTE PUEDE CANCELAR SU SUSCRIPCION
// (simulado por id de suscripción)
// ===============================
app.put('/api/cliente/cancelar/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE cliente_membresia
       SET estado = 'cancelada'
       WHERE id_cliente_membresia = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }

    res.json({
      message: 'Suscripción cancelada por el cliente',
      suscripcion: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al cancelar la suscripción' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});