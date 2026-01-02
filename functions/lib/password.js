/**
 * Password utilities using Web Crypto API (Cloudflare Workers compatible)
 */

/**
 * Convert ArrayBuffer to hex string
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToHex(buffer) {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Generate random bytes as hex string
 * @param {number} length - Number of bytes
 * @returns {string}
 */
function randomHex(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bufferToHex(bytes);
}

/**
 * Hash a password using SHA-256 with salt
 * @param {string} password - Plain text password
 * @param {string} salt - Optional salt (will generate if not provided)
 * @returns {Promise<Object>} - Object containing hash and salt
 */
export async function hashPassword(password, salt = null) {
    if (!password) {
        throw new Error('Password is required');
    }

    // Generate salt if not provided
    if (!salt) {
        salt = randomHex(16);
    }

    // Hash password with salt using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hash = bufferToHex(hashBuffer);

    return {
        hash: hash,
        salt: salt,
        fullHash: `${hash}:${salt}`
    };
}

/**
 * Verify a password against a stored hash
 * @param {string} password - Plain text password to verify
 * @param {string} storedHash - Stored hash in format "hash:salt"
 * @returns {Promise<boolean>} - True if password matches
 */
export async function verifyPassword(password, storedHash) {
    if (!password || !storedHash) {
        return false;
    }

    try {
        const [hash, salt] = storedHash.split(':');

        if (!hash || !salt) {
            return false;
        }

        // Hash the provided password with the stored salt
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const computedHash = bufferToHex(hashBuffer);

        // Timing-safe comparison
        const hashBytes = hexToBuffer(hash);
        const computedBytes = hexToBuffer(computedHash);

        if (hashBytes.length !== computedBytes.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < hashBytes.length; i++) {
            result |= hashBytes[i] ^ computedBytes[i];
        }
        return result === 0;
    } catch (error) {
        console.error('Password verification error:', error);
        return false;
    }
}

/**
 * Generate a secure random password
 * @param {number} length - Password length (default: 16)
 * @returns {string} - Random password
 */
export function generatePassword(length = 16) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const randomBytes = new Uint8Array(length);
    crypto.getRandomValues(randomBytes);
    let password = '';

    for (let i = 0; i < length; i++) {
        password += charset[randomBytes[i] % charset.length];
    }

    return password;
}
