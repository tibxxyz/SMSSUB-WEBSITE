import crypto from 'crypto';

/**
 * Hash a password using SHA-256 with salt
 * Note: For production, consider using bcrypt instead
 * @param {string} password - Plain text password
 * @param {string} salt - Optional salt (will generate if not provided)
 * @returns {Object} - Object containing hash and salt
 */
export function hashPassword(password, salt = null) {
    if (!password) {
        throw new Error('Password is required');
    }

    // Generate salt if not provided
    if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
    }

    // Hash password with salt using SHA-256
    const hash = crypto
        .createHash('sha256')
        .update(password + salt)
        .digest('hex');

    return {
        hash: hash,
        salt: salt,
        // Store as "hash:salt" format for easy storage
        fullHash: `${hash}:${salt}`
    };
}

/**
 * Verify a password against a stored hash
 * @param {string} password - Plain text password to verify
 * @param {string} storedHash - Stored hash in format "hash:salt"
 * @returns {boolean} - True if password matches
 */
export function verifyPassword(password, storedHash) {
    if (!password || !storedHash) {
        return false;
    }

    try {
        // Split stored hash into hash and salt
        const [hash, salt] = storedHash.split(':');
        
        if (!hash || !salt) {
            return false;
        }

        // Hash the provided password with the stored salt
        const computedHash = crypto
            .createHash('sha256')
            .update(password + salt)
            .digest('hex');

        // Compare hashes (use timing-safe comparison)
        return crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(computedHash, 'hex')
        );
    } catch (error) {
        console.error('Password verification error:', error);
        return false;
    }
}

/**
 * Generate a secure random password (for admin setup)
 * @param {number} length - Password length (default: 16)
 * @returns {string} - Random password
 */
export function generatePassword(length = 16) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const randomBytes = crypto.randomBytes(length);
    let password = '';
    
    for (let i = 0; i < length; i++) {
        password += charset[randomBytes[i] % charset.length];
    }
    
    return password;
}

