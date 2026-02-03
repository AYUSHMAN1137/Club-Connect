/**
 * SAFE FILE HANDLER - Prevents JSON corruption and data loss
 * Features:
 * - Atomic writes (write to temp file first)
 * - Automatic backups before overwrite
 * - Error recovery
 * - Data validation
 */

const fs = require('fs');
const path = require('path');

// Backup directory
const BACKUP_DIR = path.join(__dirname, '../backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Safely read JSON file with error recovery
 */
function safeReadJSON(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            console.log(`📄 File not found: ${path.basename(filePath)}, using default value`);
            return defaultValue;
        }

        const data = fs.readFileSync(filePath, 'utf8');
        
        // Check if file is empty
        if (!data || data.trim().length === 0) {
            console.warn(`⚠️ Empty file: ${path.basename(filePath)}, using default value`);
            return defaultValue;
        }

        // Try to parse JSON
        const parsed = JSON.parse(data);
        console.log(`✅ Loaded ${path.basename(filePath)}`);
        return parsed;

    } catch (error) {
        console.error(`❌ Error reading ${path.basename(filePath)}:`, error.message);
        
        // Try to recover from backup
        const recovered = recoverFromBackup(filePath);
        if (recovered !== null) {
            console.log(`✅ Recovered from backup`);
            return recovered;
        }

        console.warn(`⚠️ Using default value for ${path.basename(filePath)}`);
        return defaultValue;
    }
}

/**
 * Safely write JSON file with atomic operation
 */
function safeWriteJSON(filePath, data) {
    try {
        // Validate data
        if (data === undefined || data === null) {
            throw new Error('Cannot write undefined or null data');
        }

        // Create backup before overwriting (if file exists)
        if (fs.existsSync(filePath)) {
            createBackup(filePath);
        }

        // Write to temporary file first (atomic operation)
        const tempFile = filePath + '.tmp';
        const jsonString = JSON.stringify(data, null, 2);
        
        fs.writeFileSync(tempFile, jsonString, 'utf8');

        // Verify the temp file is valid JSON
        const verification = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
        
        // If valid, rename temp file to actual file (atomic on most systems)
        fs.renameSync(tempFile, filePath);
        
        console.log(`💾 Saved ${path.basename(filePath)} (${jsonString.length} bytes)`);
        return true;

    } catch (error) {
        console.error(`❌ Error writing ${path.basename(filePath)}:`, error.message);
        
        // Clean up temp file if it exists
        const tempFile = filePath + '.tmp';
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        
        return false;
    }
}

/**
 * Create backup of file
 */
function createBackup(filePath) {
    try {
        const filename = path.basename(filePath);
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const backupPath = path.join(BACKUP_DIR, `${timestamp}_${filename}`);
        
        fs.copyFileSync(filePath, backupPath);
        console.log(`📦 Backup created: ${path.basename(backupPath)}`);
        
        // Keep only last 10 backups per file
        cleanOldBackups(filename);
        
        return true;
    } catch (error) {
        console.error(`⚠️ Backup failed:`, error.message);
        return false;
    }
}

/**
 * Recover data from most recent backup
 */
function recoverFromBackup(filePath) {
    try {
        const filename = path.basename(filePath);
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith(filename))
            .sort()
            .reverse();

        if (backups.length === 0) {
            console.log(`⚠️ No backups found for ${filename}`);
            return null;
        }

        // Try most recent backup
        const backupPath = path.join(BACKUP_DIR, backups[0]);
        const data = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(data);
        
        console.log(`✅ Recovered from backup: ${backups[0]}`);
        
        // Restore the backup to original location
        fs.copyFileSync(backupPath, filePath);
        
        return parsed;

    } catch (error) {
        console.error(`❌ Recovery failed:`, error.message);
        return null;
    }
}

/**
 * Clean old backups (keep only last 10)
 */
function cleanOldBackups(filename) {
    try {
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith(filename))
            .sort()
            .reverse();

        // Keep only last 10 backups
        if (backups.length > 10) {
            const toDelete = backups.slice(10);
            toDelete.forEach(backup => {
                const backupPath = path.join(BACKUP_DIR, backup);
                fs.unlinkSync(backupPath);
                console.log(`🗑️ Deleted old backup: ${backup}`);
            });
        }
    } catch (error) {
        console.error(`⚠️ Cleanup failed:`, error.message);
    }
}

/**
 * Validate JSON structure
 */
function validateJSON(data, schema) {
    // Basic validation - can be extended
    if (Array.isArray(schema)) {
        return Array.isArray(data);
    }
    if (typeof schema === 'object') {
        return typeof data === 'object' && data !== null;
    }
    return true;
}

/**
 * Get backup statistics
 */
function getBackupStats() {
    try {
        const backups = fs.readdirSync(BACKUP_DIR);
        const stats = {};
        
        backups.forEach(backup => {
            const filename = backup.split('_').slice(1).join('_');
            if (!stats[filename]) {
                stats[filename] = 0;
            }
            stats[filename]++;
        });
        
        return {
            totalBackups: backups.length,
            byFile: stats,
            backupDir: BACKUP_DIR
        };
    } catch (error) {
        return { error: error.message };
    }
}

module.exports = {
    safeReadJSON,
    safeWriteJSON,
    createBackup,
    recoverFromBackup,
    validateJSON,
    getBackupStats
};
