const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'vitality-secret',
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

// ================= DB =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= AUTH =================
const USER = 'admin';
const PASS = 'admin123';

function auth(req, res, next) {
  if (req.session.auth) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ================= LOGIN =================
app.post('/login', (req, res) => {
  const { user, pass } = req.body;

  if (user === USER && pass === PASS) {
    req.session.auth = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ error: 'Credenciales incorrectas' });
});

// ================= MEMBRESIAS =================
app.get('/membresias', async (req, res) => {
  const r = await pool.query('SELECT * FROM membresia');
  res.json(r.rows);
});

// ================= REGISTRAR CLIENTE (ADMIN) =================
app.post('/admin/registro', auth, async (req, res) => {
  const { nombre, telefono, correo, id_membresia, fecha_inicio } = req.body;

  try {
    const cliente = await pool.query(
      `INSERT INTO cliente(nombre, telefono, correo)
       VALUES($1,$2,$3) RETURNING *`,
      [nombre, telefono, correo]
    );

    const dur = await pool.query(
      `SELECT duracion_dias FROM membresia WHERE id_membresia=$1`,
      [id_membresia]
    );

    const dias = dur.rows[0].duracion_dias;

    await pool.query(
      `INSERT INTO cliente_membresia
      (id_cliente,id_membresia,fecha_inicio,fecha_fin,estado)
      VALUES($1,$2,$3,$3 + ($4 || ' days')::interval,'activa')`,
      [cliente.rows[0].id_cliente, id_membresia, fecha_inicio, dias]
    );

    res.json({ ok: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// ================= LISTADO =================
app.get('/clientes', auth, async (req, res) => {
  const r = await pool.query(`
    SELECT c.nombre,c.correo,
    cm.id_cliente_membresia,m.nombre AS membresia,cm.estado
    FROM cliente c
    LEFT JOIN cliente_membresia cm ON c.id_cliente=cm.id_cliente
    LEFT JOIN membresia m ON cm.id_membresia=m.id_membresia
  `);
  res.json(r.rows);
});

// ================= CANCELAR CLIENTE (PUBLICO) =================
app.put('/cancelar/:id', async (req, res) => {
  await pool.query(
    `UPDATE cliente_membresia SET estado='cancelada'
     WHERE id_cliente_membresia=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

// ================= ADMIN =================
app.put('/admin/cancelar/:id', auth, async (req, res) => {
  await pool.query(
    `UPDATE cliente_membresia SET estado='cancelada'
     WHERE id_cliente_membresia=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

app.put('/admin/reactivar/:id', auth, async (req, res) => {
  await pool.query(
    `UPDATE cliente_membresia SET estado='activa'
     WHERE id_cliente_membresia=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor activo');
});