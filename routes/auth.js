const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const Alimento = require('../models/Alimento');
const jwt = require('jsonwebtoken');
const { loginToMandao } = require('../services/mandaoIntegration');

// Generar JWT Token
const generarToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion',
    { expiresIn: '7d' }
  );
};

// --- FUNCIÓN DE SINCRONIZACIÓN AUTOMÁTICA ---
async function syncMandaoData(jcrtUserId, mandaoProducts, mandaoAlimentos) {
  try {
    console.log(`🔄 Iniciando sincronización de datos para usuario ${jcrtUserId}...`);

    // Validar que sean arrays
    mandaoProducts = Array.isArray(mandaoProducts) ? mandaoProducts : [];
    mandaoAlimentos = Array.isArray(mandaoAlimentos) ? mandaoAlimentos : [];

    console.log(`📦 Datos recibidos: ${mandaoProducts.length} productos, ${mandaoAlimentos.length} alimentos.`);

    // 2. Sincronizar Productos
    const productMap = new Map(); // Mapa para vincular ID Mandao -> ID JCRT (si fuera necesario, aquí usaremos nombre como clave simple)

    for (const mProduct of mandaoProducts) {
      // Buscar si el producto ya existe por nombre (para no duplicar)
      let product = await Product.findOne({
        userId: jcrtUserId,
        nombre: mProduct.nombre // Asumiendo que el nombre es único por usuario
      });

      if (!product) {
        // Crear nuevo producto
        product = await Product.create({
          userId: jcrtUserId,
          nombre: mProduct.nombre,
          precio: mProduct.precio,
          categoria: mProduct.categoria || 'General',
          descripcion: mProduct.descripcion || '',
          disponible: true
        });
        console.log(`   ✨ Producto creado: ${product.nombre}`);
      } else {
        // Actualizar precio si cambió (opcional, o dejarlo como está en JC-RT)
        // product.precio = mProduct.precio;
        // await product.save();
        console.log(`   ⏩ Producto existente: ${product.nombre}`);
      }

      // Guardar referencia para los alimentos
      productMap.set(mProduct._id, product._id);
      // NOTA: mProduct._id es el ID en Mandao. Si Mandao envía el ID en el objeto json, úsalo.
      // Si el endpoint de productos devuelve {_id, nombre...}, esto funciona.
    }

    // 3. Sincronizar Alimentos (Ingredientes)
    for (const mAlimento of mandaoAlimentos) {
      let alimento = await Alimento.findOne({
        userId: jcrtUserId,
        nombre: mAlimento.nombre
      });

      if (!alimento) {
        // Si el alimento tiene productos vinculados en Mandao, intentar vincularlos aquí
        // Esto es complejo si los IDs no coinciden. 
        // Estrategia simple: Importar el alimento como ingrediente base sin vinculos complejos por ahora, 
        // O intentar vincular por nombre de producto si Mandao envía nombres de productos en el array.

        // Supongamos que mAlimento.productos es un array de { productoId, cantidadRequerida }
        // Necesitamos mapear esos productoId de Mandao a los nuevos productoId de JC-RT que acabamos de crear/encontrar.

        const productosVinculados = [];
        if (mAlimento.productos && Array.isArray(mAlimento.productos)) {
          for (const pLink of mAlimento.productos) {
            const jcrtProdId = productMap.get(pLink.productoId);
            if (jcrtProdId) {
              productosVinculados.push({
                productoId: jcrtProdId,
                cantidadRequerida: pLink.cantidadRequerida
              });
            }
          }
        }

        alimento = await Alimento.create({
          userId: jcrtUserId,
          nombre: mAlimento.nombre,
          stock: mAlimento.stock || 0,
          valor: mAlimento.costo || mAlimento.valor || 0, // Mandao podría usar 'costo'
          productos: productosVinculados
        });
        console.log(`   🥕 Alimento creado: ${alimento.nombre} con ${productosVinculados.length} vinculos`);
      } else {
        console.log(`   ⏩ Alimento existente: ${alimento.nombre}`);
      }
    }

    console.log('✅ Sincronización completada con éxito.');

  } catch (error) {
    console.error('❌ Error en sincronización de datos:', error);
    // No lanzamos error para no interrumpir el login, solo logueamos
  }
}


// Login con Mandao
router.post('/login-mandao', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    // 1. Autenticar con Mandao
    const mandaoAuth = await loginToMandao(email, password);

    // Asumimos que mandaoAuth devuelve { success: true, token, usuario: { email, nombre, nombreRestaurante... } }
    // Si la estructura es diferente, ajustar aquí.

    if (!mandaoAuth.success || !mandaoAuth.token) {
      return res.status(401).json({ success: false, message: 'Credenciales de Mandao inválidas' });
    }

    const mandaoUser = mandaoAuth.usuario || mandaoAuth.user; // Ajustar según respuesta real
    if (!mandaoUser) {
      return res.status(500).json({ success: false, message: 'Error recuperando datos de usuario de Mandao' });
    }

    // 2. Buscar o Crear Usuario en JC-RT
    let user = await User.findOne({ email: email.toLowerCase() });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      // VALIDACIÓN DE NOMBRE: Asegurar mínimo 2 caracteres
      let nombreUsuario = mandaoUser.nombre || 'Usuario Mandao';
      if (nombreUsuario.length < 2) {
        // Si es muy corto, usar el nombre + apellido si existe, o el email
        if (mandaoUser.apellido) {
          nombreUsuario = `${nombreUsuario} ${mandaoUser.apellido}`;
        } else {
          // Si sigue siendo corto, usar parte del email o rellenar
          const emailName = email.split('@')[0];
          nombreUsuario = emailName.length >= 2 ? emailName : `${nombreUsuario} Mandao`;
        }
      }

      // Fecha de pago = Hoy + 30 días (Prueba Gratis)
      const fechaPago = new Date();
      fechaPago.setDate(fechaPago.getDate() + 30);

      user = await User.create({
        nombre: nombreUsuario,
        email: email.toLowerCase(),
        password: await require('bcryptjs').hash(password, 10), // Guardamos la misma pass (hash) para que funcione el login tradicional también
        nombreRestaurante: mandaoUser.nombre, // SE USA EL NOMBRE DEL USUARIO DE MANDAO
        sede: mandaoUser.sede || 'Principal',
        rol: 'admin', // Probablemente sea dueño si viene de Mandao
        activo: true,
        fechaPago: fechaPago,
        fechaUltimoPago: new Date()
      });

      console.log(`🎉 Nuevo usuario creado desde Mandao: ${user.email} (Nombre: ${user.nombre})`);
    }

    // Verificar bloqueos
    if (!user.activo) return res.status(401).json({ success: false, message: 'Usuario inactivo' });
    if (user.bloqueado) return res.status(403).json({ success: false, message: 'Cuenta suspendida', bloqueado: true, motivo: user.motivoBloqueo });

    // Actualizar último acceso
    user.ultimoAcceso = new Date();
    await user.save();

    // 3. Sincronizar datos (Extraemos del usuario Mandao)
    const mProducts = mandaoUser.menu || [];
    const mAlimentos = mandaoUser.alimentos || [];

    if (isNewUser) {
      await syncMandaoData(user._id, mProducts, mAlimentos);
    } else {
      // Si ya existe, sincronizamos en segundo plano para actualizar
      syncMandaoData(user._id, mProducts, mAlimentos).catch(err => console.error(err));
    }

    // 4. Generar Token JC-RT
    const token = generarToken(user._id);

    res.json({
      success: true,
      message: 'Login con Mandao exitoso',
      token,
      usuario: user.obtenerDatosPublicos(),
      welcomeMessage: isNewUser // Flag para mostrar el mensaje de bienvenida en el frontend
    });

  } catch (error) {
    console.error('Error en /login-mandao:', error);
    const errorMessage = error.message || 'Error interno';
    const statusCode = errorMessage.includes('Mandao') ? 503 : 500;
    res.status(statusCode).json({ success: false, message: errorMessage, detail: error.stack });
  }
});


// Registro de usuario
router.post('/register', async (req, res) => {
  try {
    console.log('Solicitud de registro recibida:', req.body);

    const { nombre, email, password, rol, nombreRestaurante, sede } = req.body;

    // Validar que todos los campos obligatorios estén presentes
    if (!nombre || !email || !password || !nombreRestaurante) {
      return res.status(400).json({
        success: false,
        message: 'Por favor complete todos los campos obligatorios'
      });
    }

    // Validar longitud del nombre
    if (nombre.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El nombre debe tener al menos 2 caracteres'
      });
    }

    // Validar longitud del usuario
    if (email.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'El usuario debe tener al menos 3 caracteres'
      });
    }

    // Validar longitud de la contraseña
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Validar longitud del nombre del restaurante
    if (nombreRestaurante.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del restaurante debe tener al menos 3 caracteres'
      });
    }

    // Verificar si ya existe un ADMINISTRADOR para este restaurante
    // Esto determina si el restaurante ya "existe" y tiene dueño
    const adminExistente = await User.findOne({
      nombreRestaurante: nombreRestaurante.trim(),
      rol: 'admin'
    });

    let usuarioNuevo;
    let mensajeRespuesta = 'Usuario registrado exitosamente';
    let token = null;

    if (adminExistente) {
      // El restaurante YA existe
      // Cualquier rol (incluso otro admin) entra como PENDIENTE de aprobación, esperando visto bueno de un admin existente.

      usuarioNuevo = await User.create({
        nombre,
        email: email.toLowerCase(),
        password,
        nombreRestaurante: nombreRestaurante.trim(),
        sede: sede ? sede.trim() : '',
        rol: rol, // Puede ser admin, mesero, cajero
        activo: false, // Inactivo hasta aprobación
        solicitudPendiente: true, // Marcar como solicitud
        fechaPago: adminExistente.fechaPago, // Heredar fecha de pago del restaurante
        fechaUltimoPago: adminExistente.fechaUltimoPago
      });

      mensajeRespuesta = 'Solicitud enviada a los administradores del restaurante. Espera su aprobación para ingresar.';
      console.log(`Solicitud de ingreso creada (${rol}): ${email} para ${nombreRestaurante}`);

      // No generamos token porque no puede entrar aún
      return res.status(201).json({
        success: true,
        message: mensajeRespuesta,
        requiereAprobacion: true
      });

    } else {
      // El restaurante NO existe (o al menos no tiene admin) -> Crear Nuevo Restaurante (Admin)
      if (rol !== 'admin') {
        // Si intenta ser mesero de un restaurante que no existe... 
        // Opción A: Error. Opción B: Permitir pero advertir.
        // Vamos a asumir que si se registra primero, es el admin. O forzamos a que el primero sea admin.
        // Por ahora, permitimos crear, pero el "dueño" real debería ser admin.
      }

      // Calcular fecha de pago (30 días de prueba gratis)
      const fechaPago = new Date();
      fechaPago.setDate(fechaPago.getDate() + 30);

      usuarioNuevo = await User.create({
        nombre,
        email: email.toLowerCase(),
        password,
        nombreRestaurante: nombreRestaurante.trim(),
        sede: sede ? sede.trim() : '',
        rol: rol || 'admin', // Si no existe, el primero debería ser admin idealmente
        activo: true,
        solicitudPendiente: false,
        fechaPago: fechaPago,
        fechaUltimoPago: new Date()
      });

      token = generarToken(usuarioNuevo._id);
    }

    console.log('Usuario registrado:', usuarioNuevo.email);

    res.status(201).json({
      success: true,
      message: mensajeRespuesta,
      token,
      usuario: usuarioNuevo.obtenerDatosPublicos()
    });

  } catch (error) {
    console.error('Error en registro:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'El usuario ya está registrado'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al registrar usuario',
      error: error.message
    });
  }
});

// Login de usuario
router.post('/login', async (req, res) => {
  try {
    console.log('Solicitud de login recibida:', req.body.email);

    const { email, password } = req.body;

    // Validar campos
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingrese usuario y contraseña'
      });
    }

    // Buscar usuario e incluir password
    const usuario = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Verificar si el usuario está activo
    // Verificar si el usuario está activo
    if (!usuario.activo) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inactivo. Contacte al administrador'
      });
    }

    // Verificación de Vencimiento de Suscripción (Solo para admins o dueños)
    // Si el usuario es admin y su fecha ha vencido, bloqueamos TODO el restaurante
    if (usuario.rol === 'admin' && usuario.fechaPago && new Date(usuario.fechaPago) < new Date() && !usuario.bloqueado) {
      console.log(`⚠️ Suscripción vencida para ${usuario.nombreRestaurante}. Bloqueando...`);

      const motivo = 'Su plan ha vencido. Por favor realice el pago para continuar disfrutando del servicio.';

      // Bloquear al admin y a todos los empleados de este restaurante
      await User.updateMany(
        { nombreRestaurante: usuario.nombreRestaurante },
        {
          bloqueado: true,
          motivoBloqueo: motivo,
          fechaBloqueo: new Date()
        }
      );

      // Actualizar el objeto usuario actual para reflejar el bloqueo inmediato
      usuario.bloqueado = true;
      usuario.motivoBloqueo = motivo;
    }

    // Verificar si el usuario está bloqueado (Checkeo posterior a la validación de fecha)
    if (usuario.bloqueado) {
      return res.status(403).json({
        success: false,
        message: 'Cuenta suspendida',
        bloqueado: true,
        motivoBloqueo: usuario.motivoBloqueo || 'Su cuenta ha sido suspendida. Para más información contacte al equipo de soporte al número 3128540908'
      });
    }

    // Verificar password
    const passwordCorrecto = await usuario.compararPassword(password);

    if (!passwordCorrecto) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Actualizar último acceso
    usuario.ultimoAcceso = new Date();
    await usuario.save();

    // Generar token
    const token = generarToken(usuario._id);

    console.log('Login exitoso:', usuario.email);

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      usuario: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión',
      error: error.message
    });
  }
});

// Verificar token
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuario = await User.findById(decoded.id);

    if (!usuario || !usuario.activo) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido o usuario inactivo'
      });
    }

    res.json({
      success: true,
      usuario: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
});

// Obtener perfil del usuario actual
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuario = await User.findById(decoded.userId || decoded.id);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: {
        _id: usuario._id,
        id: usuario._id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        nombreRestaurante: usuario.nombreRestaurante,
        sede: usuario.sede
      }
    });

  } catch (error) {
    console.error('Error en /me:', error);
    res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
});


// RUTAS DE SUPERADMIN

// Obtener todos los usuarios (solo superadmin)
router.get('/superadmin/usuarios', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuarioActual = await User.findById(decoded.id);

    if (!usuarioActual || usuarioActual.rol !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos de superadmin'
      });
    }

    // Obtener todos los usuarios ordenados por fecha de creación
    const usuarios = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: usuarios
    });

  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener usuarios'
    });
  }
});

// Bloquear/Desbloquear usuario y su restaurante
router.patch('/superadmin/toggle-bloqueo/:userId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuarioActual = await User.findById(decoded.id);

    if (!usuarioActual || usuarioActual.rol !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos de superadmin'
      });
    }

    const usuario = await User.findById(req.params.userId);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Cambiar estado de bloqueo
    const nuevoEstado = !usuario.bloqueado;

    // Actualizar todos los usuarios del mismo restaurante
    await User.updateMany(
      { nombreRestaurante: usuario.nombreRestaurante },
      {
        bloqueado: nuevoEstado,
        motivoBloqueo: nuevoEstado ? 'Su cuenta ha sido suspendida. Para más información contacte al equipo de soporte al número 3128540908' : '',
        fechaBloqueo: nuevoEstado ? new Date() : null
      }
    );

    res.json({
      success: true,
      message: `Restaurante "${usuario.nombreRestaurante}" ${nuevoEstado ? 'bloqueado' : 'desbloqueado'} exitosamente`,
      bloqueado: nuevoEstado
    });

  } catch (error) {
    console.error('Error al cambiar estado de bloqueo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cambiar estado de bloqueo'
    });
  }
});

// Actualizar fecha de pago para un restaurante (solo superadmin)
router.patch('/superadmin/fecha-pago/:userId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuarioActual = await User.findById(decoded.id);

    if (!usuarioActual || usuarioActual.rol !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos de superadmin'
      });
    }

    const usuario = await User.findById(req.params.userId);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const { fechaPago } = req.body;

    if (!fechaPago) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar una fecha de pago'
      });
    }

    // Actualizar todos los usuarios del mismo restaurante
    await User.updateMany(
      { nombreRestaurante: usuario.nombreRestaurante },
      {
        fechaPago: new Date(fechaPago),
        fechaUltimoPago: new Date()
      }
    );

    res.json({
      success: true,
      message: `Fecha de pago actualizada para el restaurante "${usuario.nombreRestaurante}"`,
      fechaPago: fechaPago
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al actualizar fecha de pago'
    });
  }
});

// Confirmar pago (extender fecha 1 mes) - solo superadmin
router.patch('/superadmin/confirmar-pago/:userId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuarioActual = await User.findById(decoded.id);

    if (!usuarioActual || usuarioActual.rol !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos de superadmin'
      });
    }

    const usuario = await User.findById(req.params.userId);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Calcular nueva fecha
    let nuevaFecha;
    const fechaActual = usuario.fechaPago ? new Date(usuario.fechaPago) : new Date();

    // Si la fecha actual es anterior a hoy, usar hoy como base, si no, usar la fecha actual (para extender desde la fecha de vencimiento)
    // El usuario pidió: "que no le aparezca ese mensaje hasta la proxima fecha de pago"
    // Lo lógico es sumar 1 mes a la fecha existente si es futura, o 1 mes a hoy si ya pasó.
    // PERO la lógica más robusta para suscripciones es: si no está vencido, sumar al vencimiento. Si está vencido, sumar a hoy.

    const hoy = new Date();
    // Resetear horas para comparar solo fechas
    hoy.setHours(0, 0, 0, 0);

    if (fechaActual < hoy) {
      // Si ya venció, la nueva fecha es 1 mes desde hoy
      nuevaFecha = new Date();
    } else {
      // Si no ha vencido, extender 1 mes desde la fecha actual
      nuevaFecha = new Date(fechaActual);
    }

    nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);

    // Actualizar todos los usuarios del mismo restaurante
    await User.updateMany(
      { nombreRestaurante: usuario.nombreRestaurante },
      {
        fechaPago: nuevaFecha,
        fechaUltimoPago: new Date()
      }
    );

    res.json({
      success: true,
      message: `Pago confirmado para "${usuario.nombreRestaurante}". Nueva fecha: ${nuevaFecha.toLocaleDateString('es-ES')}`
    });

  } catch (error) {
    console.error('Error al confirmar pago:', error);
    res.status(500).json({
      success: false,
      message: 'Error al confirmar pago'
    });
  }
});


// --- GESTIÓN DE SOLICITUDES DE INGRESO (Para Admins) ---

// Obtener solicitudes pendientes
router.get('/solicitudes', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No autorizado' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion');
    const admin = await User.findById(decoded.id);

    if (!admin || admin.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'Requiere rol de administrador' });
    }

    const solicitudes = await User.find({
      nombreRestaurante: admin.nombreRestaurante,
      solicitudPendiente: true,
      activo: false
    }).select('nombre email rol fechaBloqueo createdAt');

    res.json({ success: true, solicitudes });

  } catch (error) {
    console.error('Error al obtener solicitudes:', error);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

// Aprobar o Rechazar solicitud
router.post('/gestionar-solicitud', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const { userId, accion } = req.body; // accion: 'aprobar' | 'rechazar'

    if (!token) return res.status(401).json({ success: false, message: 'No autorizado' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion');
    const admin = await User.findById(decoded.id);

    if (!admin || admin.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'Requiere rol de administrador' });
    }

    const solicitante = await User.findById(userId);
    if (!solicitante) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // Seguridad: Verificar que sea del mismo restaurante
    if (solicitante.nombreRestaurante !== admin.nombreRestaurante) {
      return res.status(403).json({ success: false, message: 'No puedes gestionar usuarios ajenos' });
    }

    if (accion === 'aprobar') {
      solicitante.activo = true;
      solicitante.solicitudPendiente = false;
      await solicitante.save();
      res.json({ success: true, message: 'Usuario aprobado exitosamente' });
    } else if (accion === 'rechazar') {
      await User.findByIdAndDelete(userId); // O marcar como bloqueado permanentemente
      res.json({ success: true, message: 'Solicitud rechazada y usuario eliminado' });
    } else {
      res.status(400).json({ success: false, message: 'Acción no válida' });
    }

  } catch (error) {
    console.error('Error gestionando solicitud:', error);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

module.exports = router;