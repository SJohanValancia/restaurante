const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Validar configuración
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ ERROR: Faltan variables de entorno de Cloudinary. El upload fallará.');
}

// Configuración de Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuración del almacenamiento para productos
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'jc-rt/productos', // Carpeta específica para JC-RT
        format: 'webp', // Formato optimizado WebP
        public_id: (req, file) => `product_${Date.now()}`,
        transformation: [
            { width: 800, height: 800, crop: 'limit' }, // Redimensionar si es muy grande
            { quality: 'auto' },
            { fetch_format: 'auto' }
        ]
    },
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };
