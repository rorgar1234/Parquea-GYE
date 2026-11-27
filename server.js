const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const root = __dirname;
const PRIMARY_ADMIN_EMAIL = 'rogers1234800@gmail.com';
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'parquea-gye.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS parking_spaces (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL, address TEXT NOT NULL,
    price REAL NOT NULL CHECK(price > 0), unit TEXT NOT NULL DEFAULT 'hora', rating REAL NOT NULL,
    reviews INTEGER NOT NULL DEFAULT 0, capacity TEXT NOT NULL, features TEXT NOT NULL, tag TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES parking_spaces(id),
    date TEXT NOT NULL, time TEXT NOT NULL, hours INTEGER NOT NULL CHECK(hours > 0),
    vehicle TEXT NOT NULL, total REAL NOT NULL CHECK(total > 0), status TEXT NOT NULL DEFAULT 'Pendiente de pago',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT COLLATE NOCASE, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE,
    phone TEXT UNIQUE, whatsapp_opt_in INTEGER NOT NULL DEFAULT 0, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cliente', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
if (!userColumns.includes('whatsapp_opt_in')) db.exec('ALTER TABLE users ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
if (!userColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'cliente'");
db.exec('DROP INDEX IF EXISTS users_username_unique');
const usersSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (/username\s+TEXT\s+UNIQUE/i.test(usersSchema)) {
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    db.exec(`CREATE TABLE users_rebuild (
      id INTEGER PRIMARY KEY, username TEXT COLLATE NOCASE, name TEXT NOT NULL,
      email TEXT UNIQUE COLLATE NOCASE, phone TEXT UNIQUE, whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cliente', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users_rebuild (id,username,name,email,phone,whatsapp_opt_in,password_salt,password_hash,role,created_at)
      SELECT id,username,name,email,phone,whatsapp_opt_in,password_salt,password_hash,role,created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_rebuild RENAME TO users;
    COMMIT;`);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}
const refreshedUserColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!refreshedUserColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'cliente'");
const primaryAdmin = db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(PRIMARY_ADMIN_EMAIL);
if (primaryAdmin) db.prepare("UPDATE users SET role=CASE WHEN email=? COLLATE NOCASE THEN 'admin' WHEN role='admin' THEN 'cliente' ELSE role END").run(PRIMARY_ADMIN_EMAIL);
else db.prepare("UPDATE users SET role='cliente' WHERE role='admin'").run();
const reservationColumns = db.prepare('PRAGMA table_info(reservations)').all().map(column => column.name);
if (!reservationColumns.includes('user_id')) db.exec('ALTER TABLE reservations ADD COLUMN user_id INTEGER REFERENCES users(id)');
const seedSpaces = [
  [1,'Parqueo Las Peñas','Centro','Calle Numa Pompilio Llona, Las Peñas',1.5,'hora',4.9,128,['Auto','SUV'],['Cubierto','Cámaras','24 horas'],'Muy solicitado'],
  [2,'Espacio Urdesa Central','Urdesa','Av. Víctor Emilio Estrada, Urdesa',1.25,'hora',4.8,86,['Auto','Moto'],['Vigilancia','Iluminado','Fácil acceso'],'Buena ubicación'],
  [3,'Parking Kennedy Norte','Kennedy','Av. Francisco de Orellana, Kennedy',2,'hora',4.9,204,['Auto','SUV'],['Cubierto','Cámaras','Acceso controlado'],'Más reservado'],
  [4,'Parqueo Plaza Samborondón','Samborondón','Av. Samborondón, km 2.5',1.75,'hora',4.7,73,['Auto','SUV'],['Cubierto','Vigilancia','Espacioso'],'Espacio amplio'],
  [5,'Garaje Alborada','Alborada','Av. Rodolfo Baquerizo Nazur, Alborada',1,'hora',4.6,51,['Auto','Moto'],['Económico','Iluminado','Seguro'],'Mejor precio'],
  [6,'Parqueo Centro Malecón','Centro','Calle Panamá y Av. 9 de Octubre',1.5,'hora',4.8,162,['Auto','Moto','SUV'],['Cerca del Malecón','Cámaras','Cubierto'],'Cerca del Malecón']
];
const count = db.prepare('SELECT COUNT(*) AS total FROM parking_spaces').get().total;
if (!count) {
  const insert = db.prepare('INSERT INTO parking_spaces (id,name,area,address,price,unit,rating,reviews,capacity,features,tag) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const row of seedSpaces) insert.run(...row.slice(0,8), JSON.stringify(row[8]), JSON.stringify(row[9]), row[10]);
}
const getSpaces = db.prepare('SELECT * FROM parking_spaces ORDER BY id');
const getReservations = db.prepare(`SELECT r.id, r.space_id AS spaceId, p.name AS space, p.address, r.date, r.time, r.hours, r.vehicle, r.total, r.status,
  (SELECT n.status FROM notifications n WHERE n.reservation_id=r.id AND n.channel='Correo' ORDER BY n.id DESC LIMIT 1) AS emailStatus,
  (SELECT n.status FROM notifications n WHERE n.reservation_id=r.id AND n.channel='Correo de cancelación' ORDER BY n.id DESC LIMIT 1) AS cancellationEmailStatus
  FROM reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.user_id=? ORDER BY r.created_at DESC`);
const getAllReservations = db.prepare(`SELECT r.id, r.space_id AS spaceId, r.user_id AS userId, u.name AS customerName, u.email AS customerEmail,
  p.name AS space, p.address, r.date, r.time, r.hours, r.vehicle, r.total, r.status,
  (SELECT n.status FROM notifications n WHERE n.reservation_id=r.id AND n.channel='Correo' ORDER BY n.id DESC LIMIT 1) AS emailStatus,
  (SELECT n.status FROM notifications n WHERE n.reservation_id=r.id AND n.channel='Correo de cancelación' ORDER BY n.id DESC LIMIT 1) AS cancellationEmailStatus
  FROM reservations r JOIN parking_spaces p ON p.id=r.space_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`);
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
function currentUser(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  let token = bearer?.[1];
  if (!token) {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('parquea_session='));
    try { token = cookie ? decodeURIComponent(cookie.slice('parquea_session='.length)) : null; } catch { token = null; }
  }
  if (!token) return null;
  const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hashToken(token), Date.now());
  return session ? db.prepare('SELECT id,username,name,email,phone,role,whatsapp_opt_in AS whatsappOptIn FROM users WHERE id=?').get(session.user_id) : null;
}
function readBody(req, res, callback) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
  req.on('end', () => { try { Promise.resolve(callback(JSON.parse(body))).catch(() => { if (!res.headersSent) sendJson(res,500,{error:'Ocurrió un error interno.'}); }); } catch { callback(null); } });
}
function sendJson(res, status, value) { res.writeHead(status); res.end(JSON.stringify(value)); }
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token), userId, expiresAt);
  return token;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character])); }
async function sendRegistrationEmail(user) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'Pendiente de configurar';
  const safeName = escapeHtml(user.name);
  const html = `<div style="font-family:Arial,sans-serif;color:#20352a;max-width:560px;margin:24px auto;border:1px solid #e4ebe3;border-radius:18px;overflow:hidden"><div style="background:#f4f7f2;padding:21px 25px"><span style="display:inline-grid;vertical-align:middle;place-items:center;width:36px;height:36px;border-radius:12px 12px 12px 4px;background:#1d654b;color:#fff;font-size:19px;font-weight:800;margin-right:10px">P</span><span style="vertical-align:middle;font-size:20px;font-weight:800;letter-spacing:-.6px;color:#17211d">parquea<span style="color:#1d654b;font-weight:500">gye</span></span><span style="float:right;margin-top:10px;color:#718078;font-size:11px">GUAYAQUIL · ECUADOR</span></div><div style="padding:30px 26px 26px"><div style="width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#e3f0e5;color:#1d654b;font-size:27px;font-weight:bold">✓</div><p style="font-size:11px;letter-spacing:1.4px;color:#1d654b;font-weight:700;margin:23px 0 8px">BIENVENIDO A PARQUEA-GYE</p><h1 style="color:#20352a;font-size:27px;line-height:1.2;margin:0 0 12px">¡Registro exitoso, ${safeName}!</h1><p style="color:#657168;font-size:15px;line-height:1.7;margin:0">Tu cuenta ya está lista. Ahora puedes encontrar parqueos en Guayaquil y gestionar tus reservas desde un mismo lugar.</p><div style="background:#f1f5ef;padding:16px 18px;border-radius:12px;margin-top:23px"><b style="font-size:13px;color:#20352a">Tu ciudad, un parqueo más cerca.</b><p style="font-size:12px;line-height:1.6;color:#718078;margin:6px 0 0">Explora espacios, revisa sus detalles y recibe por correo la información de tus reservas.</p></div><p style="color:#879189;font-size:11px;line-height:1.6;margin:23px 0 0">Si no creaste esta cuenta, puedes ignorar este mensaje. Este correo fue enviado por Parquea-GYE para confirmar tu registro.</p></div><div style="background:#f8faf7;padding:14px 25px;color:#879189;font-size:10px">Moviéndonos mejor por Guayaquil · Parquea-GYE</div></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM,to:[user.email],subject:'¡Registro exitoso en Parquea-GYE! Tu ciudad, un parqueo más cerca',html})});
    return response.ok ? 'Enviado' : 'Error al enviar';
  } catch { return 'Error al conectar'; }
}
async function sendReservationEmail(user, booking) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'Pendiente de configurar';
  const safe = {name:escapeHtml(user.name),space:escapeHtml(booking.space),address:escapeHtml(booking.address),date:escapeHtml(booking.date),time:escapeHtml(booking.time),vehicle:escapeHtml(booking.vehicle),id:escapeHtml(booking.id)};
  const html = `<div style="font-family:Arial,sans-serif;color:#20352a;max-width:560px;margin:auto;border:1px solid #e4ebe3;border-radius:14px;overflow:hidden"><div style="background:#f4f7f2;padding:20px 24px"><span style="display:inline-grid;vertical-align:middle;place-items:center;width:34px;height:34px;border-radius:11px 11px 11px 3px;background:#1d654b;color:#fff;font-size:18px;font-weight:800;margin-right:9px">P</span><span style="vertical-align:middle;font-size:19px;font-weight:800;letter-spacing:-.6px;color:#17211d">parquea<span style="color:#1d654b;font-weight:500">gye</span></span></div><div style="padding:24px"><p style="font-size:11px;letter-spacing:1px;color:#1d654b;font-weight:700">RESERVA REGISTRADA</p><h1 style="color:#20352a;font-size:24px;margin:8px 0">Hola ${safe.name}</h1><p>Recibimos tu solicitud de parqueo. Aquí tienes los detalles:</p><div style="background:#f1f5ef;padding:18px;border-radius:10px"><b>${safe.space}</b><p>${safe.address}, Guayaquil</p><p>${safe.date} · ${safe.time} · ${booking.hours} hora(s)</p><p>Vehículo: ${safe.vehicle}</p><p style="font-size:20px"><b>Total estimado: $${Number(booking.total).toFixed(2)}</b></p><p>Código de reserva: ${safe.id}</p></div><p style="color:#738078;font-size:12px;margin-top:22px">Este correo fue generado por Parquea GYE debido a tu reserva.</p></div></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM,to:[user.email],subject:`Tu reserva ${booking.id} en Parquea GYE`,html})});
    if (response.ok) return 'Enviado';
    const detail = await response.text();
    console.warn(`Resend rechazó el correo de reserva (${response.status}): ${detail.slice(0,500)}`);
    return response.status === 403 ? 'Remitente no verificado' : 'Error al enviar';
  } catch (error) { console.warn('No se pudo conectar con Resend para enviar la reserva:', error.message); return 'Error al conectar'; }
}
async function sendCancellationEmail(user, booking) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'Pendiente de configurar';
  const safe = {name:escapeHtml(user.name),space:escapeHtml(booking.space),address:escapeHtml(booking.address),date:escapeHtml(booking.date),time:escapeHtml(booking.time),id:escapeHtml(booking.id)};
  const html = `<div style="font-family:Arial,sans-serif;color:#20352a;max-width:560px;margin:auto;border:1px solid #e4ebe3;border-radius:14px;overflow:hidden"><div style="background:#f4f7f2;padding:20px 24px"><span style="display:inline-grid;vertical-align:middle;place-items:center;width:34px;height:34px;border-radius:11px 11px 11px 3px;background:#1d654b;color:#fff;font-size:18px;font-weight:800;margin-right:9px">P</span><span style="vertical-align:middle;font-size:19px;font-weight:800;letter-spacing:-.6px;color:#17211d">parquea<span style="color:#1d654b;font-weight:500">gye</span></span></div><div style="padding:24px"><p style="font-size:11px;letter-spacing:1px;color:#8d5949;font-weight:700">CANCELACIÓN DE RESERVA</p><h1 style="color:#20352a;font-size:24px;margin:8px 0">Reserva cancelada</h1><p>Hola ${safe.name}, confirmamos que cancelaste esta reserva:</p><div style="background:#f1f5ef;padding:18px;border-radius:10px"><b>${safe.space}</b><p>${safe.address}, Guayaquil</p><p>${safe.date} · ${safe.time} · ${booking.hours} hora(s)</p><p>Código de reserva: ${safe.id}</p></div><p style="color:#738078;font-size:12px;margin-top:22px">Este correo fue generado por Parquea GYE debido a la cancelación de tu reserva.</p></div></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM,to:[user.email],subject:`Cancelación de reserva ${booking.id} - Parquea GYE`,html})});
    return response.ok ? 'Enviado' : 'Error al enviar';
  } catch { return 'Error al conectar'; }
}
async function sendPasswordResetEmail(user, resetToken) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'Pendiente de configurar';
  const safeName = escapeHtml(user.name);
  const resetLink = `http://localhost:3000/restablecer.html?token=${encodeURIComponent(resetToken)}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#20352a;max-width:560px;margin:24px auto;border:1px solid #e4ebe3;border-radius:18px;overflow:hidden"><div style="background:#f4f7f2;padding:21px 25px"><span style="display:inline-grid;vertical-align:middle;place-items:center;width:36px;height:36px;border-radius:12px 12px 12px 4px;background:#1d654b;color:#fff;font-size:19px;font-weight:800;margin-right:10px">P</span><span style="vertical-align:middle;font-size:20px;font-weight:800;color:#17211d">parquea<span style="color:#1d654b;font-weight:500">gye</span></span></div><div style="padding:30px 26px"><p style="font-size:11px;letter-spacing:1.4px;color:#1d654b;font-weight:700">RECUPERACIÓN DE CUENTA</p><h1 style="color:#20352a;font-size:25px;margin:8px 0 12px">Hola ${safeName}, creemos una nueva clave.</h1><p style="color:#657168;font-size:14px;line-height:1.7">Recibimos una solicitud para cambiar la contraseña de tu cuenta de Parquea-GYE. Usa este botón para elegir una nueva:</p><p style="margin:25px 0"><a href="${resetLink}" style="display:inline-block;padding:14px 22px;border-radius:9px;background:#1d654b;color:#fff;text-decoration:none;font-size:13px;font-weight:700">Restablecer contraseña</a></p><p style="color:#718078;font-size:12px;line-height:1.7">Este enlace funciona una sola vez y vence en 30 minutos. Si no solicitaste el cambio, ignora este mensaje; tu contraseña seguirá igual.</p><p style="color:#879189;font-size:11px;margin-top:24px">Por seguridad, nunca compartas este enlace.</p></div><div style="background:#f8faf7;padding:14px 25px;color:#879189;font-size:10px">Parquea-GYE · Moviéndonos mejor por Guayaquil</div></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM,to:[user.email],subject:'Restablece tu contraseña de Parquea-GYE',html})});
    return response.ok ? 'Enviado' : 'Error al enviar';
  } catch { return 'Error al conectar'; }
}
function recordNotification(reservationId, channel, destination, status) {
  if (status) db.prepare('INSERT INTO notifications (reservation_id,channel,destination,status) VALUES (?,?,?,?)').run(reservationId,channel,destination,status);
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && pathname === '/api/me') {
      sendJson(res, 200, currentUser(req)); return;
    }
    if (req.method === 'POST' && pathname === '/api/password-reset/request') {
      readBody(req, res, async input => {
        const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sendJson(res,400,{error:'Escribe un correo electrónico válido.'}); return; }
        const configured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
        const user = db.prepare('SELECT id,name,email FROM users WHERE email=? COLLATE NOCASE').get(email);
        if (user && configured) {
          db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
          const resetToken = crypto.randomBytes(32).toString('base64url');
          db.prepare('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(resetToken),user.id,Date.now()+30*60*1000);
          const status = await sendPasswordResetEmail(user,resetToken);
          if (status !== 'Enviado') {
            db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
            console.warn('No se pudo enviar el correo de recuperación:',status);
          }
        }
        sendJson(res,200,{ok:true,configured});
      }); return;
    }
    if (req.method === 'GET' && pathname === '/api/password-reset/validate') {
      const token = new URL(req.url,'http://localhost').searchParams.get('token') || '';
      const reset = token ? db.prepare('SELECT token_hash FROM password_resets WHERE token_hash=? AND expires_at>?').get(hashToken(token),Date.now()) : null;
      sendJson(res,200,{valid:Boolean(reset)}); return;
    }
    if (req.method === 'POST' && pathname === '/api/password-reset/complete') {
      readBody(req, res, input => {
        const token = typeof input?.token === 'string' ? input.token : '';
        const password = typeof input?.password === 'string' ? input.password : '';
        if (password.length < 8) { sendJson(res,400,{error:'La contraseña debe tener al menos 8 caracteres.'}); return; }
        db.exec('BEGIN IMMEDIATE;');
        try {
          const reset = token ? db.prepare('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?').get(hashToken(token),Date.now()) : null;
          if (!reset) { db.exec('ROLLBACK;'); sendJson(res,400,{error:'El enlace venció o ya fue utilizado. Solicita uno nuevo.'}); return; }
          const salt = crypto.randomBytes(16).toString('hex');
          db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt,scrypt(password,salt),reset.user_id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(reset.user_id);
          db.prepare('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id);
          db.exec('COMMIT;');
          sendJson(res,200,{ok:true});
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      }); return;
    }
    if (req.method === 'POST' && pathname === '/api/register') {
      readBody(req, res, async input => {
        if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.username !== 'string' || !/^[A-Za-z0-9]{3,20}$/.test(input.username) || typeof input.password !== 'string' || input.password.length < 8) {
          sendJson(res, 400, {error:'Usa un usuario de 3 a 20 letras o números y una contraseña de al menos 8 caracteres.'}); return;
        }
        if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(input.name.trim())) { sendJson(res,400,{error:'Escribe tu nombre usando letras, espacios o guiones.'}); return; }
        const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim().toLowerCase() : null;
        const phone = null;
        if (!email) { sendJson(res, 400, {error:'El correo electrónico es obligatorio.'}); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sendJson(res, 400, {error:'Revisa el formato de tu correo.'}); return; }
        const salt = crypto.randomBytes(16).toString('hex');
        try {
          const role = email === PRIMARY_ADMIN_EMAIL ? 'admin' : 'cliente';
          const result = db.prepare('INSERT INTO users (username,name,email,phone,whatsapp_opt_in,password_salt,password_hash,role) VALUES (?,?,?,?,?,?,?,?)').run(input.username,input.name.trim(),email,null,0,salt,scrypt(input.password,salt),role);
          if (role === 'admin') db.prepare("UPDATE users SET role='cliente' WHERE id<>? AND role='admin'").run(Number(result.lastInsertRowid));
          const user = {id:Number(result.lastInsertRowid),username:input.username,name:input.name.trim(),email,phone:null,role,whatsappOptIn:false};
          const sessionToken = createSession(user.id);
          const registrationEmailStatus = await sendRegistrationEmail(user);
          sendJson(res,201,{...user,sessionToken,registrationEmailStatus});
        } catch { sendJson(res,409,{error:'Ya existe una cuenta con ese correo.'}); }
      }); return;
    }
    if (req.method === 'POST' && pathname === '/api/login') {
      readBody(req, res, input => {
        if (!input || typeof input.contact !== 'string' || typeof input.password !== 'string') { sendJson(res,400,{error:'Escribe tu correo o teléfono y contraseña.'}); return; }
        const contact = input.contact.includes('@') ? input.contact.trim().toLowerCase() : input.contact.trim().replace(/[\s()-]/g,'');
        const candidates = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE OR phone=?').all(contact,contact,contact);
        const matches = candidates.filter(candidate => scrypt(input.password,candidate.password_salt) === candidate.password_hash);
        if (!matches.length) { sendJson(res,401,{error:'El correo/teléfono o la contraseña no coinciden.'}); return; }
        if (matches.length > 1) { sendJson(res,409,{error:'Hay varias cuentas con ese usuario. Inicia sesión con tu correo electrónico.'}); return; }
        const user = matches[0];
        const safeUser = {id:user.id,username:user.username,name:user.name,email:user.email,phone:user.phone,role:user.role,whatsappOptIn:Boolean(user.whatsapp_opt_in)}; const sessionToken=createSession(user.id); sendJson(res,200,{...safeUser,sessionToken});
      }); return;
    }
    if (req.method === 'POST' && pathname === '/api/logout') {
      const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      if (bearer) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(bearer[1]));
      sendJson(res,200,{ok:true}); return;
    }
    const user = currentUser(req);
    if ((pathname.startsWith('/api/staff/') || pathname.startsWith('/api/admin/')) && !user) { sendJson(res,401,{error:'Inicia sesión para continuar.'}); return; }
    if (pathname.startsWith('/api/reservations') && user?.role === 'moderador') { sendJson(res,403,{error:'La cuenta moderadora solo puede revisar el panel de reservas.'}); return; }
    if (req.method === 'GET' && pathname === '/api/staff/dashboard') {
      if (!['admin','moderador'].includes(user?.role)) { sendJson(res,403,{error:'Este panel es solo para el equipo de Parquea-GYE.'}); return; }
      const allReservations = getAllReservations.all();
      const reservations = user.role === 'admin' ? allReservations : allReservations.map(({customerEmail,...booking})=>booking);
      const summary = {
        reservations: allReservations.length,
        active: allReservations.filter(booking=>booking.status!=='Cancelada').length,
        cancelled: allReservations.filter(booking=>booking.status==='Cancelada').length,
        users: user.role === 'admin' ? db.prepare('SELECT COUNT(*) AS total FROM users').get().total : null,
        spaces: user.role === 'admin' ? db.prepare('SELECT COUNT(*) AS total FROM parking_spaces').get().total : null
      };
      const spaces = user.role === 'admin' ? getSpaces.all().map(row=>({...row,capacity:JSON.parse(row.capacity),features:JSON.parse(row.features)})) : [];
      const users = user.role === 'admin' ? db.prepare('SELECT id,name,email,username,role FROM users ORDER BY id').all().map(person=>({...person,primaryAdmin:String(person.email||'').toLowerCase()===PRIMARY_ADMIN_EMAIL})) : [];
      sendJson(res,200,{summary,reservations,spaces,users}); return;
    }
    const editSpaceMatch = pathname.match(/^\/api\/admin\/spaces\/(\d+)$/);
    if (editSpaceMatch && req.method === 'PUT') {
      if (user?.role !== 'admin') { sendJson(res,403,{error:'Solo administración puede editar parqueos.'}); return; }
      readBody(req,res,input=>{
        const name = typeof input?.name==='string' ? input.name.trim() : '';
        const area = typeof input?.area==='string' ? input.area.trim() : '';
        const address = typeof input?.address==='string' ? input.address.trim() : '';
        const price = Number(input?.price);
        if (name.length<3 || name.length>80 || /[<>]/.test(name) || area.length<2 || area.length>40 || /[<>]/.test(area) || address.length<5 || address.length>160 || /[<>]/.test(address) || !Number.isFinite(price) || price<=0 || price>1000) {
          sendJson(res,400,{error:'Revisa el nombre, zona, dirección y precio del parqueo.'}); return;
        }
        const result = db.prepare('UPDATE parking_spaces SET name=?,area=?,address=?,price=? WHERE id=?').run(name,area,address,price,Number(editSpaceMatch[1]));
        if (!result.changes) { sendJson(res,404,{error:'No encontramos ese parqueo.'}); return; }
        const row=db.prepare('SELECT * FROM parking_spaces WHERE id=?').get(Number(editSpaceMatch[1]));
        sendJson(res,200,{...row,capacity:JSON.parse(row.capacity),features:JSON.parse(row.features)});
      }); return;
    }
    const userRoleMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/role$/);
    if (userRoleMatch && req.method === 'PUT') {
      if (user?.role !== 'admin') { sendJson(res,403,{error:'Solo administración puede gestionar los roles.'}); return; }
      readBody(req,res,input=>{
        const id=Number(userRoleMatch[1]),role=input?.role;
        if (!['moderador','cliente'].includes(role)) { sendJson(res,400,{error:'Elige Cliente o Moderador para esta cuenta.'}); return; }
        const target=db.prepare('SELECT id,email,role FROM users WHERE id=?').get(id);
        if (!target) { sendJson(res,404,{error:'No encontramos esa cuenta.'}); return; }
        if (String(target.email||'').toLowerCase() === PRIMARY_ADMIN_EMAIL) { sendJson(res,400,{error:'El rol Administrador está reservado para la cuenta principal de Parquea-GYE.'}); return; }
        if (id===user.id && role!=='admin') { sendJson(res,400,{error:'No puedes cambiar tu propio rol de administrador.'}); return; }
        db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id);
        sendJson(res,200,{ok:true});
      }); return;
    }
    if (pathname === '/api/spaces' && req.method === 'GET' && !user) { sendJson(res,401,{error:'Inicia sesión para continuar.'}); return; }
    if (pathname.startsWith('/api/reservations') && !user) { sendJson(res,401,{error:'Inicia sesión para continuar.'}); return; }
    if (req.method === 'GET' && pathname === '/api/spaces') {
      const rows = getSpaces.all().map(row => ({...row, capacity: JSON.parse(row.capacity), features: JSON.parse(row.features)}));
      res.writeHead(200); res.end(JSON.stringify(rows)); return;
    }
    if (req.method === 'GET' && pathname === '/api/reservations') {
      res.writeHead(200); res.end(JSON.stringify(getReservations.all(user.id))); return;
    }
    if (req.method === 'POST' && pathname === '/api/reservations') {
      if (user?.role === 'moderador') { sendJson(res,403,{error:'La cuenta moderadora solo puede revisar el panel de reservas.'}); return; }
      readBody(req, res, async input => {
        try {
          if (!input) throw new Error('invalid body');
          const space = db.prepare('SELECT id, price, capacity FROM parking_spaces WHERE id=?').get(Number(input.spaceId));
          if (!space || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time) || !Number.isInteger(input.hours) || input.hours < 1 || input.hours > 24 || !JSON.parse(space.capacity).includes(input.vehicle)) {
            res.writeHead(400); res.end(JSON.stringify({error:'Datos de reserva inválidos'})); return;
          }
          const id = `GYE-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*90+10)}`;
          const total = Number((space.price * input.hours).toFixed(2));
          db.prepare('INSERT INTO reservations (id,space_id,user_id,date,time,hours,vehicle,total) VALUES (?,?,?,?,?,?,?,?)').run(id,space.id,user.id,input.date,input.time,input.hours,input.vehicle,total);
          const emailStatus=await sendReservationEmail(user,{...input,id,space:db.prepare('SELECT name,address FROM parking_spaces WHERE id=?').get(space.id).name,address:db.prepare('SELECT address FROM parking_spaces WHERE id=?').get(space.id).address,total});
          recordNotification(id,'Correo',user.email,emailStatus);
          res.writeHead(201); res.end(JSON.stringify(getReservations.all(user.id).find(row => row.id === id)));
        } catch { res.writeHead(400); res.end(JSON.stringify({error:'No se pudo guardar la reserva'})); }
      });
      return;
    }
    const cancelMatch = pathname.match(/^\/api\/reservations\/([A-Za-z0-9-]+)$/);
    if (req.method === 'DELETE' && cancelMatch) {
      const booking=db.prepare("SELECT r.id,r.date,r.time,r.hours,r.total,r.vehicle,p.name AS space,p.address FROM reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.id=? AND r.user_id=? AND r.status<>'Cancelada'").get(cancelMatch[1],user.id);
      if(!booking){sendJson(res,404,{error:'No encontramos una reserva activa con ese código.'});return;}
      db.prepare('UPDATE reservations SET status=? WHERE id=? AND user_id=?').run('Cancelada',booking.id,user.id);
      const cancellationEmailStatus=await sendCancellationEmail(user,booking);
      recordNotification(booking.id,'Correo de cancelación',user.email,cancellationEmailStatus);
      sendJson(res,200,{...getReservations.all(user.id).find(row=>row.id===booking.id),cancellationEmailStatus}); return;
    }
    res.writeHead(404); res.end(JSON.stringify({error:'Ruta no encontrada'})); return;
  }
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(root, requested);
  if ((!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) || file.startsWith(dataDir + path.sep) || path.basename(file) === '.env') {
    res.writeHead(403); res.end('No permitido'); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(3000, '127.0.0.1', () => console.log('Parquea GYE disponible en http://localhost:3000'));
