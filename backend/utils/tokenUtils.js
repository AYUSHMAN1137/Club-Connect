const crypto = require('crypto');

// Use JWT_SECRET from environment or fallback
const SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * Generate a random nonce string
 */
function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Base64URL encode a string
 */
function base64UrlEncode(str) {
    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Base64URL decode a string
 */
function base64UrlDecode(str) {
    // Add back padding
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Generate HMAC signature
 */
function generateSignature(payload) {
    return crypto
        .createHmac('sha256', SECRET)
        .update(payload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Generate attendance QR token
 * @param {number} sessionId - Session ID
 * @param {number} eventId - Event ID
 * @param {string} nonce - Current nonce
 * @param {number} expirySeconds - Token expiry in seconds (default 30)
 * @returns {string} Token in format: base64url(payload).base64url(signature)
 */
function generateAttendanceToken(sessionId, eventId, nonce, expirySeconds = 30) {
    const payload = {
        sid: sessionId,
        eid: eventId,
        n: nonce,
        exp: Date.now() + (expirySeconds * 1000)
    };

    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signature = generateSignature(payloadB64);

    return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode attendance token
 * @param {string} token - Token to verify
 * @returns {object|null} Decoded payload or null if invalid
 */
function verifyAttendanceToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) {
            return { valid: false, error: 'Invalid token format' };
        }

        const [payloadB64, signature] = parts;

        // Verify signature
        const expectedSignature = generateSignature(payloadB64);
        if (signature !== expectedSignature) {
            return { valid: false, error: 'Invalid signature' };
        }

        // Decode payload
        const payload = JSON.parse(base64UrlDecode(payloadB64));

        // Check expiry
        if (Date.now() > payload.exp) {
            return { valid: false, error: 'Token expired' };
        }

        return {
            valid: true,
            sessionId: payload.sid,
            eventId: payload.eid,
            nonce: payload.n,
            exp: payload.exp
        };
    } catch (error) {
        return { valid: false, error: 'Token parsing failed' };
    }
}

/**
 * Generate 7-character uppercase alphabetical code for attendance
 * Excludes I, O to avoid confusion with 1, 0
 */
function generateAttendanceCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 7; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

module.exports = {
    generateNonce,
    generateAttendanceToken,
    verifyAttendanceToken,
    generateAttendanceCode
};
