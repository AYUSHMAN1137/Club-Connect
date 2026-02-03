const sequelize = require('./config/database');
const GalleryPhoto = require('./models/GalleryPhoto');

async function migrate() {
    try {
        // Sync GalleryPhoto model with alter: true to add new columns
        await GalleryPhoto.sync({ alter: true });
        console.log('✅ GalleryPhoto table updated with new columns!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
