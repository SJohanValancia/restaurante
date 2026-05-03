const express = require('express');
const router = express.Router();
const Alimento = require('../models/Alimento');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');


router.get('/public/restaurante', async (req, res) => {
  try {
    const { restaurante, sede } = req.query;
    
    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'Nombre del restaurante es requerido'
      });
    }

    const User = require('../models/User');
    const query = { nombreRestaurante: restaurante };
    if (sede) query.sede = sede;

    const usuarios = await User.find(query);

    if (!usuarios || usuarios.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Restaurante no encontrado'
      });
    }

    const userIds = usuarios.map(u => u._id);

    const alimentos = await Alimento.find({ 
      userId: { $in: userIds }
    })
    .populate('productos.productoId', 'nombre precio categoria')
    .sort({ nombre: 1 });
    
    res.json({
      success: true,
      count: alimentos.length,
      data: alimentos
    });
  } catch (error) {
    console.error('❌ Error al obtener alimentos públicos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener alimentos',
      error: error.message
    });
  }
});

// Obtener todos los alimentos del restaurante
router.get('/', protect, async (req, res) => {
  try {
    // ✅ FIX MULTI-TENANT: Filtrar SOLO por el admin principal del restaurante actual
    // NO usar req.userIdsRestaurante porque para Hub Meseros incluye admins de OTROS restaurantes
    const ownerId = req.mainAdminId || req.user._id;
    const alimentos = await Alimento.find({ 
      userId: ownerId 
    })
    .populate('productos.productoId', 'nombre categoria precio')
    .sort({ nombre: 1 });

    const alimentosLimpios = alimentos.map(alimento => {
      const obj = alimento.toObject();
      // ✅ ASEGURAR que stock y valor siempre existan
      obj.stock = typeof obj.stock === 'number' ? obj.stock : 0;
      obj.valor = typeof obj.valor === 'number' ? obj.valor : 0;
      return obj;
    });

    res.json({
      success: true,
      count: alimentosLimpios.length,
      data: alimentosLimpios
    });
  } catch (error) {
    console.error('❌ Error al obtener alimentos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los alimentos',
      error: error.message
    });
  }
});

// Obtener un alimento por ID
router.get('/:id', protect, async (req, res) => {
  try {
    const alimento = await Alimento.findById(req.params.id)
      .populate('productos.productoId', 'nombre categoria');
    
    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    // ✅ ASEGURAR que stock y valor existan
    const alimentoObj = alimento.toObject();
    alimentoObj.stock = typeof alimentoObj.stock === 'number' ? alimentoObj.stock : 0;
    alimentoObj.valor = typeof alimentoObj.valor === 'number' ? alimentoObj.valor : 0;

    res.json({
      success: true,
      data: alimentoObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el alimento',
      error: error.message
    });
  }
});

// Crear un nuevo alimento (o vincular a uno existente si el nombre coincide)
router.post('/', protect, async (req, res) => {
  try {
    const { nombre, stock, valor, productos, medida } = req.body;

    // ✅ VALIDAR que stock y valor sean números válidos
    const stockNumero = Number(stock);
    const valorNumero = Number(valor);

    if (isNaN(stockNumero) || isNaN(valorNumero)) {
      return res.status(400).json({
        success: false,
        message: 'Stock y valor deben ser números válidos'
      });
    }

    // Validar campos obligatorios
    if (!nombre || !productos || productos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios. Debe incluir al menos un producto.'
      });
    }

    const nombreNorm = nombre.trim();
    // ✅ USAR req.mainAdminId para centralizar propiedad del restaurante
    const ownerId = req.mainAdminId || req.user._id;

    // --- LÓGICA DE COMPARTIR INGREDIENTE ---
    // Buscar si ya existe un alimento con el mismo nombre para este restaurante
    let alimento = await Alimento.findOne({
      userId: ownerId,
      nombre: { $regex: new RegExp(`^${nombreNorm}$`, 'i') }
    });

    if (alimento) {
      // SI YA EXISTE: Vincular los nuevos productos al ingrediente existente
      for (const prod of productos) {
        // Verificar si el producto ya está vinculado
        const prodExistente = alimento.productos.find(p => p.productoId.toString() === prod.productoId.toString());
        
        if (prodExistente) {
          // Si ya existe, actualizamos la cantidad requerida
          prodExistente.cantidadRequerida = Number(prod.cantidadRequerida);
        } else {
          // Si no existe, lo añadimos
          alimento.productos.push({
            productoId: prod.productoId,
            cantidadRequerida: Number(prod.cantidadRequerida)
          });
        }
      }
      
      // Opcionalmente actualizar stock y medida si se proporcionaron (prevalece lo último enviado)
      if (stock !== undefined) alimento.stock = stockNumero;
      if (medida) alimento.medida = medida;
      if (valor !== undefined) alimento.valor = valorNumero;

      await alimento.save();
      
      const alimentoCompleto = await Alimento.findById(alimento._id)
        .populate('productos.productoId', 'nombre categoria');

      return res.status(200).json({
        success: true,
        message: 'Producto vinculado al ingrediente existente',
        data: alimentoCompleto
      });
    }

    // SI NO EXISTE: Crear nuevo alimento con el owner centralizado
    const alimentoData = {
      nombre: nombreNorm,
      stock: stockNumero,
      valor: valorNumero || 0,
      medida: medida || 'uds',
      productos: productos.map(p => ({
        productoId: p.productoId,
        cantidadRequerida: Number(p.cantidadRequerida)
      })),
      userId: ownerId
    };

    alimento = await Alimento.create(alimentoData);
    
    const alimentoCompleto = await Alimento.findById(alimento._id)
      .populate('productos.productoId', 'nombre categoria');

    res.status(201).json({
      success: true,
      message: 'Alimento creado exitosamente',
      data: alimentoCompleto
    });
  } catch (error) {
    console.error('❌ Error completo al crear alimento:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear el alimento',
      error: error.message
    });
  }
});

// Actualizar un alimento
router.put('/:id', protect, async (req, res) => {
  try {
    const { nombre, stock, valor, productos, medida } = req.body;

    // ✅ VALIDAR números si vienen en el body
    const updateData = {
      nombre: nombre ? nombre.trim() : undefined,
      stock: stock !== undefined ? Number(stock) : undefined,
      valor: valor !== undefined ? Number(valor) : undefined,
      medida: medida ? medida.trim() : undefined,
      productos: productos ? productos.map(p => ({
        productoId: p.productoId,
        cantidadRequerida: Number(p.cantidadRequerida)
      })) : undefined
    };

    // Remover undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // ✅ PREVENIR DUPLICADOS POR NOMBRE (ignore case) al actualizar
    if (updateData.nombre) {
      const ownerId = req.mainAdminId || req.user._id;
      const existeRecienRenombrado = await Alimento.findOne({
        userId: ownerId,
        nombre: { $regex: new RegExp(`^${updateData.nombre}$`, 'i') },
        _id: { $ne: req.params.id }
      });

      if (existeRecienRenombrado) {
        return res.status(400).json({
          success: false,
          message: 'Ya existe un ingrediente con ese nombre (posible duplicado por mayúsculas/minúsculas)'
        });
      }
    }

    const alimento = await Alimento.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('productos.productoId', 'nombre categoria');

    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Alimento actualizado exitosamente',
      data: alimento
    });
  } catch (error) {
    console.error('❌ Error al actualizar:', error);
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el alimento',
      error: error.message
    });
  }
});

// Eliminar un alimento
router.delete('/:id', protect, async (req, res) => {
  try {
    const alimento = await Alimento.findByIdAndDelete(req.params.id);

    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Alimento eliminado exitosamente',
      data: alimento
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el alimento',
      error: error.message
    });
  }
});

// ✅ RUTA PARA SINCRONIZAR/FUSIONAR DUPLICADOS
router.post('/sync-duplicates', protect, async (req, res) => {
  try {
    const ownerId = req.mainAdminId || req.user._id;

    // 1. Obtener todos los alimentos de este restaurante (SOLO del admin principal)
    const alimentos = await Alimento.find({ userId: ownerId });

    // 2. Agrupar por nombre (normalizado)
    const grupos = {};
    alimentos.forEach(a => {
      const nombreNorm = a.nombre.trim().toLowerCase();
      if (!grupos[nombreNorm]) grupos[nombreNorm] = [];
      grupos[nombreNorm].push(a);
    });

    let fusionados = 0;
    let documentosEliminados = 0;

    for (const nombre in grupos) {
      const docs = grupos[nombre];
      if (docs.length <= 1) continue;

      // Ordenar por fecha de actualización (el más reciente es el máster)
      docs.sort((a, b) => b.updatedAt - a.updatedAt);
      
      const master = docs[0];
      const duplicados = docs.slice(1);

      for (const dup of duplicados) {
        // Mover productos vinculados al máster si no están ya
        for (const pDup of dup.productos) {
          const productoIdDup = pDup.productoId?._id || pDup.productoId;
          if (!productoIdDup) continue;

          const existeEnMaster = master.productos.find(
            pm => {
              const productoIdMaster = pm.productoId?._id || pm.productoId;
              return productoIdMaster && productoIdMaster.toString() === productoIdDup.toString();
            }
          );
          
          if (!existeEnMaster) {
            master.productos.push(pDup);
          }
        }
        
        // Conservar el stock más alto o el del máster? 
        // El usuario quiere que "queden con el mismo stock", unificamos en el máster.
        
        await Alimento.findByIdAndDelete(dup._id);
        documentosEliminados++;
      }

      // Asegurar que el máster tenga el owner correcto (el admin principal)
      master.userId = ownerId;
      await master.save();
      fusionados++;
    }

    res.json({
      success: true,
      message: `Sincronización completada: ${fusionados} ingredientes unificados, ${documentosEliminados} duplicados eliminados.`,
      data: { fusionados, documentosEliminados }
    });
  } catch (error) {
    console.error('❌ Error en sincronización:', error);
    res.status(500).json({
      success: false,
      message: 'Error al sincronizar duplicados',
      error: error.message
    });
  }
});

module.exports = router;